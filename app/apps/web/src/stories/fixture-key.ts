import { z } from 'zod';

export const fixtureSchema = z.object({
  scenario: z.string(),
  principal: z.string(),
  tenant: z.string(),
  route: z.string(),
  calls: z.record(z.unknown()),
  pending: z.array(z.string()).default([]),
});
export type Fixture = z.infer<typeof fixtureSchema>;

export const canonicalJson = (value: unknown): string => JSON.stringify(value, (_key, entry: unknown) => {
  if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
    return Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b, 'en')));
  }
  return entry;
});

export const fixtureKey = (method: string, args: unknown[]): string =>
  `${method}:${canonicalJson(args.filter((arg) => arg !== undefined && !(arg instanceof AbortSignal)))}`;
