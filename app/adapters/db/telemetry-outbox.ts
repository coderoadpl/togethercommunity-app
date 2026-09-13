import { and, asc, eq, inArray, lte, or, sql } from 'drizzle-orm';

import { TELEMETRY_LIMITS, telemetryEventSchema, telemetryStoreSettingsSchema, telemetrySyncSchema, type TelemetryEvent } from '#core/domain/telemetry.js';
import type { TelemetryOutbox, TelemetrySettingsRepository } from '#core/server/telemetry/ports.js';

import type { Db } from './client.js';
import { telemetryAccounting, telemetryConnections, telemetryOutbox } from './telemetry-schema.js';

const emptySettings = () => telemetryStoreSettingsSchema.parse({ provider: null, region: '', connectedAt: null, lastProbeAt: null, lastProbeResult: null, egressMode: 'unknown' });
export const createTelemetrySettingsRepository = (db: Db): TelemetrySettingsRepository => ({
  get: async (tenantId) => {
    const [row] = await db.select().from(telemetryConnections).where(eq(telemetryConnections.tenantId, tenantId));
    return row === undefined ? emptySettings() : telemetryStoreSettingsSchema.parse(row.settings);
  },
  save: async (tenantId, settings) => {
    await db.insert(telemetryConnections).values({ tenantId, settings: telemetryStoreSettingsSchema.parse(settings) })
      .onConflictDoUpdate({ target: telemetryConnections.tenantId, set: { settings } });
  },
});

const reservedTypes = new Set<TelemetryEvent['type']>(['bounced', 'complained', 'unsubscribed', 'suppressed']);
const globalPendingBytes = sql`(select coalesce(sum(accounting.pending_bytes), 0) from ${telemetryAccounting} accounting)`;
const recordGap = async (db: Db, occurredAt: string, tenantId: string, events: number) => {
  await db.update(telemetryAccounting).set({
    gapCount: sql`least(2147483647, ${telemetryAccounting.gapCount}::bigint + ${events})`,
    gapFrom: sql`least(coalesce(${telemetryAccounting.gapFrom}, ${occurredAt}::timestamptz), ${occurredAt}::timestamptz)`,
    gapThrough: sql`greatest(coalesce(${telemetryAccounting.gapThrough}, ${occurredAt}::timestamptz), ${occurredAt}::timestamptz)`,
  }).where(eq(telemetryAccounting.tenantId, tenantId));
};

export const appendTelemetry = async (db: Db, event: TelemetryEvent): Promise<void> => {
  const parsed = telemetryEventSchema.parse(event);
  const settings = await createTelemetrySettingsRepository(db).get(parsed.tenantId);
  if (settings.provider === null) return;
  const [duplicate] = await db.select({ sequence: telemetryOutbox.sequence }).from(telemetryOutbox)
    .where(and(eq(telemetryOutbox.tenantId, parsed.tenantId), eq(telemetryOutbox.eventId, parsed.id)));
  if (duplicate !== undefined) return;
  await db.insert(telemetryAccounting).values({ tenantId: parsed.tenantId, lastAcknowledgedSequence: 0 }).onConflictDoNothing();
  // JSON length omits heap and index allocation, so admission also reserves page slack.
  const chargedBytes = Buffer.byteLength(JSON.stringify(parsed), 'utf8') * 4 + 2048;
  // Headroom above the admission thresholds stays reserved for the feedback that closes out sends already dispatched.
  const reserved = reservedTypes.has(parsed.type);
  const tenantLimit = reserved ? TELEMETRY_LIMITS.tenantBytes : TELEMETRY_LIMITS.tenantAdmissionBytes;
  const globalLimit = reserved ? TELEMETRY_LIMITS.globalBytes : TELEMETRY_LIMITS.globalAdmissionBytes;
  // Charging the tenant row before the insert keeps per-tenant sequence order equal to commit order, which acknowledge() deletes by.
  const admitted = await db.update(telemetryAccounting)
    .set({ pendingBytes: sql`${telemetryAccounting.pendingBytes} + ${chargedBytes}` })
    .where(and(
      eq(telemetryAccounting.tenantId, parsed.tenantId),
      sql`${telemetryAccounting.pendingBytes} + ${chargedBytes} <= ${tenantLimit}`,
      sql`${globalPendingBytes} + ${chargedBytes} <= ${globalLimit}`,
    )).returning({ tenantId: telemetryAccounting.tenantId });
  if (admitted.length === 0) {
    await recordGap(db, parsed.occurredAt, parsed.tenantId, 1);
    return;
  }
  const inserted = await db.insert(telemetryOutbox)
    .values({ tenantId: parsed.tenantId, eventId: parsed.id, event: parsed, chargedBytes, createdAt: parsed.ingestedAt, retryAt: parsed.ingestedAt })
    .onConflictDoNothing({ target: [telemetryOutbox.tenantId, telemetryOutbox.eventId] }).returning({ sequence: telemetryOutbox.sequence });
  if (inserted.length === 0) {
    await db.update(telemetryAccounting).set({ pendingBytes: sql`greatest(0, ${telemetryAccounting.pendingBytes} - ${chargedBytes})` })
      .where(eq(telemetryAccounting.tenantId, parsed.tenantId));
  }
};

