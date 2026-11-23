import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CHANGE_PROPOSAL_APPROVAL_FILE_CHECKS,
  changeProposalExpiresAt,
  err,
  integrationUnavailable,
  KEY_DOWNLOAD_FILE_LIMITS,
  KEY_DOWNLOAD_STORAGE_DEADLINES,
  notFound,
  ok,
  SERVER_FUNCTION_LIMIT_MS,
  type ChangeProposal,
  type Identity,
  type KeyDownloadStagedFile,
  type Product,
} from '#core/domain/index.js';

import type { StorageProvider, TenantSecretResolver } from '../ports.js';
import { createChangeProposalStoreFake, createChangeProposalTransactionFake, emptyCatalogState } from '../testing/change-proposal-fakes.js';
import { fakeStorageSecrets } from '../testing/object-storage-fake.js';
import { previewChangeProposal } from './change-proposal-apply.js';
import { checkApprovalFiles, getChangeProposalFileLink, prepareApprovalFiles } from './change-proposal-files.js';
import { CHANGE_PROPOSAL_OPERATIONS } from './change-proposal-operations.js';

const TENANT = 'tenant-acme';
const KEY_ID = 'key-propose';
const NOW = '2026-03-01T10:00:00.000Z';

const virtualTime = () => {
  let now = Date.parse(NOW);
  const timers: Array<{ at: number; order: number; fire: () => void }> = [];
  let order = 0;
  return {
    clock: { nowIso: () => new Date(now).toISOString() },
    elapsed: () => now - Date.parse(NOW),
    after: (ms: number) => new Promise<void>((resolve) => {
      order += 1;
      timers.push({ at: now + ms, order, fire: resolve });
    }),
    run: async <T>(work: Promise<T>): Promise<T> => {
      let settled = false;
      const watched = work.finally(() => { settled = true; });
      for (;;) {
        for (let turn = 0; turn < 20; turn += 1) await new Promise<void>((resolve) => { setImmediate(resolve); });
        if (settled) return watched;
        timers.sort((left, right) => left.at - right.at || left.order - right.order);
        const next = timers.shift();
        if (next === undefined) throw new Error('Nothing left to wait for, but the work did not finish');
        now = Math.max(now, next.at);
        next.fire();
      }
    },
  };
};

const stagedFile = (index: number, proposalId: string): KeyDownloadStagedFile => ({
  tenantId: TENANT, id: `staged-${String(index)}`, apiKeyId: KEY_ID, fileName: 'workbook.pdf', contentType: 'application/pdf', sizeBytes: 10,
  sha256: 'a'.repeat(64), objectKey: `${TENANT}/product-downloads/key-files/${KEY_ID}/staged-${String(index)}/workbook.pdf`, copiedFrom: null,
  proposalId, createdAt: NOW,
});

const fileItem = (index: number): ChangeProposal => ({
  id: `proposal-${String(index)}`, tenantId: TENANT, groupId: 'group-1', groupPosition: index, operation: 'download.add',
  input: { productId: 'product-workbook', stagedFileId: `staged-${String(index)}` }, effect: {}, target: { kind: 'product', id: 'product-workbook' },
  status: 'pending', proposedByKeyId: KEY_ID, proposedByKeyName: 'Agent', proposedByIssuerUserId: 'user-owner', createdAt: NOW,
  expiresAt: changeProposalExpiresAt(NOW), decidedByUserId: null, decidedAt: null, decisionNote: null, appliedResourceId: null,
  failureCode: null, failureMessage: null,
});

const MAXIMUM_FILE_ITEMS = KEY_DOWNLOAD_FILE_LIMITS.stagedFilesPerKey;

