import { z } from 'zod';

import { operatorTenantSlugSchema } from './operator-tenant.js';
import { shipxEnvironmentSchema, shipxSenderSchema } from './shipx.js';
import { isReservedTenantSlug, tenantSchema } from './tenant.js';
import { tenantSecretKeySchema } from './tenant-secret.js';

const organizationSlugSchema = operatorTenantSlugSchema
  .refine((slug) => !isReservedTenantSlug(slug), 'Organization slug is reserved');

export const organizationSchema = z.object({
  id: z.string().min(1),
  slug: organizationSlugSchema,
  name: tenantSchema.shape.name,
  status: z.enum(['active', 'suspended']),
  maxWorkspaces: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Organization = z.infer<typeof organizationSchema>;

export const organizationRoleSchema = z.enum(['owner', 'admin']);

export type OrganizationRole = z.infer<typeof organizationRoleSchema>;

export const organizationMemberSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  role: organizationRoleSchema,
  createdAt: z.string().datetime(),
  createdByUserId: z.string().min(1),
});

export type OrganizationMember = z.infer<typeof organizationMemberSchema>;

export const organizationMembershipSchema = organizationSchema
  .pick({ id: true, slug: true, name: true, status: true })
  .extend({ role: organizationRoleSchema });

export type OrganizationMembership = z.infer<typeof organizationMembershipSchema>;

export const organizationMemberAccountSchema = z.object({
  userId: z.string().min(1),
  email: z.string().min(1),
  role: organizationRoleSchema,
  createdAt: z.string().datetime(),
});

export type OrganizationMemberAccount = z.infer<typeof organizationMemberAccountSchema>;

export const organizationMemberSelectionSchema = z.object({ email: z.string().trim().toLowerCase().email() }).strict();

export type OrganizationMemberSelection = z.infer<typeof organizationMemberSelectionSchema>;

export const organizationMemberInputSchema = organizationMemberSelectionSchema.extend({ role: organizationRoleSchema }).strict();

export type OrganizationMemberInput = z.infer<typeof organizationMemberInputSchema>;

export const organizationWorkspaceSchema = tenantSchema.pick({ id: true, slug: true, status: true })
  .extend({ name: z.string().min(1) });

export type OrganizationWorkspace = z.infer<typeof organizationWorkspaceSchema>;

export const organizationWorkspaceSelectionSchema = z.object({ tenantId: z.string().trim().min(1) }).strict();

export type OrganizationWorkspaceSelection = z.infer<typeof organizationWorkspaceSelectionSchema>;

const maxWorkspacesSchema = z.number().int().min(0).max(10_000);

export const createOrganizationInputSchema = z.object({
  slug: operatorTenantSlugSchema,
  name: tenantSchema.shape.name,
  ownerEmail: z.string().trim().toLowerCase().email(),
  maxWorkspaces: maxWorkspacesSchema.optional(),
}).strict();

export type CreateOrganizationInput = z.infer<typeof createOrganizationInputSchema>;

export const organizationLimitsSchema = z.object({ maxWorkspaces: maxWorkspacesSchema }).strict();

export type OrganizationLimits = z.infer<typeof organizationLimitsSchema>;

export const organizationAuditEventListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type OrganizationAuditEventListQuery = z.infer<typeof organizationAuditEventListQuerySchema>;

const organizationAuditEventKindSchema = z.enum([
  'organization.created',
  'organization.updated',
  'member.added',
  'member.role_changed',
  'member.removed',
  'workspace.created',
  'workspace.linked',
  'workspace.unlinked',
  'config_source.changed',
  'secret.set',
  'secret.deleted',
  'stripe.credential_configured',
  'invoicing.series_cutover',
  'api_key.created',
  'api_key.revoked',
]);

const auditDataValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.string()),
]);

export const organizationAuditEventSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  kind: organizationAuditEventKindSchema,
  actorUserId: z.string().min(1),
  actorEmail: z.string().min(1),
  actorKeyId: z.string().min(1).nullable(),
  subjectTenantId: z.string().min(1).nullable(),
  subjectUserId: z.string().min(1).nullable(),
  data: z.record(z.string(), auditDataValueSchema),
  at: z.string().datetime(),
});

export type OrganizationAuditEvent = z.infer<typeof organizationAuditEventSchema>;

export const CONFIG_GROUPS = [
  'payments_live',
  'payments_test',
  'invoicing',
  'email_transport',
  'telemetry',
  'shipping_carrier',
] as const;

export const configGroupSchema = z.enum(CONFIG_GROUPS);

export type ConfigGroup = z.infer<typeof configGroupSchema>;

export const organizationSecretKeySchema = tenantSecretKeySchema.extract([
  'stripe.restrictedKey',
  'stripe.testRestrictedKey',
  'ifirma.invoiceApiKey',
  'ifirma.username',
  'ksef.token',
  'ksef.contextNip',
  'ksef.test.token',
  'ksef.test.contextNip',
  'ses.accessKeyId',
  'ses.secretAccessKey',
  'ses.region',
  'smtp.host',
  'smtp.port',
  'smtp.user',
  'smtp.password',
  'smtp.secure',
  'resend.apiKey',
  'shipx.organizationId',
  'shipx.token',
  'telemetry.mongodb',
]);

