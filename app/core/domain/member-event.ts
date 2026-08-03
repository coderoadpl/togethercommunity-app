import { z } from 'zod';

type MemberEventRegistry = Record<string, z.ZodTypeAny>;

export const defineMemberEventRegistry = <const TRegistry extends MemberEventRegistry>(
  registry: TRegistry,
): TRegistry => registry;

export const memberEventRegistry = defineMemberEventRegistry({
  banned: z.object({
    reason: z.string().nullable(),
    actorUserId: z.string().min(1),
  }).strict(),
  unbanned: z.object({
    actorUserId: z.string().min(1),
  }).strict(),
  purchase: z.object({
    orderId: z.string().min(1),
    productId: z.string().min(1),
    kind: z.enum(['one_time', 'recurring']),
    status: z.enum(['paid', 'pending', 'failed', 'refunded']),
    amountCents: z.number().int().nonnegative(),
    currency: z.string().min(1),
    provider: z.enum(['stripe', 'simulated']),
  }).strict(),
  grant: z.object({
    grantId: z.string().min(1),
    productId: z.string().min(1),
    source: z.enum(['simulated', 'manual', 'stripe']),
    startsAt: z.string().datetime(),
    expiresAt: z.string().datetime().nullable(),
  }).strict(),
  revoke: z.object({
    grantId: z.string().min(1),
    productId: z.string().min(1),
    expiresAt: z.string().datetime(),
  }).strict(),
  'subscription-change': z.object({
    subscriptionId: z.string().min(1),
    productId: z.string().min(1),
    status: z.enum(['active', 'past_due', 'canceled']),
    currentPeriodEnd: z.string().datetime(),
    cancelAtPeriodEnd: z.boolean(),
    provider: z.enum(['stripe', 'simulated']),
  }).strict(),
  'lesson-completion': z.object({
    courseId: z.string().min(1),
    lessonId: z.string().min(1),
  }).strict(),
  'email-sent': z.object({
    sendId: z.string().min(1),
    mailKind: z.enum(['transactional', 'marketing']),
    subject: z.string().min(1),
    source: z.string().min(1),
    transport: z.enum(['tenant-ses', 'smtp', 'platform']),
  }).strict(),
});

type MemberEventFromRegistry<TRegistry extends MemberEventRegistry> = {
  [TType in keyof TRegistry & string]: {
    id: string;
    tenantId: string;
    memberId: string;
    type: TType;
    payload: z.output<TRegistry[TType]>;
    occurredAt: string;
  };
}[keyof TRegistry & string];

/** @public part of the member-event registry surface (consumed by panel i18n) */
export type MemberEventType = keyof typeof memberEventRegistry;
export type MemberEvent = MemberEventFromRegistry<typeof memberEventRegistry>;

export function createMemberEventSchema<const TRegistry extends MemberEventRegistry>(
  registry: TRegistry,
): z.ZodType<MemberEventFromRegistry<TRegistry>>;
export function createMemberEventSchema(registry: MemberEventRegistry): z.ZodTypeAny {
  return z.object({
    id: z.string().min(1),
    tenantId: z.string().min(1),
    memberId: z.string().min(1),
    type: z.string().min(1),
    payload: z.unknown(),
    occurredAt: z.string().datetime(),
  }).superRefine((event, context) => {
    const payloadSchema: z.ZodTypeAny | undefined = registry[event.type];
    if (payloadSchema === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['type'],
        message: `Unregistered member event type: ${event.type}`,
      });
      return;
    }
    const payload = payloadSchema.safeParse(event.payload);
    if (!payload.success) {
      for (const issue of payload.error.issues) {
        context.addIssue({ ...issue, path: ['payload', ...issue.path] });
      }
    }
  });
}

export const memberEventSchema = createMemberEventSchema(memberEventRegistry);

export const memberBanEventSchema = createMemberEventSchema({
  banned: memberEventRegistry.banned,
  unbanned: memberEventRegistry.unbanned,
});

export type MemberBanEvent = z.output<typeof memberBanEventSchema>;