const fileIndex = (url: string): number => Number(/staged-(\d+)\//u.exec(url)?.[1]);

const harness = (options: {
  headMs: (index: number) => number;
  findMs?: number;
  rowsGone?: boolean;
  headAnswer?: (index: number) => 'present' | 'missing' | 'unavailable';
}) => {
  const time = virtualTime();
  const items = Array.from({ length: MAXIMUM_FILE_ITEMS }, (_unused, index) => fileItem(index + 1));
  let inFlight = 0;
  let mostInFlight = 0;
  const heads: Array<{ index: number; startedAt: number; deadlineMs: number }> = [];
  const head: StorageProvider['head'] = async (input) => {
    const index = fileIndex(input.url);
    const deadlineMs = input.deadlineMs ?? Number.POSITIVE_INFINITY;
    heads.push({ index, startedAt: time.elapsed(), deadlineMs });
    inFlight += 1;
    mostInFlight = Math.max(mostInFlight, inFlight);
    const takes = options.headMs(index);
    await time.after(Math.min(takes, deadlineMs));
    inFlight -= 1;
    if (takes > deadlineMs) return err(integrationUnavailable(`No answer for file ${String(index)} before the deadline`));
    const answer = options.headAnswer?.(index) ?? 'present';
    if (answer === 'unavailable') return err(integrationUnavailable(`Storage failed for file ${String(index)}`));
    return answer === 'missing' ? err(notFound('No such object')) : ok({ sizeBytes: 10 });
  };
  const deps = {
    clock: time.clock,
    secretResolver: fakeStorageSecrets,
    keyDownloadFiles: {
      findStaged: async (_tenantId: string, _apiKeyId: string, id: string) => {
        if (options.findMs !== undefined) await time.after(options.findMs);
        const index = Number(id.replace('staged-', ''));
        return options.rowsGone === true ? null : stagedFile(index, `proposal-${String(index)}`);
      },
    },
    storage: {
      objectUrl: (_configuration, key) => new URL(`https://storage.example.test/${key}`),
      head,
    } satisfies Pick<StorageProvider, 'objectUrl' | 'head'>,
  };
  const check = () => time.run(checkApprovalFiles(TENANT, items, {
    ...deps,
    storage: { ...unusedStorage, ...deps.storage },
  }));
  return { time, items, heads, check, mostInFlight: () => mostInFlight };
};

const refuse = (): never => { throw new Error('Not part of this test'); };

const unusedStorage: StorageProvider = {
  objectUrl: refuse, delete: refuse, list: refuse, getObject: refuse, putObject: refuse, probe: refuse, copyObject: refuse,
  digestObject: refuse, probeCors: refuse, presignPut: refuse, presignGet: refuse, head: refuse, healthcheck: refuse, test: refuse,
};

describe('the file checks before an approval', () => {
  it('fits the largest group into a budget that leaves the rest of the server function to the transaction', () => {
    const limits = CHANGE_PROPOSAL_APPROVAL_FILE_CHECKS;
    expect(Math.ceil(MAXIMUM_FILE_ITEMS / limits.concurrency) * KEY_DOWNLOAD_STORAGE_DEADLINES.headMs).toBeLessThanOrEqual(limits.budgetMs);
    expect(limits.budgetMs + limits.leftForDecisionMs).toBe(SERVER_FUNCTION_LIMIT_MS);
    expect(limits.leftForDecisionMs).toBeGreaterThanOrEqual(limits.budgetMs);
  });

  it('checks a group of the maximum number of file items a few at a time, each answer taking almost its whole deadline, within the budget', async () => {
    const h = harness({ headMs: () => KEY_DOWNLOAD_STORAGE_DEADLINES.headMs - 100 });
    const checked = await h.check();
    if (!checked.ok) throw new Error(checked.error.message);
    expect(checked.value.seen.size).toBe(MAXIMUM_FILE_ITEMS);
    expect([...checked.value.seen.values()].every((file) => file !== null)).toBe(true);
    expect(h.mostInFlight()).toBe(CHANGE_PROPOSAL_APPROVAL_FILE_CHECKS.concurrency);
    expect(h.time.elapsed()).toBeLessThanOrEqual(CHANGE_PROPOSAL_APPROVAL_FILE_CHECKS.budgetMs);
    expect(h.heads.every((head) => head.deadlineMs <= KEY_DOWNLOAD_STORAGE_DEADLINES.headMs)).toBe(true);
  });

  it('answers a transient refusal with a retry time once the budget runs out, and starts no storage request after it', async () => {
    const h = harness({ headMs: () => KEY_DOWNLOAD_STORAGE_DEADLINES.headMs - 100, findMs: 2_000 });
    const checked = await h.check();
    expect(checked).toMatchObject({ ok: false, error: { code: 'unavailable', details: { retryAfterSeconds: CHANGE_PROPOSAL_APPROVAL_FILE_CHECKS.retryAfterSeconds } } });
    expect(h.heads.length).toBeLessThan(MAXIMUM_FILE_ITEMS);
    expect(h.heads.every((head) => head.startedAt + head.deadlineMs <= CHANGE_PROPOSAL_APPROVAL_FILE_CHECKS.budgetMs)).toBe(true);
    expect(h.time.elapsed()).toBeLessThanOrEqual(CHANGE_PROPOSAL_APPROVAL_FILE_CHECKS.budgetMs);
  });

  it('answers a retry, not gone files, when the staged row lookups outlast the budget', async () => {
    const { budgetMs, concurrency, minimumHeadMs } = CHANGE_PROPOSAL_APPROVAL_FILE_CHECKS;
    const rounds = Math.ceil(MAXIMUM_FILE_ITEMS / concurrency);
    const findMs = (budgetMs - minimumHeadMs) / (rounds - 1);
    expect((rounds - 1) * findMs).toBeLessThanOrEqual(budgetMs - minimumHeadMs);
    expect(rounds * findMs).toBeGreaterThan(budgetMs);
    const h = harness({ headMs: () => 100, findMs, rowsGone: true });
    expect(await h.check()).toMatchObject({ ok: false, error: { code: 'unavailable', details: { retryAfterSeconds: CHANGE_PROPOSAL_APPROVAL_FILE_CHECKS.retryAfterSeconds } } });
    expect(h.heads).toEqual([]);
  });

  describe('with a lookup that has not answered when the budget ends', () => {
    beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], now: Date.parse(NOW) }); });
    afterEach(() => { vi.useRealTimers(); });

    const settlesBy = async <T>(work: Promise<T>, ms: number): Promise<T | 'pending'> => {
      const seen: { outcome: { value: T } | null } = { outcome: null };
      void work.then((value) => { seen.outcome = { value }; });
      await vi.advanceTimersByTimeAsync(ms);
      return seen.outcome === null ? 'pending' : seen.outcome.value;
    };

    const stalled = <T>(): Promise<T> => new Promise<T>(() => undefined);

    const lateDeps = (overrides: { findStaged?: () => Promise<KeyDownloadStagedFile | null>; secretResolver?: TenantSecretResolver }) => ({
      clock: { nowIso: () => new Date().toISOString() },
      secretResolver: overrides.secretResolver ?? fakeStorageSecrets,
      keyDownloadFiles: { findStaged: overrides.findStaged ?? (async () => stagedFile(1, 'proposal-1')) },
      storage: { ...unusedStorage, objectUrl: (_configuration: unknown, key: string) => new URL(`https://storage.example.test/${key}`), head: async () => ok({ sizeBytes: 10 }) },
    });

    const outOfTime = { ok: false, error: { code: 'unavailable', details: { retryAfterSeconds: CHANGE_PROPOSAL_APPROVAL_FILE_CHECKS.retryAfterSeconds } } };

    it('answers out of time when the budget ends while a staged row read stalls', async () => {
      const checked = checkApprovalFiles(TENANT, [fileItem(1)], lateDeps({ findStaged: stalled }));
      expect(await settlesBy(checked, CHANGE_PROPOSAL_APPROVAL_FILE_CHECKS.budgetMs)).toMatchObject(outOfTime);
    });

    it('answers out of time, not the configuration error, when the configuration read ends after the budget', async () => {
      const secretResolver: TenantSecretResolver = {
        resolve: async () => {
          await new Promise((resolve) => { setTimeout(resolve, CHANGE_PROPOSAL_APPROVAL_FILE_CHECKS.budgetMs + 1_000); });
          return err(integrationUnavailable('No storage configuration'));
        },
      };
      const checked = checkApprovalFiles(TENANT, [fileItem(1)], lateDeps({ secretResolver }));
      expect(await settlesBy(checked, CHANGE_PROPOSAL_APPROVAL_FILE_CHECKS.budgetMs)).toMatchObject(outOfTime);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(await checked).toMatchObject(outOfTime);
    });
  });

  it('answers the storage failure of the first item in group order, whichever answered first', async () => {
    const h = harness({ headMs: (index) => index === 1 ? 4_000 : 100, headAnswer: (index) => index === 1 || index === 3 ? 'unavailable' : 'present' });
    expect(await h.check()).toMatchObject({ ok: false, error: { code: 'integration_unavailable', message: 'Storage failed for file 1' } });
  });

  it('attributes gone files to the first such item in group order, whichever answered first', async () => {
    const h = harness({ headMs: (index) => index === 2 ? 4_000 : 100, headAnswer: (index) => index === 2 || index === 7 ? 'missing' : 'present' });
    const checked = await h.check();
    if (!checked.ok) throw new Error(checked.error.message);
    const locked = new Map(h.items.map((item, index) => [`staged-${String(index + 1)}`, stagedFile(index + 1, item.id)]));
    const { dryRun } = createChangeProposalTransactionFake(emptyCatalogState(), createChangeProposalStoreFake());
    const prepared = await dryRun(TENANT, async (scope) => ok(await prepareApprovalFiles(TENANT, h.items, checked.value, {
      ...scope,
      repositories: { ...scope.repositories, productFiles: { ...scope.repositories.productFiles, lockStaged: async (_tenantId, _keyId, id) => locked.get(id) ?? null } },
    })));
    expect(prepared).toMatchObject({ ok: true, value: { kind: 'missing', fileId: 'staged-2', proposal: { id: 'proposal-2' } } });
  });
});

