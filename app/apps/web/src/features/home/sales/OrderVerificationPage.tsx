import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Alert } from '@mui/material';
import { ApiError } from '#core/client/index.js';
import { capabilitiesForPrincipal } from '#core/domain/index.js';
import { actions } from '../../../api.js';
import { PanelPage, StatusView } from '../../../components/layout/index.js';
import { localizePanelError, useTranslations } from '../../../i18n/index.js';
import { PanelBackLink } from '../PanelBackLink.js';
import { usePanelContext } from '../panel-context.js';
import { OrderVerification, OrderVerificationLookup } from './OrderVerification.js';

export const OrderVerificationPage = ({ reference = '' }: { reference?: string }) => {
  const t = useTranslations();
  const { tenant } = usePanelContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useQuery({ ...actions.orderVerification(reference), enabled: reference.length > 0 });
  const issue = useMutation({ ...actions.issueOrderLine, onSuccess: async () => {
    await queryClient.invalidateQueries(actions.ordersInvalidates());
    await queryClient.invalidateQueries(actions.orderVerificationInvalidates());
  } });
  const canIssue = capabilitiesForPrincipal(tenant.staffRole ?? 'member').includes('order:write');
  return <PanelPage title={t.orderVerification.title} backTo={<PanelBackLink to="/panel/sales">{t.sales.allOrders}</PanelBackLink>}>
    <OrderVerificationLookup key={reference} initialReference={reference} onFind={(value) => { if (value === reference) { void query.refetch(); return; } void navigate({ to: `/panel/orders/verify/${encodeURIComponent(value)}` }); }} />
    {reference.length === 0 ? null : query.isPending ? <StatusView state={{ kind: 'loading', label: t.sales.loading }} /> : query.isError ? <StatusView state={query.error instanceof ApiError && query.error.appError.code === 'not_found' ? { kind: 'empty', title: t.orderVerification.notFound } : { kind: 'error', message: localizePanelError(query.error, t), retry: { label: t.common.retry, onRetry: () => void query.refetch() } }} /> : <OrderVerification order={query.data.order} canIssue={canIssue} pending={issue.isPending} onIssue={(productId) => issue.mutate({ orderId: query.data.order.id, productId })} />}
    {issue.isError ? <Alert severity="error">{localizePanelError(issue.error, t)}</Alert> : null}
  </PanelPage>;
};
