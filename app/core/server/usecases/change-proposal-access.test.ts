import { describe, expect, it, vi } from 'vitest';

import {
  changeProposalOwnerDetailSchema,
  changeProposalReference,
  ok,
  type AppError,
  type Course,
  type CourseLesson,
  type CourseModule,
  type Identity,
  type Product,
  type Result,
  type ShopManagementKey,
  type ShopManagementScope,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { StorageProvider } from '../ports.js';
import {
  changeProposalOwnerViewFakes,
  createChangeProposalStoreFake,
  createChangeProposalTransactionFake,
  createQuarantinedImagesFake,
  createUnreadNotificationsFake,
  emptyCatalogState,
  fakeContentHash,
} from '../testing/change-proposal-fakes.js';
import {
  approveChangeProposalGroup,
  createChangeProposalGroup,
  getChangeProposalGroup,
  submitGroupedChangeProposal,
} from './change-proposal-groups.js';
import { approveChangeProposal, getChangeProposal, getOwnChangeProposal, submitChangeProposal } from './change-proposals.js';
import { updateProductAccessItems } from './course-management.js';
import { shopManagementKeyCapabilities } from './shop-machine-auth.js';

const TENANT = 'tenant-acme';
const NEIGHBOUR = 'tenant-studio';
const OWNER = 'user-owner';
const ISSUER = 'user-issuer';
const NOW = '2026-03-01T10:00:00.000Z';
const KEY_ID = 'key-propose';
const SCOPES: ShopManagementScope[] = ['shop:catalog:read', 'shop:catalog:write'];

const identity = (overrides: Partial<Identity> = {}): Identity => ({
  userId: OWNER, email: 'owner@example.test', name: 'Owner', emailVerified: true, tenantAccess: 'staff',
  tenantId: TENANT, tenantSlug: 'acme', tenantName: 'Acme', staffRole: 'owner', memberId: null, image: null,
  memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
  ...overrides,
});

const ownerSession: Ctx = { identity: identity() };

const keyCtx = (mode: ShopManagementKey['mode'] = 'propose', scopes: ShopManagementScope[] = SCOPES): Ctx => ({
  identity: identity({ userId: ISSUER, email: 'issuer@example.test' }),
  capabilities: shopManagementKeyCapabilities({ scopes, mode }),
  machineActor: { kind: 'shop_management_key', apiKeyId: KEY_ID, mode },
});

const shopKey: ShopManagementKey = {
  id: KEY_ID, tenantId: TENANT, name: 'Catalogue agent', keyHash: 'hash', scopes: SCOPES, mode: 'propose',
  issuedByUserId: ISSUER, createdAt: '2026-02-25T00:00:00.000Z', expiresAt: '2026-03-20T00:00:00.000Z', revokedAt: null,
};

const CREATED_AT = '2026-01-01T00:00:00.000Z';

const product = (overrides: Partial<Product> = {}): Product => ({
  id: 'product-guide', tenantId: TENANT, type: 'digital_download', slug: 'guide', title: 'Field guide', description: '', coverUrl: null,
  priceCents: 0, currency: 'EUR', published: false, visibility: 'listed', salesChannel: 'any', deliveryMethod: 'pickup',
  accessItems: [{ level: 'course', courseId: 'course-intro' }], legacyId: null, createdAt: CREATED_AT, vatRate: null, vatExemptionBasis: null,
  ...overrides,
});

const course = (id: string, name: string, tenantId = TENANT): Course => ({
  id, tenantId, name, description: '', imageUrl: null, moduleOrder: [], publiclyVisible: false, archivedAt: null, legacyId: null, createdAt: CREATED_AT,
});

const module = (id: string, title: string, courseIds: string[], lessonIds: string[], tenantId = TENANT): CourseModule => ({
  id, tenantId, courseIds, title, prefix: null, name: title, legacyId: null, createdAt: CREATED_AT,
  chapters: [{ id: `${id}-chapter`, name: 'Chapter', contents: lessonIds.map((lessonId) => ({ id: `${id}-${lessonId}`, lessonId, name: lessonId })) }],
});

const lesson = (id: string, name: string, tenantId = TENANT): CourseLesson => ({
  id, tenantId, name, isPreview: false, contents: [], legacyId: null, createdAt: CREATED_AT,
});

const storageSecrets = {
  resolve: async () => ok(JSON.stringify({ provider: 'aws_s3', endpoint: 'https://storage.example.test', bucket: 'downloads', region: 'auto', accessKeyId: 'a', secretAccessKey: 's' })),
};

const refusingStorage = (): StorageProvider => {
  const refuse = () => { throw new Error('No storage call is expected'); };
  return {
    objectUrl: (_configuration, key) => new URL(`https://storage.example.test/${key}`),
    delete: refuse, list: refuse, getObject: refuse, putObject: refuse, probe: refuse, copyObject: refuse, digestObject: refuse, probeCors: refuse,
    presignPut: refuse, presignGet: refuse, head: refuse, healthcheck: refuse, test: refuse,
  };
};

const unwrap = <T>(result: Result<T, AppError>): T => {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

const harness = () => {
  const state = emptyCatalogState();
  state.products.push(
    product(),
    product({ id: 'product-mug', slug: 'mug', title: 'Mug', type: 'physical', accessItems: [] }),
    product({ id: 'product-neighbour', tenantId: NEIGHBOUR, slug: 'neighbour', title: 'Neighbour guide' }),
  );
  state.courses.push(course('course-intro', 'Intro course'), course('course-advanced', 'Advanced course'), course('course-neighbour', 'Neighbour course', NEIGHBOUR));
  state.modules.push(
    module('module-basics', 'Basics', ['course-intro'], ['lesson-welcome']),
    module('module-deep', 'Deep dive', ['course-advanced'], ['lesson-deep']),
    module('module-neighbour', 'Neighbour module', ['course-neighbour'], ['lesson-neighbour'], NEIGHBOUR),
  );
  state.lessons.push(lesson('lesson-welcome', 'Welcome'), lesson('lesson-deep', 'Going deeper'), lesson('lesson-neighbour', 'Neighbour lesson', NEIGHBOUR));
  const store = createChangeProposalStoreFake([shopKey]);
  const transaction = createChangeProposalTransactionFake(state, store, storageSecrets);
  const accounts = [
    { userId: ISSUER, email: 'issuer@example.test', ownerOf: [TENANT] },
    { userId: OWNER, email: 'owner@example.test', ownerOf: [TENANT] },
  ];
  let sequence = 0;
  const clock = { now: NOW };
  const deps = {
    changeProposalTransaction: transaction,
    changeProposals: store.repository,
    changeProposalGroups: store.groups,
    changeProposalEvents: store.events,
    shopManagementKeys: { listByTenant: async (tenantId: string) => [shopKey].filter((key) => key.tenantId === tenantId) },
    ...createUnreadNotificationsFake(accounts),
    ...changeProposalOwnerViewFakes(state, accounts),
    storage: refusingStorage(),
    quarantinedImages: createQuarantinedImagesFake(state, store).repository,
    secretResolver: storageSecrets,
    contentHash: fakeContentHash,
    logger: { error: vi.fn<(message: string) => void>() },
    ids: { nextId: () => `generated-${String(++sequence)}` },
    clock: { nowIso: () => clock.now },
  };
  const submit = (input: unknown, ctx = keyCtx()) => submitChangeProposal(ctx, { operation: 'product.set-access', input }, deps);
  return { state, store, transaction, deps, clock, submit };
};

type Harness = ReturnType<typeof harness>;

const accessOf = (h: Harness, id: string) => h.state.products.find((candidate) => candidate.id === id)?.accessItems;

const ADVANCED = [{ level: 'course' as const, courseId: 'course-advanced' }];

describe('proposing what a product grants', () => {
  it('stores the access lists before and after, changes nothing live and locks the courses before the product', async () => {
    const h = harness();
    const before = structuredClone(h.state);

    const receipt = unwrap(await h.submit({ id: 'product-guide', accessItems: ADVANCED }));

    expect(receipt).toMatchObject({ operation: 'product.set-access', status: 'pending', target: { kind: 'product', id: 'product-guide' }, input: { id: 'product-guide', accessItems: ADVANCED } });
    expect(JSON.stringify(receipt)).not.toMatch(/Advanced course|Intro course/u);
    expect(h.store.proposals[0]?.effect).toEqual({ accessItems: { before: [{ level: 'course', courseId: 'course-intro' }], after: ADVANCED } });
    expect(h.state).toEqual(before);
    expect(h.transaction.courseLocks).toEqual([{ courseIds: ['course-advanced'], targetLocksBefore: 0 }]);
    expect(h.transaction.locks).toEqual([{ kind: 'product', id: 'product-guide' }]);
  });

  it.each([
    ['a lesson of another course', { id: 'product-guide', accessItems: [{ level: 'lessons', courseId: 'course-intro', lessonIds: ['lesson-deep'] }] }, 'validation'],
    ['a module of another course', { id: 'product-guide', accessItems: [{ level: 'modules', courseId: 'course-intro', moduleIds: ['module-deep'] }] }, 'validation'],
    ['another workspace\'s course', { id: 'product-guide', accessItems: [{ level: 'course', courseId: 'course-neighbour' }] }, 'validation'],
    ['another workspace\'s module', { id: 'product-guide', accessItems: [{ level: 'modules', courseId: 'course-intro', moduleIds: ['module-neighbour'] }] }, 'validation'],
    ['another workspace\'s lesson', { id: 'product-guide', accessItems: [{ level: 'lessons', courseId: 'course-intro', lessonIds: ['lesson-neighbour'] }] }, 'validation'],
    ['another workspace\'s product', { id: 'product-neighbour', accessItems: ADVANCED }, 'not_found'],
    ['the list the product already grants', { id: 'product-guide', accessItems: [{ level: 'course', courseId: 'course-intro' }] }, 'validation'],
    ['checkout consent definitions', { id: 'product-guide', accessItems: ADVANCED, checkoutConsentDefinitionIds: ['consent-1'] }, 'validation'],
    ['access for a physical product', { id: 'product-mug', accessItems: ADVANCED }, 'validation'],
  ])('refuses %s and stores nothing', async (_label, input, code) => {
    const h = harness();
    expect(await h.submit(input)).toMatchObject({ ok: false, error: { code } });
    expect(h.store.proposals).toEqual([]);
  });

  it('is refused to a direct-mode key, which holds no capability to change what a product grants', async () => {
    const h = harness();
    const direct = keyCtx('direct');
    expect(await h.submit({ id: 'product-guide', accessItems: ADVANCED }, direct)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    const live = await h.transaction.run(TENANT, async ({ repositories }) =>
      updateProductAccessItems(direct, { id: 'product-guide', accessItems: ADVANCED }, { ...repositories, ids: h.deps.ids, clock: h.deps.clock }));
    expect(live).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(accessOf(h, 'product-guide')).toEqual([{ level: 'course', courseId: 'course-intro' }]);
  });
});

describe('approving what a product grants', () => {
  it('applies exactly the stored list as the approving owner', async () => {
    const h = harness();
    const { id } = unwrap(await h.submit({ id: 'product-guide', accessItems: ADVANCED }));

    expect(await approveChangeProposal(ownerSession, { id }, h.deps)).toMatchObject({ ok: true, value: { status: 'applied', appliedResourceId: 'product-guide' } });
    expect(accessOf(h, 'product-guide')).toEqual(ADVANCED);
    expect(h.state.entityVersionAuthors).toEqual([OWNER]);
  });

  it('is stale and applies nothing once the list moved', async () => {
    const h = harness();
    const { id } = unwrap(await h.submit({ id: 'product-guide', accessItems: ADVANCED }));
    const moved = h.state.products.find((candidate) => candidate.id === 'product-guide');
    if (moved !== undefined) moved.accessItems = [{ level: 'modules', courseId: 'course-intro', moduleIds: ['module-basics'] }];

    expect(await approveChangeProposal(ownerSession, { id }, h.deps)).toMatchObject({ ok: true, value: { status: 'stale', appliedResourceId: null } });
    expect(accessOf(h, 'product-guide')).toEqual([{ level: 'modules', courseId: 'course-intro', moduleIds: ['module-basics'] }]);
  });

  it('fails with the validation error and applies nothing once a proposed lesson left its course', async () => {
    const h = harness();
    const { id } = unwrap(await h.submit({ id: 'product-guide', accessItems: [{ level: 'lessons', courseId: 'course-advanced', lessonIds: ['lesson-deep'] }] }));
    const deep = h.state.modules.find((candidate) => candidate.id === 'module-deep');
    if (deep !== undefined) deep.courseIds = ['course-intro'];

    expect(await approveChangeProposal(ownerSession, { id }, h.deps)).toMatchObject({ ok: true, value: { status: 'failed', failureCode: 'validation' } });
    expect(accessOf(h, 'product-guide')).toEqual([{ level: 'course', courseId: 'course-intro' }]);
  });
});

describe('the owner view of a proposed access change', () => {
  it('names every course, module and lesson of both lists at view time and marks an id that is gone', async () => {
    const h = harness();
    const accessItems = [
      { level: 'modules' as const, courseId: 'course-intro', moduleIds: ['module-basics'] },
      { level: 'lessons' as const, courseId: 'course-advanced', lessonIds: ['lesson-deep'] },
    ];
    const { id } = unwrap(await h.submit({ id: 'product-guide', accessItems }));
    h.state.lessons = h.state.lessons.filter((candidate) => candidate.id !== 'lesson-deep');

    const view = unwrap(await getChangeProposal(ownerSession, { id }, h.deps));
    expect(changeProposalOwnerDetailSchema.parse(view).accessLabels).toEqual({
      courses: [{ id: 'course-intro', title: 'Intro course' }, { id: 'course-advanced', title: 'Advanced course' }],
      modules: [{ id: 'module-basics', title: 'Basics' }],
      lessons: [{ id: 'lesson-deep', title: null }],
    });
    expect(JSON.stringify(unwrap(await getOwnChangeProposal(keyCtx(), { id }, h.deps)))).not.toMatch(/Intro course|Basics|accessLabels/u);
  });

  it('carries no access labels for any other operation', async () => {
    const h = harness();
    const { id } = unwrap(await submitChangeProposal(keyCtx(), { operation: 'product.update', input: { id: 'product-guide', title: 'Pocket guide' } }, h.deps));
    expect(unwrap(await getChangeProposal(ownerSession, { id }, h.deps))).not.toHaveProperty('accessLabels');
  });
});

describe('what a product grants in a group', () => {
  it('replays the product an earlier item creates, names it by reference and applies both together', async () => {
    const h = harness();
    const groupId = unwrap(await createChangeProposalGroup(keyCtx(), { title: 'Launch' }, h.deps)).id;
    const created = unwrap(await submitGroupedChangeProposal(keyCtx(), {
      groupId, operation: 'product.create', input: { title: 'Starter pack', slug: 'starter-pack', type: 'digital_download', priceCents: 0, currency: 'EUR' },
    }, h.deps)).items.at(-1)?.id ?? '';
    const reference = changeProposalReference(created);
    const access = unwrap(await submitGroupedChangeProposal(keyCtx(), {
      groupId, operation: 'product.set-access', input: { id: reference, accessItems: ADVANCED },
    }, h.deps)).items.at(-1)?.id ?? '';
    expect(h.store.proposals.find((proposal) => proposal.id === access)).toMatchObject({
      target: { kind: 'product', id: reference }, effect: { accessItems: { before: [], after: ADVANCED } },
    });
    const items = unwrap(await getChangeProposalGroup(ownerSession, { id: groupId }, h.deps)).items;
    expect(items.find((item) => item.id === access)?.accessLabels).toEqual({ courses: [{ id: 'course-advanced', title: 'Advanced course' }], modules: [], lessons: [] });

    expect(await approveChangeProposalGroup(ownerSession, { id: groupId, itemIds: [created, access] }, h.deps)).toMatchObject({ ok: true, value: { status: 'applied' } });
    expect(h.state.products.find((candidate) => candidate.slug === 'starter-pack')?.accessItems).toEqual(ADVANCED);
  });
});
