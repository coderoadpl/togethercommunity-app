import { z } from 'zod';

export const TENANT_REDIRECT_PAGE_SIZE = 50;

export const redirectPathSchema = z
  .string()
  .min(1)
  .max(2_000)
  .regex(/^\/(?![/\\])[^\s?#]*$/);

const redirectTargetKindSchema = z.enum(['course', 'lesson', 'module-as-course', 'path']);

const redirectOriginSchema = z.enum(['import', 'manual']);

export const tenantRedirectSchema = z
  .object({
    id: z.string().min(1),
    tenantId: z.string().min(1),
    fromPath: redirectPathSchema,
    targetKind: redirectTargetKindSchema,
    targetId: z.string().min(1).nullable(),
    targetPath: redirectPathSchema,
    permanent: z.boolean(),
    origin: redirectOriginSchema,
    createdBy: z.string().min(1).nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();

export type TenantRedirect = z.output<typeof tenantRedirectSchema>;

export interface TenantRedirectPage {
  redirects: TenantRedirect[];
  total: number;
}

const tenantRedirectTargetInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('course'), courseId: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal('lesson'),
      courseId: z.string().min(1),
      lessonId: z.string().min(1),
    })
    .strict(),
  z.object({ kind: z.literal('path'), path: redirectPathSchema }).strict(),
]);

export type TenantRedirectTargetInput = z.output<typeof tenantRedirectTargetInputSchema>;

export const tenantRedirectCreateInputSchema = z
  .object({
    fromPath: z.string().trim().min(1).max(2_000),
    target: tenantRedirectTargetInputSchema,
    permanent: z.boolean().default(false),
  })
  .strict();

export type TenantRedirectCreateInput = z.input<typeof tenantRedirectCreateInputSchema>;

export const tenantRedirectDeleteInputSchema = z
  .object({ id: z.string().min(1) })
  .strict();

export type TenantRedirectDeleteInput = z.output<typeof tenantRedirectDeleteInputSchema>;

export const tenantRedirectListQuerySchema = z
  .object({
    search: z.string().trim().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(0).max(100).default(TENANT_REDIRECT_PAGE_SIZE),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export type TenantRedirectListQuery = z.output<typeof tenantRedirectListQuerySchema>;

export const normalizeRedirectPath = (path: string): string => {
  const [withoutFragment = ''] = path.trim().split('#');
  const [withoutQuery = ''] = withoutFragment.split('?');
  const segments = withoutQuery.toLowerCase().split('/').filter((s) => s !== '');
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
};

const RESERVED_REDIRECT_ROOTS = [
  'account',
  'api',
  'assets',
  'checkout',
  'community',
  'forgot-password',
  'login',
  'messages',
  'my',
  'notifications',
  'panel',
  'register',
  'reset-password',
  'search',
  'start',
] as const;

export const isReservedRedirectPath = (path: string): boolean => {
  const normalized = normalizeRedirectPath(path);
  if (normalized === '/') return true;
  const [root] = normalized.slice(1).split('/');
  return RESERVED_REDIRECT_ROOTS.some((reserved) => reserved === root);
};
