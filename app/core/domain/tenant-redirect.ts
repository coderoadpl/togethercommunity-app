import { z } from 'zod';

export const redirectPathSchema = z
  .string()
  .min(1)
  .max(2_000)
  .regex(/^\/(?![/\\])[^\s?#]*$/);

const redirectTargetKindSchema = z.enum(['course', 'lesson', 'module-as-course', 'path']);

export const tenantRedirectSchema = z
  .object({
    id: z.string().min(1),
    tenantId: z.string().min(1),
    fromPath: redirectPathSchema,
    targetKind: redirectTargetKindSchema,
    targetId: z.string().min(1).nullable(),
    targetPath: redirectPathSchema,
    permanent: z.boolean(),
    createdAt: z.string().datetime(),
  })
  .strict();

export type TenantRedirect = z.output<typeof tenantRedirectSchema>;

export const normalizeRedirectPath = (path: string): string => {
  const [withoutFragment = ''] = path.trim().split('#');
  const [withoutQuery = ''] = withoutFragment.split('?');
  const segments = withoutQuery.toLowerCase().split('/').filter((s) => s !== '');
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
};