const owner: Identity = {
  userId: 'user-owner', email: 'owner@example.test', name: 'Owner', emailVerified: true, tenantAccess: 'staff',
  tenantId: TENANT, tenantSlug: 'acme', tenantName: 'Acme', staffRole: 'owner', memberId: null, image: null,
  memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
};

describe('the owner link to a proposed file', () => {
  const link = (storedSizeBytes: number) => {
    const signed: string[] = [];
    const deps = {
      clock: { nowIso: () => NOW },
      secretResolver: fakeStorageSecrets,
      changeProposals: { findById: async () => fileItem(1) },
      keyDownloadFiles: { findStaged: async () => stagedFile(1, 'proposal-1') },
      storage: {
        ...unusedStorage,
        objectUrl: (_configuration, key) => new URL(`https://storage.example.test/${key}`),
        head: async () => ok({ sizeBytes: storedSizeBytes }),
        presignGet: (input) => { signed.push(input.url); return ok(`${input.url}&signature=fake`); },
      } satisfies StorageProvider,
    };
    return { signed, answer: () => getChangeProposalFileLink({ identity: owner }, { id: 'proposal-1', fileId: 'staged-1' }, deps) };
  };

  it('signs a link to an object of the size the proposal announces', async () => {
    const h = link(10);
    expect(await h.answer()).toMatchObject({ ok: true, value: { download: { fileName: 'workbook.pdf', sizeBytes: 10 } } });
    expect(h.signed).toHaveLength(1);
  });

  it('answers the missing file and signs nothing when the stored object has another size', async () => {
    const h = link(11);
    expect(await h.answer()).toMatchObject({ ok: false, error: { code: 'not_found', message: 'No proposed file awaiting approval under this address' } });
    expect(h.signed).toEqual([]);
  });
});

