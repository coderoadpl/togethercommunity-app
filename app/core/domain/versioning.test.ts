import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { SNAPSHOT_FIXTURES } from './snapshots/fixtures.js';
import {
  CURRENT_SNAPSHOT_SCHEMA_VERSION,
  ENTITY_KINDS,
  SNAPSHOT_CURRENT_SCHEMAS,
  SNAPSHOT_LIVE_ENTITY_SCHEMAS,
  STORED_ENTITY_SHAPE_HASH,
  buildSnapshot,
  entityShapeHash,
  readSnapshot,
  runUpcastChain,
  shapeGuardInstructions,
  snapshotPayloadsEqual,
  type EntityKind,
} from './versioning.js';

describe('content versioning enforcement', () => {
  it.each(ENTITY_KINDS)('keeps a fixture for every historical version of %s', (kind) => {
    const current = CURRENT_SNAPSHOT_SCHEMA_VERSION[kind];
    for (let version = 1; version <= current; version += 1) {
      expect(
        SNAPSHOT_FIXTURES[kind][version],
        `Missing fixture for ${kind} schemaVersion ${version}`,
      ).toBeDefined();
    }
  });

  it.each(ENTITY_KINDS)('has a fixture for the CURRENT version of %s', (kind) => {
    expect(SNAPSHOT_FIXTURES[kind][CURRENT_SNAPSHOT_SCHEMA_VERSION[kind]]).toBeDefined();
  });

  it.each(ENTITY_KINDS)('upcasts every %s fixture through the chain into the current schema', (kind) => {
    for (const [version, payload] of Object.entries(SNAPSHOT_FIXTURES[kind])) {
      const result = readSnapshot(kind, { schemaVersion: Number(version), payload });
      expect(result.ok, `Fixture ${kind} v${version} failed to upcast: ${result.ok ? '' : result.error.message}`).toBe(true);
      if (result.ok) {
        expect(result.value.schemaVersion).toBe(CURRENT_SNAPSHOT_SCHEMA_VERSION[kind]);
      }
    }
  });

  it.each(ENTITY_KINDS)('guards the live %s shape against silent changes', (kind) => {
    const liveHash = entityShapeHash(SNAPSHOT_LIVE_ENTITY_SCHEMAS[kind]);
    const currentFrozenHash = entityShapeHash(SNAPSHOT_CURRENT_SCHEMAS[kind]);
    // The frozen current schema must track the live entity exactly.
    expect(currentFrozenHash, shapeGuardInstructions(kind)).toBe(liveHash);
    // ...and both must equal the committed tripwire value.
    expect(liveHash, `${shapeGuardInstructions(kind)}\n\nComputed hash: ${liveHash}`).toBe(
      STORED_ENTITY_SHAPE_HASH[kind],
    );
  });
});

