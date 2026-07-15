import {
  err,
  forbidden,
  notFound,
  ok,
  tenantNotFound,
  type AppError,
  type MemberExportFile,
  type MemberExportFormat,
  type MemberWithProductIds,
  type Result,
} from '@core/domain/index.js';

import type { Ctx } from '../context.js';
import type { Clock, MemberRepository } from '../ports.js';

export interface MembersDeps {
  members: MemberRepository;
  clock: Clock;
}

const requireStaffTenant = (ctx: Ctx): Result<string, AppError> => {
  if (!ctx.identity.tenantId) return err(tenantNotFound('Select a tenant to manage members'));
  if (!ctx.identity.staffRole) return err(forbidden('Only tenant staff can manage members'));
  return ok(ctx.identity.tenantId);
};

const neutralizeFormula = (value: string): string =>
  /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;

const quoteCsv = (value: string): string => `"${value.replaceAll('"', '""')}"`;

const serializeRecord = (value: Record<string, boolean> | Record<string, string>): string =>
  JSON.stringify(value);

const CSV_HEADER = [
  'id',
  'email',
  'displayName',
  'tags',
  'marketingConsents',
  'externalCustomerIds',
  'createdAt',
  'productIds',
];

const toCsv = (members: MemberWithProductIds[]): string =>
  [
    CSV_HEADER.map(quoteCsv).join(','),
    ...members.map((member) =>
      [
        member.id,
        neutralizeFormula(member.email),
        neutralizeFormula(member.displayName ?? ''),
        neutralizeFormula(member.tags.join(';')),
        neutralizeFormula(serializeRecord(member.marketingConsents)),
        neutralizeFormula(serializeRecord(member.externalCustomerIds)),
        member.createdAt,
        member.productIds.join(';'),
      ]
        .map(quoteCsv)
        .join(','),
    ),
  ].join('\n');

export const listMembers = async (
  ctx: Ctx,
  deps: MembersDeps,
): Promise<Result<MemberWithProductIds[], AppError>> => {
  const tenant = requireStaffTenant(ctx);
  if (!tenant.ok) return tenant;
  return ok(await deps.members.listWithProductIds(tenant.value, deps.clock.nowIso()));
};

export const exportMembers = async (
  ctx: Ctx,
  input: { format: MemberExportFormat },
  deps: MembersDeps,
): Promise<Result<MemberExportFile, AppError>> => {
  const tenant = requireStaffTenant(ctx);
  if (!tenant.ok) return tenant;

  const members = await deps.members.listWithProductIds(tenant.value, deps.clock.nowIso());
  const filename = `members-${ctx.identity.tenantSlug ?? tenant.value}.${input.format}`;

  return ok(
    input.format === 'csv'
      ? { filename, mimeType: 'text/csv; charset=utf-8', content: toCsv(members) }
      : { filename, mimeType: 'application/json; charset=utf-8', content: JSON.stringify(members) },
  );
};

export const removeMember = async (
  ctx: Ctx,
  input: { memberId: string },
  deps: MembersDeps,
): Promise<Result<{ memberId: string }, AppError>> => {
  const tenant = requireStaffTenant(ctx);
  if (!tenant.ok) return tenant;

  const removed = await deps.members.delete(tenant.value, input.memberId);
  if (!removed) return err(notFound(`No member "${input.memberId}" in this tenant`));
  return ok({ memberId: input.memberId });
};
