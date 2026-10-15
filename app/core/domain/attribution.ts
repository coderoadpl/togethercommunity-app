import { z } from 'zod';

export const attributionFields = {
  utmSource: 'utm_source',
  utmMedium: 'utm_medium',
  utmCampaign: 'utm_campaign',
  utmContent: 'utm_content',
  utmTerm: 'utm_term',
  fbclid: 'fbclid',
  gclid: 'gclid',
} as const;

const field = (pattern: RegExp) => z.string().trim().min(1).max(200).regex(pattern).optional().catch(undefined);
const utm = field(/^[A-Za-z0-9._~:/+=@ -]+$/);
const clickId = field(/^[A-Za-z0-9._-]+$/);
const fields = { utmSource: utm, utmMedium: utm, utmCampaign: utm, utmContent: utm, utmTerm: utm, fbclid: clickId, gclid: clickId };

export const attributionSchema = z.object(fields).catch({}).optional().transform((value) => {
  if (value === undefined) return undefined;
  const present = Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
  return Object.keys(present).length === 0 ? undefined : z.object(fields).parse(present);
});
export type Attribution = NonNullable<z.output<typeof attributionSchema>>;
export const orderAttributionSchema = z.object({ ...fields, capturedAt: z.string().datetime() });
export type OrderAttribution = z.output<typeof orderAttributionSchema>;

export const attributionFromSearchParams = (params: URLSearchParams): Attribution | undefined =>
  attributionSchema.parse(Object.fromEntries(Object.entries(attributionFields).map(([fieldName, parameter]) => [fieldName, params.get(parameter) ?? undefined])));

export const attributionToSearchParams = (attribution: Attribution | undefined): URLSearchParams => {
  const params = new URLSearchParams();
  if (attribution === undefined) return params;
  const values = z.record(z.string().optional()).parse(attribution);
  for (const [fieldName, parameter] of Object.entries(attributionFields)) {
    const value = values[fieldName];
    if (value !== undefined) params.set(parameter, value);
  }
  return params;
};

export const attributionFromMetadata = (metadata: Record<string, string> | null | undefined): OrderAttribution | null => {
  const attribution = attributionSchema.parse(Object.fromEntries(Object.entries(attributionFields).map(([fieldName, parameter]) => [fieldName, metadata?.[parameter]])));
  if (attribution === undefined) return null;
  const parsed = orderAttributionSchema.safeParse({ ...attribution, capturedAt: metadata?.['attribution_at'] });
  return parsed.success ? parsed.data : null;
};

export const attributionMetadata = (attribution: OrderAttribution | undefined): Record<string, string> => {
  if (attribution === undefined) return {};
  const metadata: Record<string, string> = { attribution_at: attribution.capturedAt };
  const values = z.record(z.string().optional()).parse(attribution);
  for (const [fieldName, parameter] of Object.entries(attributionFields)) {
    const value = values[fieldName];
    if (value !== undefined) metadata[parameter] = value;
  }
  return metadata;
};
