import { describe, expect, it, vi } from 'vitest';

import { type Identity, ok, err, validation, type TenantSecret } from '#core/domain/index.js';
import { telemetryStoreViewSchema, telemetryEventSchema } from '#core/domain/telemetry.js';

import { telemetryReportsHidden, connectTelemetryStore, disconnectTelemetryStore, getTelemetryStore, probeTelemetryStore, type TelemetryStoreDeps } from './telemetry-store.js';
import { drainTelemetry } from '../telemetry/drain.js';

const at = '2026-09-13T10:00:00.000Z';
const deadline = '2026-09-13T10:00:50.000Z';
const pendingEvent = telemetryEventSchema.parse({ version: 1, id: 'v1:retry', tenantId: 'tenant', campaignId: 'campaign', contactId: 'contact', memberId: null, sendId: 'send', sesMessageId: null, occurredAt: at, ingestedAt: at, type: 'opened', bounceClassification: null, complaintType: null, linkId: null, destination: null, trackingPolicyVersion: '1', activityType: null, orderId: null });
const ctx = (staffRole: 'owner' | 'admin' = 'owner') : { identity: Identity } => ({ identity: { userId: 'user', email: 'user@example.test', name: 'User', emailVerified: true, tenantAccess: 'staff', tenantId: 'tenant', tenantSlug: 'acme', tenantName: 'Acme', staffRole, memberId: null, image: null, memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false } });
const setup = () => {
  const initial = telemetryStoreViewSchema.parse({ settings: { provider: null, region: '', connectedAt: null, lastProbeAt: null, lastProbeResult: null, egressMode: 'unknown' }, egress: { mode: 'unknown', ip: null }, sync: { lastAcknowledgedSequence: 0, lastAcknowledgedAt: null, pendingBytes: 0, oldestPendingAt: null, gapCount: 0, admissionPaused: false }, hidesStatistics: true });
  let settings = initial.settings;
  let secret: TenantSecret | null = null;
  const probe = vi.fn(async () => ok(undefined));
  const appendBatch = vi.fn(async () => undefined);
  const deps: TelemetryStoreDeps = {
    settings: { get: async () => settings, save: async (_tenantId, value) => { settings = value; } },
    outbox: { pending: async () => [], acknowledge: vi.fn(), retry: vi.fn(), discard: vi.fn(), status: async () => initial.sync },
    stores: { open: () => ({ probe, appendBatch, close: vi.fn(), deleteSubject: vi.fn(), campaignStats: async () => [], contactTimeline: async () => ({ events: [], nextCursor: null }), bounceComplaints: async () => ({ events: [], nextCursor: null }) }) },
    secrets: { listByTenant: async () => secret === null ? [] : [secret], findByKey: async () => secret, upsert: async (_tenantId, row) => { secret = row; return row; }, delete: async () => { secret = null; return true; } },
    crypto: { encrypt: () => ({ ciphertext: 'encrypted', iv: 'iv', authTag: 'tag' }), decrypt: () => ok('mongodb://user:pass@example.test/analytics') },
    clock: { nowIso: () => at }, ids: { nextId: () => 'secret-id' }, egress: async () => initial.egress, hidesStatistics: true,
  };
  return { deps, probe, appendBatch };
};
describe('telemetry configuration', () => {
  it('requires settings write capability before probing or storing credentials', async () => {
    const { deps, probe } = setup();
    expect((await connectTelemetryStore(ctx('admin'), {}, deps)).ok).toBe(false);
    expect((await probeTelemetryStore(ctx('admin'), deps)).ok).toBe(false);
    expect((await disconnectTelemetryStore(ctx('admin'), deps)).ok).toBe(false);
    expect(probe).not.toHaveBeenCalled();
  });
  it('probes before encrypting, returns no credentials and disconnects without remote deletion', async () => {
    const { deps } = setup();
    const connected = await connectTelemetryStore(ctx(), { connectionString: 'mongodb://user:password@example.test/analytics', region: 'EU' }, deps);
    expect(connected).toMatchObject({ ok: true, value: { settings: { provider: 'mongodb' }, hidesStatistics: false } });
    expect(JSON.stringify(connected)).not.toMatch(/password|ciphertext|connectionString/);
    expect(await deps.secrets.findByKey('tenant', 'telemetry.mongodb')).toMatchObject({ ciphertext: 'encrypted', maskedPreview: '••••' });
    expect((await probeTelemetryStore(ctx(), deps)).ok).toBe(true);
    expect(await disconnectTelemetryStore(ctx(), deps)).toMatchObject({ ok: true, value: { hidesStatistics: true } });
    expect(await deps.secrets.findByKey('tenant', 'telemetry.mongodb')).toBeNull();
  });
  it('applies report availability only to the authenticated tenant and enabled flag', async () => {
    const { deps } = setup();
    expect(await telemetryReportsHidden(ctx(), deps)).toEqual(ok(true));
    expect(await telemetryReportsHidden(ctx(), { ...deps, hidesStatistics: false })).toEqual(ok(false));
    await connectTelemetryStore(ctx(), { connectionString: 'mongodb://user:password@example.test/analytics', region: 'EU' }, deps);
    expect(await telemetryReportsHidden(ctx(), deps)).toEqual(ok(false));
  });
  it('keeps existing tenants unchanged when the flag is disabled', async () => {
    const { deps } = setup();
    expect(await getTelemetryStore(ctx(), { ...deps, hidesStatistics: false })).toMatchObject({ ok: true, value: { hidesStatistics: false } });
  });
  it('does not activate a failed probe', async () => {
    const { deps } = setup();
    const store = deps.stores.open('tenant', 'unused');
    deps.stores.open = () => ({ ...store, probe: async () => err(validation('failed')) });
    expect((await connectTelemetryStore(ctx(), { connectionString: 'mongodb://user:password@example.test/analytics', region: 'EU' }, deps)).ok).toBe(false);
    expect((await deps.settings.get('tenant')).provider).toBeNull();
  });
  it('leaves disconnected tenants out of the drain', async () => {
    const { deps, appendBatch } = setup();
    await drainTelemetry('tenant', { ...deps, random: () => 0.5, deadlineAt: deadline });
    expect(appendBatch).not.toHaveBeenCalled();
  });
  it('releases buffered rows and their reservation on disconnect', async () => {
    const { deps } = setup();
    await connectTelemetryStore(ctx(), { connectionString: 'mongodb://user:password@example.test/analytics', region: 'EU' }, deps);
    await disconnectTelemetryStore(ctx(), deps);
    expect(deps.outbox.discard).toHaveBeenCalledWith('tenant');
  });
  it('drains a tenant until the buffer is empty within one pass', async () => {
    const { deps, appendBatch } = setup();
    await connectTelemetryStore(ctx(), { connectionString: 'mongodb://user:password@example.test/analytics', region: 'EU' }, deps);
    let remaining = 3;
    deps.outbox.pending = async () => remaining-- > 0 ? [{ sequence: 10 - remaining, attempts: 0, event: pendingEvent }] : [];
    await drainTelemetry('tenant', { ...deps, random: () => 0.5, deadlineAt: deadline });
    expect(appendBatch).toHaveBeenCalledTimes(3);
    expect(deps.outbox.acknowledge).toHaveBeenLastCalledWith('tenant', 10, at);
  });
  it('backs off a failed batch without acknowledging or invoking delivery', async () => {
    const { deps, appendBatch } = setup();
    await connectTelemetryStore(ctx(), { connectionString: 'mongodb://user:password@example.test/analytics', region: 'EU' }, deps);
    let delivered = false;
    deps.outbox.pending = async () => delivered ? [] : [{ sequence: 8, attempts: 20, event: pendingEvent }];
    appendBatch.mockRejectedValueOnce(new Error('Destination unavailable'));
    await drainTelemetry('tenant', { ...deps, random: () => 1, deadlineAt: deadline });
    expect(deps.outbox.acknowledge).not.toHaveBeenCalled();
    expect(deps.outbox.retry).toHaveBeenCalledWith('tenant', 8, '2026-09-13T10:15:00.000Z');
    deps.outbox.acknowledge = vi.fn(async () => { delivered = true; });
    await drainTelemetry('tenant', { ...deps, random: () => 0, deadlineAt: deadline });
    expect(deps.outbox.acknowledge).toHaveBeenCalledWith('tenant', 8, at);
    expect(appendBatch).toHaveBeenCalledTimes(2);
  });

});
