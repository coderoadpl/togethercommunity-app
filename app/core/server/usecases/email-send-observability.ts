import {
  emailSendExportQuerySchema,
  emailSendListQuerySchema,
  err,
  notFound,
  ok,
  validation,
  type AppError,
  type EmailSendExportFile,
  type Result,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { authorizeRequiredTenant } from '../authorize.js';
import type { EmailEventRepository, EmailSendRepository, MemberRepository } from '../ports.js';

export const listEmailSends = async (
  ctx: Ctx,
  query: unknown,
  deps: { sends: EmailSendRepository },
) => {
  const tenantId = authorizeRequiredTenant(ctx, 'marketing:delivery:read');
  if (!tenantId.ok) return tenantId;
  const parsed = emailSendListQuerySchema.safeParse(query);
  if (!parsed.success) return err(validation('Invalid e-mail sends query', parsed.error.flatten()));
  return ok(await deps.sends.listPage(tenantId.value, parsed.data));
};

export const getEmailSend = async (
  ctx: Ctx,
  input: { kind: 'transactional' | 'marketing'; id: string },
  deps: { sends: EmailSendRepository; events: EmailEventRepository },
) => {
  const tenantId = authorizeRequiredTenant(ctx, 'marketing:delivery:read');
  if (!tenantId.ok) return tenantId;
  const send = await deps.sends.findById(tenantId.value, input.kind, input.id);
  if (send === null) return err(notFound('E-mail send was not found'));
  const events = await deps.events.listByRef(tenantId.value, input.kind, input.id);
  return ok({ send, events });
};

export const listMemberEmailSends = async (
  ctx: Ctx,
  input: { memberId: string },
  deps: { sends: EmailSendRepository; members: MemberRepository },
) => {
  const tenantId = authorizeRequiredTenant(ctx, 'marketing:delivery:read');
  if (!tenantId.ok) return tenantId;
  const member = await deps.members.findById(tenantId.value, input.memberId);
  if (member === null) return err(notFound('Member was not found'));
  return ok({ sends: await deps.sends.listByEmailAcrossKinds(tenantId.value, member.email) });
};

const neutralizeFormula = (value: string): string =>
  /^[=+\-@]/.test(value) ? `'${value}` : value;

const quoteCsv = (value: string): string => `"${neutralizeFormula(value).replaceAll('"', '""')}"`;

const csv = (rows: Awaited<ReturnType<EmailSendRepository['listPage']>>['sends']): string => [
  'kind,recipient,subject,status,delivery_status,transport,campaign,source,source_app,sent_at,created_at',
  ...rows.map((send) => [
    send.kind,
    send.recipient,
    send.subject,
    send.status,
    send.deliveryStatus ?? '',
    send.transport,
    send.campaignName ?? '',
    send.source,
    send.sourceApp ?? '',
    send.sentAt ?? '',
    send.createdAt,
  ].map(quoteCsv).join(',')),
].join('\n');

export const exportEmailSends = async (
  ctx: Ctx,
  query: unknown,
  deps: { sends: EmailSendRepository },
): Promise<Result<EmailSendExportFile, AppError>> => {
  const tenantId = authorizeRequiredTenant(ctx, 'marketing:delivery:read');
  if (!tenantId.ok) return tenantId;
  const parsed = emailSendExportQuerySchema.safeParse(query);
  if (!parsed.success) return err(validation('Invalid e-mail sends export query', parsed.error.flatten()));
  const filters = {
    ...(parsed.data.kind === undefined ? {} : { kind: parsed.data.kind }),
    ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }),
    ...(parsed.data.deliveryStatus === undefined ? {} : { deliveryStatus: parsed.data.deliveryStatus }),
    ...(parsed.data.transport === undefined ? {} : { transport: parsed.data.transport }),
    ...(parsed.data.campaignId === undefined ? {} : { campaignId: parsed.data.campaignId }),
    ...(parsed.data.runId === undefined ? {} : { runId: parsed.data.runId }),
    ...(parsed.data.sourceApp === undefined ? {} : { sourceApp: parsed.data.sourceApp }),
    ...(parsed.data.search === undefined ? {} : { search: parsed.data.search }),
  };
  const rows = [];
  let cursor: string | undefined;
  do {
    const page = await deps.sends.listPage(tenantId.value, {
      ...filters,
      ...(cursor === undefined ? {} : { cursor }),
      limit: 100,
    });
    rows.push(...page.sends);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return ok({
    filename: `email-sends-${ctx.identity.tenantSlug ?? tenantId.value}.csv`,
    mimeType: 'text/csv; charset=utf-8',
    content: csv(rows),
  });
};