export const eraseTelemetrySubject = async (db: Db, tenantId: string, subject: { contactIds: string[]; memberIds: string[] }): Promise<void> => {
  const subjects = [
    ...(subject.contactIds.length === 0 ? [] : [inArray(sql`${telemetryOutbox.event}->>'contactId'`, subject.contactIds)]),
    ...(subject.memberIds.length === 0 ? [] : [inArray(sql`${telemetryOutbox.event}->>'memberId'`, subject.memberIds)]),
  ];
  if (subjects.length === 0) return;
  const removed = await db.delete(telemetryOutbox)
    .where(and(eq(telemetryOutbox.tenantId, tenantId), or(...subjects)))
    .returning({ bytes: telemetryOutbox.chargedBytes });
  if (removed.length === 0) return;
  await db.update(telemetryAccounting)
    .set({ pendingBytes: sql`greatest(0, ${telemetryAccounting.pendingBytes} - ${removed.reduce((sum, row) => sum + row.bytes, 0)})` })
    .where(eq(telemetryAccounting.tenantId, tenantId));
};

const iso = (value: string | null | undefined) => value == null ? null : new Date(value).toISOString();
export const createTelemetryOutbox = (db: Db): TelemetryOutbox => ({
  pending: async (tenantId, now, limit) => {
    const rows = await db.select().from(telemetryOutbox).where(eq(telemetryOutbox.tenantId, tenantId)).orderBy(asc(telemetryOutbox.sequence)).limit(Math.min(500, limit));
    const ready = [];
    for (const row of rows) {
      if (Date.parse(row.retryAt) > Date.parse(now)) break;
      ready.push({ sequence: row.sequence, attempts: row.attempts, event: telemetryEventSchema.parse(row.event) });
    }
    return ready;
  },
  acknowledge: async (tenantId, throughSequence, at) => db.transaction(async (tx) => {
    const removed = await tx.delete(telemetryOutbox).where(and(eq(telemetryOutbox.tenantId, tenantId), lte(telemetryOutbox.sequence, throughSequence))).returning({ bytes: telemetryOutbox.chargedBytes });
    await tx.update(telemetryAccounting).set({
      pendingBytes: sql`greatest(0, ${telemetryAccounting.pendingBytes} - ${removed.reduce((sum, row) => sum + row.bytes, 0)})`,
      lastAcknowledgedSequence: sql`greatest(${telemetryAccounting.lastAcknowledgedSequence}, ${throughSequence})`, lastAcknowledgedAt: at,
    }).where(eq(telemetryAccounting.tenantId, tenantId));
  }),
  discard: async (tenantId) => db.transaction(async (tx) => {
    const removed = await tx.delete(telemetryOutbox).where(eq(telemetryOutbox.tenantId, tenantId))
      .returning({ occurredAt: sql<string>`${telemetryOutbox.event}->>'occurredAt'` });
    await tx.update(telemetryAccounting).set({ pendingBytes: 0 }).where(eq(telemetryAccounting.tenantId, tenantId));
    const oldest = removed.map((row) => row.occurredAt).sort().at(0);
    if (oldest !== undefined) await recordGap(tx, oldest, tenantId, removed.length);
  }),
  retry: async (tenantId, throughSequence, retryAt) => {
    await db.update(telemetryOutbox).set({ retryAt, attempts: sql`least(${telemetryOutbox.attempts} + 1, 30)` })
      .where(and(eq(telemetryOutbox.tenantId, tenantId), lte(telemetryOutbox.sequence, throughSequence)));
  },
  status: async (tenantId, now) => {
    const [row] = await db.select().from(telemetryAccounting).where(eq(telemetryAccounting.tenantId, tenantId));
    const [oldest] = await db.select({ at: sql<string | null>`min(${telemetryOutbox.createdAt})` }).from(telemetryOutbox).where(eq(telemetryOutbox.tenantId, tenantId));
    const [global] = await db.select({ bytes: sql<number>`coalesce(sum(${telemetryAccounting.pendingBytes}), 0)::int` }).from(telemetryAccounting);
    return telemetrySyncSchema.parse({
      lastAcknowledgedSequence: row?.lastAcknowledgedSequence ?? 0, lastAcknowledgedAt: iso(row?.lastAcknowledgedAt),
      pendingBytes: row?.pendingBytes ?? 0, oldestPendingAt: iso(oldest?.at), gapCount: row?.gapCount ?? 0,
      oldestPendingAgeSeconds: oldest?.at == null ? null : Math.max(0, Math.floor((Date.parse(now) - Date.parse(oldest.at)) / 1000)),
      admissionPaused: (row?.pendingBytes ?? 0) >= TELEMETRY_LIMITS.tenantAdmissionBytes || (global?.bytes ?? 0) >= TELEMETRY_LIMITS.globalAdmissionBytes || (oldest?.at != null && Date.parse(now) - Date.parse(oldest.at) >= TELEMETRY_LIMITS.oldestPendingMs),
    });
  },
});

export const listTelemetryTenants = async (db: Db): Promise<string[]> => (await db.select({ tenantId: telemetryConnections.tenantId }).from(telemetryConnections).where(sql`${telemetryConnections.settings}->>'provider' = 'mongodb'`)).map((row) => row.tenantId);
