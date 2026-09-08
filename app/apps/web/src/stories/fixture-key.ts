import { z } from 'zod';

export const fixtureSchema = z.object({
  scenario: z.string(),
  principal: z.string(),
  tenant: z.string(),
  route: z.string(),
  calls: z.record(z.unknown()),
  pending: z.array(z.object({ call: z.string(), queryKeys: z.array(z.array(z.unknown())) })).default([]),
  expectedErrors: z.record(z.string()).default({}),
}).superRefine((fixture, context) => {
  for (const key of [...fixture.pending.map((entry) => entry.call), ...Object.keys(fixture.expectedErrors)]) {
    if (!Object.hasOwn(fixture.calls, key)) context.addIssue({ code: z.ZodIssueCode.custom, message: `Unrecorded fixture expectation ${key}` });
  }
  for (const [key, code] of Object.entries(fixture.expectedErrors)) {
    if (!z.object({ ok: z.literal(false), error: z.object({ code: z.literal(code) }) }).safeParse(fixture.calls[key]).success) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `Expected fixture error ${code} for ${key}` });
    }
  }
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