describe('upcaster chain runner', () => {
  const kinds: EntityKind[] = [...ENTITY_KINDS];

  it('is a no-op when already at the current version', () => {
    for (const kind of kinds) {
      const payload = SNAPSHOT_FIXTURES[kind][CURRENT_SNAPSHOT_SCHEMA_VERSION[kind]];
      const result = runUpcastChain(kind, CURRENT_SNAPSHOT_SCHEMA_VERSION[kind], payload);
      expect(result.ok && result.value).toEqual(payload);
    }
  });

  it('rejects a snapshot newer than the current version', () => {
    const result = runUpcastChain('course', CURRENT_SNAPSHOT_SCHEMA_VERSION.course + 1, {});
    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('repairs legacy provider embeds while preserving restorable snapshots', () => {
    const payload = SNAPSHOT_FIXTURES.course_lesson[3];
    const result = readSnapshot('course_lesson', { schemaVersion: 3, payload });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lesson = SNAPSHOT_CURRENT_SCHEMAS.course_lesson.parse(result.value.payload);
    expect(lesson.contents.filter((block: { type: string }) => block.type === 'embed')).toEqual([
      { type: 'embed', embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' },
      { type: 'embed', embedUrl: 'https://player.vimeo.com/video/76979871' },
      { type: 'embed', embedUrl: 'https://www.youtube-nocookie.com/embed/jfKfPfyJRdk' },
      { type: 'embed', embedUrl: 'https://player.vimeo.com/video/76979871' },
      { type: 'embed', embedUrl: 'https://player.vimeo.com/video/76979871?h=abc123' },
      {
        type: 'embed',
        embedUrl:
          'https://legacy-embed.invalid/?url=https%3A%2F%2Fwww.youtube.com%2Fembed%2Fvideoseries%3Flist%3DPLabc',
      },
    ]);
  });

  it('parks unsafe legacy document and link URLs on an invalid host', () => {
    const result = readSnapshot('course_lesson', {
      schemaVersion: 5,
      payload: {
        id: 'lesson-legacy',
        tenantId: 'tenant-fixture',
        name: 'Legacy materials',
        isPreview: false,
        contents: [
          { type: 'pdf', pdfUrl: 'javascript:alert(1)' },
          { type: 'link', url: 'https://docs.example.test/guide' },
        ],
        legacyId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lesson = SNAPSHOT_CURRENT_SCHEMAS.course_lesson.parse(result.value.payload);
    expect(lesson.contents).toEqual([
      { type: 'pdf', pdfUrl: 'https://legacy-document.invalid/?url=javascript%3Aalert(1)' },
      { type: 'link', url: 'https://docs.example.test/guide' },
    ]);
  });

  it('composes multiple registered upcasters in order (synthetic registry)', () => {
    type Step = (payload: unknown) => unknown;
    const registry: Record<number, Step> = {
      1: (payload) => ({ ...z.object({ n: z.number() }).parse(payload), from: 1 }),
      2: (payload) => ({ ...z.object({ n: z.number(), from: z.number() }).parse(payload), n: 99 }),
    };
    const run = (from: number, target: number, payload: unknown): unknown => {
      let current = payload;
      for (let v = from; v < target; v += 1) {
        const step = registry[v];
        if (!step) throw new Error(`missing ${v}`);
        current = step(current);
      }
      return current;
    };
    expect(run(1, 3, { n: 1 })).toEqual({ n: 99, from: 1 });
  });

  it('rejects a payload that does not match the current schema after upcasting', () => {
    const result = readSnapshot('course', { schemaVersion: 1, payload: { id: 'x' } });
    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
  });
});

describe('buildSnapshot', () => {
  it('stamps the current schema version and validates the entity', () => {
    const currentVersion = CURRENT_SNAPSHOT_SCHEMA_VERSION.course;
    const entity = SNAPSHOT_FIXTURES.course[currentVersion];
    const result = buildSnapshot('course', entity);
    expect(result).toMatchObject({ ok: true, value: { schemaVersion: currentVersion } });
  });

  it('fails internally when the entity does not match the current schema', () => {
    const result = buildSnapshot('product', { id: 'p1' });
    expect(result).toMatchObject({ ok: false, error: { code: 'internal' } });
  });
});

describe('snapshotPayloadsEqual', () => {
  it('treats objects with different key order as equal', () => {
    expect(
      snapshotPayloadsEqual(
        { title: 'A', priceCents: 100, nested: { b: 2, a: 1 } },
        { nested: { a: 1, b: 2 }, priceCents: 100, title: 'A' },
      ),
    ).toBe(true);
  });

  it('distinguishes payloads that differ in a value', () => {
    expect(snapshotPayloadsEqual({ title: 'A' }, { title: 'B' })).toBe(false);
  });

  it('keeps array order significant', () => {
    expect(snapshotPayloadsEqual({ ids: ['a', 'b'] }, { ids: ['b', 'a'] })).toBe(false);
  });

  it('ignores explicitly undefined properties', () => {
    expect(snapshotPayloadsEqual({ title: 'A', legacyId: undefined }, { title: 'A' })).toBe(true);
  });

  it('distinguishes null from a missing property', () => {
    expect(snapshotPayloadsEqual({ title: 'A', legacyId: null }, { title: 'A' })).toBe(false);
  });
});
