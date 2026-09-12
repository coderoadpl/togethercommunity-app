import { and, eq } from 'drizzle-orm';

import type { Db } from './client.js';
import { consentConfirmationTokens, marketingConsents } from './schema.js';

export const signupConfirmationToken = async (db: Db, tenantId: string, consentId: string): Promise<string> => {
  const [row] = await db.select().from(consentConfirmationTokens).where(and(eq(consentConfirmationTokens.tenantId, tenantId), eq(consentConfirmationTokens.marketingConsentRowId, consentId)));
  if (row === undefined) throw new Error('Missing signup confirmation token');
  return row.token;
};
export const purgeSignupTestEvidence = async (db: Db, tenantId: string, definitionId: string): Promise<void> => {
  await db.delete(marketingConsents).where(and(eq(marketingConsents.tenantId, tenantId), eq(marketingConsents.definitionId, definitionId)));
};
