import { z } from 'zod';

export const PRODUCT_SAFETY_WARNINGS_MAX_LENGTH = 5000;

export const productComplianceSchema = z.object({
  manufacturerName: z.string().trim().min(1, 'Manufacturer name must not be empty').max(200),
  manufacturerAddress: z.string().trim().min(1, 'Manufacturer address must not be empty').max(300),
  manufacturerEmail: z.string().trim().email('Manufacturer e-mail must be a valid address').max(254),
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

export type ProductCompliance = z.output<typeof productComplianceSchema>;

export const publicProductComplianceSchema = productComplianceSchema.extend({ safetyWarningsHtml: z.string() });

export type PublicProductCompliance = z.output<typeof publicProductComplianceSchema>;

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
  soldOutProductIds: ReadonlySet<string>,
): PublicProductVariant[] => {
  const group = product.variantGroup ?? null;
  if (group === null) return [];
  const siblings = candidates.filter((candidate) => candidate.published && candidate.variantGroup === group);
  if (siblings.length < 2 || !siblings.some((sibling) => sibling.id === product.id)) return [];
  return siblings.map((sibling) => ({
    productId: sibling.id,
    slug: sibling.slug,
    label: sibling.variantLabel ?? sibling.title,
    soldOut: soldOutProductIds.has(sibling.id),
  }));
};
