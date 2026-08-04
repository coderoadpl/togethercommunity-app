import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const appRoot = join(import.meta.dirname, '..');
const doctrine = readFileSync(join(appRoot, 'docs', 'data-atomicity.md'), 'utf8');
const ports = readFileSync(join(appRoot, 'core', 'server', 'ports.ts'), 'utf8');
const vercelConfig: unknown = JSON.parse(readFileSync(join(appRoot, 'vercel.json'), 'utf8'));

const cronPaths = (): string[] => {
  if (
    typeof vercelConfig !== 'object'
    || vercelConfig === null
    || !('crons' in vercelConfig)
    || !Array.isArray(vercelConfig.crons)
  ) throw new Error('vercel.json crons array is missing');
  return vercelConfig.crons.map((entry: unknown) => {
    if (
      typeof entry !== 'object'
      || entry === null
      || !('path' in entry)
      || typeof entry.path !== 'string'
    ) throw new Error('vercel.json cron path is invalid');
    return entry.path;
  });
};

const entries = (): Array<{ interfaceName: string; methodName: string }> => {
  const block = /<!-- MUST-ATOMIC:begin -->([\s\S]*?)<!-- MUST-ATOMIC:end -->/.exec(doctrine);
  if (block?.[1] === undefined) throw new Error('MUST-ATOMIC block is missing');
  return [...block[1].matchAll(/`([A-Z][A-Za-z0-9]+)\.([a-zA-Z0-9]+)`/g)].map(
    (match) => ({
      interfaceName: match[1] ?? '',
      methodName: match[2] ?? '',
    }),
  );
};

const interfaceBody = (interfaceName: string): string => {
  const start = ports.indexOf(`export interface ${interfaceName}`);
  if (start < 0) throw new Error(`interface ${interfaceName} is missing`);
  const openingBrace = ports.indexOf('{', start);
  let depth = 0;
  for (let index = openingBrace; index < ports.length; index += 1) {
    const character = ports[index];
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return ports.slice(openingBrace + 1, index);
    }
  }
  throw new Error(`interface ${interfaceName} is unterminated`);
};

describe('MUST-ATOMIC port inventory', () => {
  it('is non-empty and contains the money, outbox, and tenant creation boundaries', () => {
    const names = entries().map(
      ({ interfaceName, methodName }) => `${interfaceName}.${methodName}`,
    );

    expect(names).toContain('InvoiceRepository.createFrozenKsef');
    expect(names).toContain('CouponRedemptionRepository.createOrderAndClaim');
    expect(names).toContain('EmailOutboxRepository.enqueue');
    expect(names).toContain('TenantRepository.createTenantWithOwnerGrant');
  });

  it.each(entries().map(({ interfaceName, methodName }) => [interfaceName, methodName]))(
    '%s.%s remains one method on its port',
    (interfaceName, methodName) => {
      const escaped = methodName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const occurrences = [
        ...interfaceBody(interfaceName).matchAll(
          new RegExp(`\\b${escaped}(?:<[^;]+?>)?\\??\\s*\\(`, 'g'),
        ),
      ].length;

      expect(occurrences).toBe(1);
    },
  );
});

describe('durable queue cron inventory', () => {
  it.each([
    ['email-outbox', '/api/internal/dispatch-email'],
    ['ksef-jobs', '/api/internal/dispatch-ksef'],
    ['marketing-jobs', '/api/internal/marketing/tick'],
    ['auto-invoice-jobs', '/api/internal/dispatch-auto-invoices'],
  ])('%s has a Vercel cron entry', (_queue, path) => {
    expect(cronPaths()).toContain(path);
  });
});
