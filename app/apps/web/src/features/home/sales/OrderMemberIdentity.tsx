import { Link as MuiLink, type LinkProps } from '@mui/material';
import { Link } from '@tanstack/react-router';

import { isMemberTombstone } from '#core/domain/index.js';

import { useTranslations } from '../../../i18n/index.js';
import { SalesMemberEmail, SalesMemberName } from '../../../theme.js';

type OrderMember = { memberId: string; memberName: string | null; memberEmail: string };

export const orderMemberTitle = (order: OrderMember, deletedLabel: string): string => {
  if (isMemberTombstone(order)) return deletedLabel;
  return order.memberName === null ? order.memberEmail : `${order.memberName}\n${order.memberEmail}`;
};

export const OrderMemberIdentity = ({ order, underline }: { order: OrderMember; underline?: LinkProps['underline'] }) => {
  const t = useTranslations();
  if (isMemberTombstone(order)) {
    return <SalesMemberName data-testid="order-member-erased">{t.deletedContent.member}</SalesMemberName>;
  }
  const to = `/panel/members/${encodeURIComponent(order.memberId)}`;
  const member = order.memberName === null ? order.memberEmail : `${order.memberName} (${order.memberEmail})`;
  const email = (
    <SalesMemberEmail data-testid="order-member-email">
      {order.memberName === null
        ? <MuiLink component={Link} to={to} aria-label={t.sales.openMemberAccount({ member })} data-testid="order-member-link" {...(underline === undefined ? {} : { underline })}>{order.memberEmail}</MuiLink>
        : <MuiLink component={Link} to={to} tabIndex={-1} color="inherit">{order.memberEmail}</MuiLink>}
    </SalesMemberEmail>
  );
  return order.memberName === null ? email : (
    <>
      <SalesMemberName>
        <MuiLink component={Link} to={to} aria-label={t.sales.openMemberAccount({ member })} data-testid="order-member-link" {...(underline === undefined ? {} : { underline })}>{order.memberName}</MuiLink>
      </SalesMemberName>
      {email}
    </>
  );
};
