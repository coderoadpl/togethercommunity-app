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
  state.courses.push(course('course-intro', 'Intro course'), course('course-advanced', 'Advanced course'), course('course-extra', 'Extra course'), course('course-neighbour', 'Neighbour course', NEIGHBOUR));
  state.modules.push(
    module('module-basics', 'Basics', ['course-intro'], ['lesson-welcome']),
    module('module-deep', 'Deep dive', ['course-advanced'], ['lesson-deep']),
    module('module-shared', 'Shared extras', ['course-intro', 'course-advanced'], []),
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

const lockMarks = (h: Harness) => ({
  targetLocks: h.transaction.locks.length,
  courseLocks: h.transaction.courseLocks.length,
  repositoryCourseLocks: h.transaction.repositoryCourseLocks.length,
});

const coursesFirstLockedAfterAProduct = (h: Harness, marks: ReturnType<typeof lockMarks>): string[] => {
  const records = [...h.transaction.courseLocks.slice(marks.courseLocks), ...h.transaction.repositoryCourseLocks.slice(marks.repositoryCourseLocks)];
  const courseIds = [...new Set(records.flatMap((record) => record.courseIds))];
  return courseIds.filter((courseId) =>
    Math.min(...records.filter((record) => record.courseIds.includes(courseId)).map((record) => record.targetLocksBefore)) > marks.targetLocks);
};

const setStored = (h: Harness, id: string, accessItems: Product['accessItems']) => {
  const stored = h.state.products.find((candidate) => candidate.id === id);
  if (stored === undefined) throw new Error(`No product ${id}`);
  stored.accessItems = accessItems;
};

const attachModule = (h: Harness, moduleId: string, courseId: string) => {
  const found = h.state.modules.find((candidate) => candidate.id === moduleId);
  if (found === undefined) throw new Error(`No module ${moduleId}`);
  found.courseIds = [...found.courseIds, courseId];
};

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
    ['another workspace\'s product', { id: 'product-neighbour', accessItems: ADVANCED }, 'not_found'],
    ['the list the product already grants', { id: 'product-guide', accessItems: [{ level: 'course', courseId: 'course-intro' }] }, 'validation'],
    ['checkout consent definitions', { id: 'product-guide', accessItems: ADVANCED, checkoutConsentDefinitionIds: ['consent-1'] }, 'validation'],
    ['access for a physical product', { id: 'product-mug', accessItems: ADVANCED }, 'validation'],
    ['a repeated item', { id: 'product-guide', accessItems: [...ADVANCED, { level: 'course', courseId: 'course-advanced', excludedModuleIds: [] }] }, 'validation'],
    ['a repeated id inside an item', { id: 'product-guide', accessItems: [{ level: 'lessons', courseId: 'course-advanced', lessonIds: ['lesson-deep', 'lesson-deep'] }] }, 'validation'],
  ])('refuses %s and stores nothing', async (_label, input, code) => {
    const h = harness();
    expect(await h.submit(input)).toMatchObject({ ok: false, error: { code } });
    expect(h.store.proposals).toEqual([]);
  });

  it.each([
    ['a repeated item', [...ADVANCED, { level: 'course', courseId: 'course-advanced', excludedModuleIds: [] }]],
    ['a repeated id inside an item', [{ level: 'lessons', courseId: 'course-advanced', lessonIds: ['lesson-deep', 'lesson-deep'] }]],
  ])('refuses a new product whose access list holds %s and stores nothing', async (_label, accessItems) => {
    const h = harness();
    const input = { title: 'Starter pack', slug: 'starter-pack', type: 'digital_download', priceCents: 0, currency: 'EUR', accessItems };
    expect(await submitChangeProposal(keyCtx(), { operation: 'product.create', input }, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.store.proposals).toEqual([]);
  });

  const UNREADABLE_REFERENCES: Array<[string, Product['accessItems']]> = [
    ['a lesson of another course', [{ level: 'lessons', courseId: 'course-intro', lessonIds: ['lesson-deep'] }]],
    ['a lesson that does not exist', [{ level: 'lessons', courseId: 'course-intro', lessonIds: ['lesson-gone'] }]],
    ['a module of another course', [{ level: 'modules', courseId: 'course-intro', moduleIds: ['module-deep'] }]],
    ['a module that does not exist', [{ level: 'modules', courseId: 'course-intro', moduleIds: ['module-gone'] }]],
    ['an exclusion of another course', [{ level: 'course', courseId: 'course-intro', excludedModuleIds: ['module-deep'] }]],
    ['a course that does not exist', [{ level: 'course', courseId: 'course-gone' }]],
    ['an archived course', [{ level: 'course', courseId: 'course-archived' }]],
    ['another workspace\'s course', [{ level: 'course', courseId: 'course-neighbour' }]],
    ['another workspace\'s module', [{ level: 'modules', courseId: 'course-intro', moduleIds: ['module-neighbour'] }]],
    ['another workspace\'s lesson', [{ level: 'lessons', courseId: 'course-intro', lessonIds: ['lesson-neighbour'] }]],
  ];

  it.each(UNREADABLE_REFERENCES)('accepts %s at submission, which tells the key nothing, and fails it at approval', async (_label, accessItems) => {
    const h = harness();
    h.state.courses.push({ ...course('course-archived', 'Archived course'), archivedAt: CREATED_AT });
    const receipt = unwrap(await h.submit({ id: 'product-guide', accessItems }));
    expect(receipt).toMatchObject({ status: 'pending' });
    expect(h.store.proposals[0]?.effect).toEqual({ accessItems: { before: [{ level: 'course', courseId: 'course-intro' }], after: accessItems } });

    expect(await approveChangeProposal(ownerSession, { id: receipt.id }, h.deps)).toMatchObject({ ok: true, value: { status: 'failed', failureCode: 'validation' } });
    expect(accessOf(h, 'product-guide')).toEqual([{ level: 'course', courseId: 'course-intro' }]);
  });

  it.each(UNREADABLE_REFERENCES)('accepts %s in a group, as a new product grants it or as an existing product is set to it, and fails the group at approval', async (_label, accessItems) => {
    const h = harness();
    h.state.courses.push({ ...course('course-archived', 'Archived course'), archivedAt: CREATED_AT });
    const groupId = unwrap(await createChangeProposalGroup(keyCtx(), { title: 'Launch' }, h.deps)).id;
    const submit = async (operation: 'product.create' | 'product.set-access', input: unknown) =>
      unwrap(await submitGroupedChangeProposal(keyCtx(), { groupId, operation, input }, h.deps)).items.at(-1)?.id ?? '';
    const created = await submit('product.create', { title: 'Starter pack', slug: 'starter-pack', type: 'digital_download', priceCents: 0, currency: 'EUR', accessItems });
    const access = await submit('product.set-access', { id: 'product-guide', accessItems });
    expect(h.store.proposals.map((proposal) => proposal.status)).toEqual(['pending', 'pending']);

    expect(await approveChangeProposalGroup(ownerSession, { id: groupId, itemIds: [created, access] }, h.deps)).toMatchObject({ ok: true });
    expect(h.store.proposals.map((proposal) => [proposal.status, proposal.failureCode])).toEqual([['failed', 'validation'], ['stale', null]]);
    expect(h.state.products.some((candidate) => candidate.slug === 'starter-pack')).toBe(false);
    expect(accessOf(h, 'product-guide')).toEqual([{ level: 'course', courseId: 'course-intro' }]);
  });

  it('refuses the list the product already grants in another order as a change of nothing', async () => {
    const h = harness();
    setStored(h, 'product-guide', [{ level: 'course', courseId: 'course-intro' }, { level: 'modules', courseId: 'course-advanced', moduleIds: ['module-deep', 'module-shared'] }]);
    expect(await h.submit({
      id: 'product-guide',
      accessItems: [{ level: 'modules', courseId: 'course-advanced', moduleIds: ['module-shared', 'module-deep'] }, { level: 'course', courseId: 'course-intro', excludedModuleIds: [] }],
    })).toMatchObject({ ok: false, error: { code: 'validation', message: 'Invalid product access payload: it would change nothing the owner can see' } });
    expect(h.store.proposals).toEqual([]);
  });

  it('accepts excluding a module that another course also uses, since the exclusion holds only inside the course it names', async () => {
    const h = harness();
    const accessItems = [{ level: 'course' as const, courseId: 'course-intro', excludedModuleIds: ['module-shared'] }];
    expect(await h.submit({ id: 'product-guide', accessItems })).toMatchObject({ ok: true, value: { status: 'pending' } });
    expect(h.store.proposals[0]?.effect).toEqual({ accessItems: { before: [{ level: 'course', courseId: 'course-intro' }], after: accessItems } });
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
    const targetLocksBefore = h.transaction.locks.length;
    const courseLocksBefore = h.transaction.courseLocks.length;

    expect(await approveChangeProposal(ownerSession, { id }, h.deps)).toMatchObject({ ok: true, value: { status: 'applied', appliedResourceId: 'product-guide' } });
    expect(accessOf(h, 'product-guide')).toEqual(ADVANCED);
    expect(h.state.entityVersionAuthors).toEqual([OWNER]);
    expect(h.transaction.courseLocks.slice(courseLocksBefore)).toEqual([{ courseIds: ['course-advanced'], targetLocksBefore }]);
    expect(h.transaction.locks.slice(targetLocksBefore)).toEqual([{ kind: 'product', id: 'product-guide' }]);
  });

  it('applies the list as sent when the stored list only changed its order since the proposal', async () => {
    const h = harness();
    const before = [{ level: 'course' as const, courseId: 'course-intro' }, { level: 'lessons' as const, courseId: 'course-advanced', lessonIds: ['lesson-deep'] }];
    setStored(h, 'product-guide', before);
    const sent = [{ level: 'modules' as const, courseId: 'course-advanced', moduleIds: ['module-shared', 'module-deep'] }];
    const { id } = unwrap(await h.submit({ id: 'product-guide', accessItems: sent }));
    setStored(h, 'product-guide', before.toReversed());

    expect(await approveChangeProposal(ownerSession, { id }, h.deps)).toMatchObject({ ok: true, value: { status: 'applied' } });
    expect(accessOf(h, 'product-guide')).toEqual(sent);
  });

  it('applies an exclusion of a module that was attached to another course after the proposal', async () => {
    const h = harness();
    const accessItems = [{ level: 'course' as const, courseId: 'course-intro', excludedModuleIds: ['module-basics'] }];
    const { id } = unwrap(await h.submit({ id: 'product-guide', accessItems }));
    attachModule(h, 'module-basics', 'course-advanced');

    expect(await approveChangeProposal(ownerSession, { id }, h.deps)).toMatchObject({ ok: true, value: { status: 'applied', appliedResourceId: 'product-guide' } });
    expect(accessOf(h, 'product-guide')).toEqual(accessItems);
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

  it('lists the archived courses of both lists, and only once a course is archived', async () => {
    const h = harness();
    const { id } = unwrap(await h.submit({ id: 'product-guide', accessItems: ADVANCED }));
    const labels = async () => changeProposalOwnerDetailSchema.parse(unwrap(await getChangeProposal(ownerSession, { id }, h.deps))).accessLabels;
    expect(await labels()).not.toHaveProperty('archivedCourses');

    h.state.courses = h.state.courses.map((candidate) => candidate.id === 'course-advanced' ? { ...candidate, archivedAt: NOW } : candidate);
    expect((await labels())?.archivedCourses).toEqual(['course-advanced']);
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
    expect(items.find((item) => item.id === access)?.accessLabels).toEqual({
      courses: [{ id: 'course-advanced', title: 'Advanced course' }], modules: [], lessons: [],
    });

    expect(await approveChangeProposalGroup(ownerSession, { id: groupId, itemIds: [created, access] }, h.deps)).toMatchObject({ ok: true, value: { status: 'applied' } });
    expect(h.state.products.find((candidate) => candidate.slug === 'starter-pack')?.accessItems).toEqual(ADVANCED);
  });

  it('locks the courses of every item once, in id order, before any item locks a product', async () => {
    const h = harness();
    const groupId = unwrap(await createChangeProposalGroup(keyCtx(), { title: 'Launch' }, h.deps)).id;
    const submit = async (operation: 'product.create' | 'product.update' | 'product.set-access', input: unknown) =>
      unwrap(await submitGroupedChangeProposal(keyCtx(), { groupId, operation, input }, h.deps)).items.at(-1)?.id ?? '';
    const updated = await submit('product.update', { id: 'product-guide', title: 'Pocket guide' });
    const created = await submit('product.create', {
      title: 'Starter pack', slug: 'starter-pack', type: 'digital_download', priceCents: 0, currency: 'EUR', accessItems: [{ level: 'course', courseId: 'course-extra' }],
    });
    const access = await submit('product.set-access', {
      id: changeProposalReference(created), accessItems: [{ level: 'course', courseId: 'course-intro' }, { level: 'course', courseId: 'course-advanced' }],
    });
    const approval = lockMarks(h);

    expect(await approveChangeProposalGroup(ownerSession, { id: groupId, itemIds: [updated, created, access] }, h.deps))
      .toMatchObject({ ok: true, value: { status: 'applied' } });
    expect(coursesFirstLockedAfterAProduct(h, approval)).toEqual([]);
    expect([...h.transaction.courseLocks.slice(approval.courseLocks), ...h.transaction.repositoryCourseLocks.slice(approval.repositoryCourseLocks)]
      .filter((record) => record.targetLocksBefore === approval.targetLocks))
      .toEqual([{ courseIds: ['course-advanced', 'course-extra', 'course-intro'], targetLocksBefore: approval.targetLocks }]);
  });

  it('locks a course that only a product creation grants before an earlier item locks a product', async () => {
    const h = harness();
    const groupId = unwrap(await createChangeProposalGroup(keyCtx(), { title: 'Launch' }, h.deps)).id;
    const access = unwrap(await submitGroupedChangeProposal(keyCtx(), {
      groupId, operation: 'product.set-access', input: { id: 'product-guide', accessItems: [{ level: 'course', courseId: 'course-intro', excludedModuleIds: ['module-shared'] }] },
    }, h.deps)).items.at(-1)?.id ?? '';
    const dryRun = lockMarks(h);
    const created = unwrap(await submitGroupedChangeProposal(keyCtx(), {
      groupId, operation: 'product.create', input: { title: 'Starter pack', slug: 'starter-pack', type: 'digital_download', priceCents: 0, currency: 'EUR', accessItems: ADVANCED },
    }, h.deps)).items.at(-1)?.id ?? '';
    expect(coursesFirstLockedAfterAProduct(h, dryRun)).toEqual([]);
    const approval = lockMarks(h);

    expect(await approveChangeProposalGroup(ownerSession, { id: groupId, itemIds: [access, created] }, h.deps))
      .toMatchObject({ ok: true, value: { status: 'applied' } });
    expect(coursesFirstLockedAfterAProduct(h, approval)).toEqual([]);
    expect(h.transaction.courseLocks[approval.courseLocks]).toEqual({ courseIds: ['course-advanced', 'course-intro'], targetLocksBefore: approval.targetLocks });
  });
});
