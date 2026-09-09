import { expect, it } from 'vitest';

import { marketingContactUpsertSchema, marketingContactFieldsSchema } from './marketing-contact.js';
import { marketingImportRowSchema } from './marketing-contact-import.js';

it('normalizes before email validation and retains first and last names separately', () => {
  expect(marketingContactUpsertSchema.parse({ email: ' A.B+Launch@Example.Test ', firstName: ' Anna ', lastName: ' Example ' })).toEqual({ email: 'a.b+launch@example.test', firstName: 'Anna', lastName: 'Example' });
  expect(marketingContactFieldsSchema.safeParse({ email: 'other@example.test' }).success).toBe(false);
});
it('bounds tags and rejects embedded pipe tokens', () => {
  expect(marketingContactUpsertSchema.safeParse({ email: 'a@example.test', tags: ['one|two'] }).success).toBe(false);
  expect(marketingContactUpsertSchema.safeParse({ email: 'a@example.test', tags: Array.from({ length: 51 }, (_, i) => String(i)) }).success).toBe(false);
});
it('normalizes timezone evidence and rejects timestamps without a timezone', () => {
  expect(marketingImportRowSchema.parse({ email: 'a@example.test', consentAt: '2024-05-06T14:00:00+02:00' }).consentAt).toBe('2024-05-06T12:00:00.000Z');
  expect(marketingImportRowSchema.safeParse({ email: 'a@example.test', consentAt: '2024-05-06T12:00:00' }).success).toBe(false);
});