export type OrganizationSecretKey = z.infer<typeof organizationSecretKeySchema>;

export const ORGANIZATION_SECRET_GROUP: Readonly<Record<OrganizationSecretKey, ConfigGroup>> = {
  'stripe.restrictedKey': 'payments_live',
  'stripe.testRestrictedKey': 'payments_test',
  'ifirma.invoiceApiKey': 'invoicing',
  'ifirma.username': 'invoicing',
  'ksef.token': 'invoicing',
  'ksef.contextNip': 'invoicing',
  'ksef.test.token': 'invoicing',
  'ksef.test.contextNip': 'invoicing',
  'ses.accessKeyId': 'email_transport',
  'ses.secretAccessKey': 'email_transport',
  'ses.region': 'email_transport',
  'smtp.host': 'email_transport',
  'smtp.port': 'email_transport',
  'smtp.user': 'email_transport',
  'smtp.password': 'email_transport',
  'smtp.secure': 'email_transport',
  'resend.apiKey': 'email_transport',
  'shipx.organizationId': 'shipping_carrier',
  'shipx.token': 'shipping_carrier',
  'telemetry.mongodb': 'telemetry',
};

const DEDICATED_FLOW_SECRET_KEYS: Readonly<Partial<Record<OrganizationSecretKey, string>>> = {
  'stripe.restrictedKey': 'The organization Stripe live key is stored only by the organization Stripe configuration flow',
  'stripe.testRestrictedKey': 'The organization Stripe test key is stored only by the organization Stripe configuration flow',
  'telemetry.mongodb': 'The organization telemetry connection is stored only by the organization telemetry connect flow',
};

export const setOrganizationSecretInputSchema = z.object({
  key: organizationSecretKeySchema.superRefine((key, context) => {
    const message = DEDICATED_FLOW_SECRET_KEYS[key];
    if (message !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, message });
  }),
  value: z.string().trim().min(1),
}).strict();

export type SetOrganizationSecretInput = z.input<typeof setOrganizationSecretInputSchema>;

export const organizationSecretSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  key: organizationSecretKeySchema,
  ciphertext: z.string(),
  iv: z.string(),
  authTag: z.string(),
  maskedPreview: z.string(),
  updatedAt: z.string().datetime(),
});

export type OrganizationSecret = z.infer<typeof organizationSecretSchema>;

export const organizationSecretMaskedSchema = organizationSecretSchema.pick({ key: true, maskedPreview: true, updatedAt: true }).strict();

export type OrganizationSecretMasked = z.infer<typeof organizationSecretMaskedSchema>;

export const organizationSettingsSchema = z.object({
  legalName: z.string().nullable(),
  legalAddress: z.string().nullable(),
  invoicingProvider: z.enum(['ifirma', 'ksef']).nullable(),
  ksefSubmissionMode: z.enum(['automatic', 'manual']),
  shipxEnvironment: shipxEnvironmentSchema,
  shipxSender: shipxSenderSchema.nullable(),
});

export type OrganizationSettings = z.infer<typeof organizationSettingsSchema>;

export const updateOrganizationInputSchema = z.object({
  name: tenantSchema.shape.name.optional(),
  legalName: z.string().trim().min(1).nullable().optional(),
  legalAddress: z.string().trim().min(1).nullable().optional(),
  invoicingProvider: organizationSettingsSchema.shape.invoicingProvider.optional(),
  ksefSubmissionMode: organizationSettingsSchema.shape.ksefSubmissionMode.optional(),
  shipxEnvironment: shipxEnvironmentSchema.optional(),
  shipxSender: shipxSenderSchema.strict().nullable().optional(),
}).strict().refine((input) => Object.values(input).some((value) => value !== undefined), 'Name at least one organization setting');

export type UpdateOrganizationInput = z.input<typeof updateOrganizationInputSchema>;

export type OrganizationUpdate = z.output<typeof updateOrganizationInputSchema>;

const configSourceSchema = z.enum(['workspace', 'organization']);

export const tenantConfigSourceSchema = z.object({
  tenantId: z.string().min(1),
  group: configGroupSchema,
  source: z.literal('organization'),
  updatedAt: z.string().datetime(),
  updatedByUserId: z.string().min(1),
});

export type TenantConfigSource = z.infer<typeof tenantConfigSourceSchema>;

export const workspaceConfigSourceSchema = z.object({
  group: configGroupSchema,
  source: configSourceSchema,
  updatedAt: z.string().datetime().nullable(),
  updatedByUserId: z.string().min(1).nullable(),
});

export type WorkspaceConfigSource = z.infer<typeof workspaceConfigSourceSchema>;

export const workspaceConfigSourcesOf = (rows: readonly TenantConfigSource[]): WorkspaceConfigSource[] =>
  CONFIG_GROUPS.map((group) => {
    const row = rows.find((candidate) => candidate.group === group);
    return row === undefined
      ? { group, source: 'workspace', updatedAt: null, updatedByUserId: null }
      : { group, source: row.source, updatedAt: row.updatedAt, updatedByUserId: row.updatedByUserId };
  });
