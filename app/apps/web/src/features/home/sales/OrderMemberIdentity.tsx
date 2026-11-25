import { Link as MuiLink } from '@mui/material';
import { Link } from '@tanstack/react-router';

import { isMemberTombstoneEmail } from '#core/domain/index.js';

import { useTranslations } from '../../../i18n/index.js';
import { SalesMemberEmail, SalesMemberName } from '../../../theme.js';

type OrderMember = { memberId: string; memberName: string | null; memberEmail: string };

export const OrderMemberIdentity = ({ order }: { order: OrderMember }) => {
  const t = useTranslations();
  if (isMemberTombstoneEmail(order.memberEmail)) {
    return <SalesMemberName data-testid="order-member-erased">{t.deletedContent.member}</SalesMemberName>;
  }
  const to = `/panel/members/${encodeURIComponent(order.memberId)}`;
  const member = order.memberName === null ? order.memberEmail : `${order.memberName} (${order.memberEmail})`;
  const email = (
    <SalesMemberEmail data-testid="order-member-email">
      {order.memberName === null
        ? <MuiLink component={Link} to={to} aria-label={t.sales.openMemberAccount({ member })} data-testid="order-member-link">{order.memberEmail}</MuiLink>
        : <MuiLink component={Link} to={to} tabIndex={-1} aria-hidden color="inherit">{order.memberEmail}</MuiLink>}
    </SalesMemberEmail>
  );
  return order.memberName === null ? email : (
    <>
      <SalesMemberName>
        <MuiLink component={Link} to={to} aria-label={t.sales.openMemberAccount({ member })} data-testid="order-member-link">{order.memberName}</MuiLink>
      </SalesMemberName>
      {email}
    </>
  );
};
