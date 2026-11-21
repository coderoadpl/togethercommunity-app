import { z } from 'zod';

export const PRODUCT_SAFETY_WARNINGS_MAX_LENGTH = 5000;

export const productComplianceObjectSchema = z.object({
  manufacturerName: z.string().trim().min(1, 'Manufacturer name must not be empty').max(200),
  manufacturerAddress: z.string().trim().min(1, 'Manufacturer address must not be empty').max(300),
  manufacturerEmail: z.string().trim().email('Manufacturer e-mail must be a valid address').max(254),
  manufacturerOutsideEu: z.boolean().default(false),
  responsiblePersonName: z.string().trim().min(1, 'Responsible person name must not be empty').max(200).nullable().optional(),
  responsiblePersonAddress: z.string().trim().min(1, 'Responsible person address must not be empty').max(300).nullable().optional(),
  responsiblePersonEmail: z.string().trim().email('Responsible person e-mail must be a valid address').max(254).nullable().optional(),
  modelIdentifier: z.string().trim().min(1, 'Model identifier must not be empty').max(100),
  batchIdentifier: z.string().trim().min(1).max(100).nullable().optional(),
  safetyWarnings: z.string().max(PRODUCT_SAFETY_WARNINGS_MAX_LENGTH, 'Safety warnings are too long').default(''),
  instructionsUrl: z
    .string()
    .trim()
    .url('Instructions URL must be a valid URL')
    .regex(/^https:\/\//iu, 'Instructions URL must use HTTPS')
    .nullable()
    .optional(),
}).strict();

const RESPONSIBLE_PERSON_FIELDS = [
  ['responsiblePersonName', 'Responsible person name'],
  ['responsiblePersonAddress', 'Responsible person address'],
  ['responsiblePersonEmail', 'Responsible person e-mail'],
] as const;

type ResponsiblePersonFields = { manufacturerOutsideEu: boolean } & Partial<Record<typeof RESPONSIBLE_PERSON_FIELDS[number][0], string | null | undefined>>;

export const requireResponsiblePerson = (compliance: ResponsiblePersonFields, ctx: z.RefinementCtx): void => {
  const given = RESPONSIBLE_PERSON_FIELDS.some(([field]) => compliance[field] != null);
  if (!compliance.manufacturerOutsideEu && !given) return;
  const reason = compliance.manufacturerOutsideEu ? 'when the manufacturer is outside the EU' : 'when any responsible person field is given';
  for (const [field, label] of RESPONSIBLE_PERSON_FIELDS) {
    if (compliance[field] == null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${label} is required ${reason}` });
  }
};

export const productComplianceSchema = productComplianceObjectSchema.superRefine(requireResponsiblePerson);

export type ProductCompliance = z.output<typeof productComplianceSchema>;

export const publicProductComplianceSchema = productComplianceObjectSchema.extend({ safetyWarningsHtml: z.string() });

export type PublicProductCompliance = z.output<typeof publicProductComplianceSchema>;

export type ResponsiblePerson = { name: string; address: string; email: string };

export const shownResponsiblePerson = (compliance: Pick<ProductCompliance, 'manufacturerOutsideEu' | 'responsiblePersonName' | 'responsiblePersonAddress' | 'responsiblePersonEmail'>): ResponsiblePerson | null => {
  const { manufacturerOutsideEu, responsiblePersonName: name, responsiblePersonAddress: address, responsiblePersonEmail: email } = compliance;
  return manufacturerOutsideEu && name != null && address != null && email != null ? { name, address, email } : null;
};

export const VARIANT_FIELD_MAX_LENGTH = 60;

export const variantGroupSchema = z
  .string()
  .trim()
  .min(1, 'Variant group must not be empty')
  .max(VARIANT_FIELD_MAX_LENGTH, 'Variant group too long')
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Variant group must contain lowercase letters, numbers and hyphens only');

export const variantLabelSchema = z
  .string()
  .trim()
  .min(1, 'Variant label must not be empty')
  .max(VARIANT_FIELD_MAX_LENGTH, 'Variant label too long');

export const publicProductVariantSchema = z.object({
  productId: z.string(),
  slug: z.string(),
  label: z.string(),
  soldOut: z.boolean(),
  available: z.number().int().min(0).nullable().default(null),
});

export type PublicProductVariant = z.infer<typeof publicProductVariantSchema>;

export const productVariants = <T extends {
  id: string;
  slug: string;
  title: string;
  published: boolean;
  variantGroup?: string | null | undefined;
  variantLabel?: string | null | undefined;
}>(
  product: Pick<T, 'id' | 'variantGroup'>,
  candidates: readonly T[],
  stockOf: (productId: string) => { soldOut: boolean; available: number | null },
): PublicProductVariant[] => {
  const group = product.variantGroup ?? null;
  if (group === null) return [];
  const siblings = candidates.filter((candidate) => candidate.published && candidate.variantGroup === group);
  if (siblings.length < 2 || !siblings.some((sibling) => sibling.id === product.id)) return [];
  return siblings.map((sibling) => {
    const { soldOut, available } = stockOf(sibling.id);
    return { productId: sibling.id, slug: sibling.slug, label: sibling.variantLabel ?? sibling.title, soldOut, available };
  });
};