const workbook: Product = {
  id: 'product-workbook', tenantId: TENANT, type: 'digital_download', slug: 'workbook', title: 'Workbook', description: '', coverUrl: null,
  priceCents: 0, currency: 'EUR', published: false, visibility: 'listed', salesChannel: 'any', deliveryMethod: 'pickup',
  accessItems: [], legacyId: null, createdAt: NOW, vatRate: null, vatExemptionBasis: null,
};

describe('a proposal dry run that changes nothing', () => {
  const preview = async (operation: 'download.remove' | 'product.update', input: Record<string, unknown>) => {
    const state = emptyCatalogState();
    state.products.push(workbook);
    const prepared = CHANGE_PROPOSAL_OPERATIONS[operation].prepare(input);
    if (!prepared.ok) throw new Error(prepared.error.message);
    const unchanged = { ...prepared.value, run: async () => ok(workbook.id) };
    const { dryRun } = createChangeProposalTransactionFake(state, createChangeProposalStoreFake());
    const deps = { clock: { nowIso: () => NOW }, ids: { nextId: () => 'id-1' }, storage: unusedStorage, logger: { error: () => undefined } };
    return dryRun(TENANT, (scope) => previewChangeProposal(unchanged, TENANT, { identity: owner }, scope, deps, null, { keyId: KEY_ID }));
  };

  it('is refused at submission for a file operation, so no proposal with an empty effect is stored', async () => {
    expect(await preview('download.remove', { productId: workbook.id, assetId: 'asset-uploading' }))
      .toMatchObject({ ok: false, error: { code: 'validation', message: expect.stringContaining('Invalid product file removal') } });
  });

  it('is still stored with an empty effect for the other operations', async () => {
    expect(await preview('product.update', { id: workbook.id, title: workbook.title })).toEqual({ ok: true, value: {} });
  });
});
