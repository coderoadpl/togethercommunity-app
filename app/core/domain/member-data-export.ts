import { z } from 'zod';

import { memberCourseProgressSchema } from './course.js';
import { memberGrantSchema } from './grant.js';
import { invoiceSchema } from './invoice.js';
import { isoDateTimeSchema, marketingConsentSchema } from './marketing-email.js';
import { memberSubscriptionSchema, orderSchema } from './commerce.js';
import { termsConsentSchema } from './consent.js';
import { postContextKindSchema } from './community.js';

export const memberDataExportSchema = z.object({
  formatVersion: z.literal(1),
  exportedAt: isoDateTimeSchema,
  tenant: z.object({
    id: z.string(),
    slug: z.string().nullable(),
    name: z.string().nullable(),
  }),
  profile: z.object({
    memberId: z.string(),
    email: z.string().email(),
    displayName: z.string().nullable(),
    tags: z.array(z.string()),
    marketingConsents: z.record(z.boolean()),
    externalCustomerIds: z.record(z.string()),
    createdAt: z.string(),
  }),
  consents: z.object({
    terms: z.array(termsConsentSchema),
    marketing: z.array(marketingConsentSchema),
  }),
  grants: z.array(memberGrantSchema),
  subscriptions: z.array(memberSubscriptionSchema),
  orders: z.array(orderSchema),
  invoices: z.array(invoiceSchema),
  courseProgress: z.array(memberCourseProgressSchema),
  posts: z.array(
    z.object({
      id: z.string(),
      contextKind: postContextKindSchema,
      contextId: z.string(),
      body: z.string(),
      createdAt: z.string().datetime(),
      editedAt: z.string().datetime().nullable(),
      deletedAt: z.string().datetime().nullable(),
    }),
  ),
});

export type MemberDataExport = z.output<typeof memberDataExportSchema>;
