import { useState, type ReactNode } from 'react';
import { Alert, Button, Stack, TextField, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { ApiError } from '#core/client/index.js';
import {
  CHANGE_PROPOSAL_LIMITS,
  knownChangeProposalOperation,
  type ChangeProposalGroupOwnerView,
  type ChangeProposalKeyState,
  type ChangeProposalOwnerView,
} from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { SectionCard, StatusView } from '../../../components/layout/index.js';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog.js';
import { useToast } from '../../../components/ui/Toast.js';
import { localizePanelError, useLanguage, useTranslations, type Messages } from '../../../i18n/index.js';
import { formatDateTime } from '../../../lib/format.js';
import { FinePrint, WrapAnywhereText } from '../../../theme.js';
import { ProposalFieldRows, referenceText, type StockNow } from './ProposalChanges.js';
import {
  groupReferences,
  proposalTarget,
  stockAdjustmentProductId,
  type GroupReferences,
} from './proposal-display.js';

type Translations = Messages['changeProposals'];

export type SettledStatus = 'stale' | 'failed' | 'expired';

export interface SettledOutcome {
  key: string;
  title: string;
  status: SettledStatus;
  reason: string | null;
}

export interface DecisionCallbacks {
  onSettled: (outcome: SettledOutcome) => void;
  onDecided: () => void;
}

const groupItemsChangedSchema = z.object({ changeProposalGroupItemIds: z.array(z.string()) });

const errorCode = (error: unknown): string | null => error instanceof ApiError ? error.appError.code : null;

const groupItemsChanged = (error: unknown): boolean =>
  error instanceof ApiError && error.appError.code === 'conflict' && groupItemsChangedSchema.safeParse(error.appError.details).success;

export const operationTitle = (t: Translations, operation: string): string => {
  const known = knownChangeProposalOperation(operation);
  return known === null ? t.unknownOperation : t.operation[known];
};

export const outcomeExplanation = (t: Translations, status: string, reason: string | null): string | null => {
  if (status === 'stale') return t.outcomeStale;
  if (status === 'failed') return reason === null ? t.outcomeFailedUnknown : t.outcomeFailed({ reason });
  if (status === 'expired') return t.outcomeExpired;
  return null;
};

const isSettledStatus = (status: string): status is SettledStatus =>
  status === 'stale' || status === 'failed' || status === 'expired';

export const TargetLine = ({
  proposal,
  references,
  inline = false,
}: {
  proposal: Pick<ChangeProposalOwnerView, 'target' | 'targetLabel' | 'input'>;
  references?: GroupReferences;
  inline?: boolean;
}) => {
  const t = useTranslations().changeProposals;
  const target = proposalTarget(proposal, references);
  const kind = t.targetKind[proposal.target.kind];
  const text = proposal.target.kind === 'settings'
    ? kind
    : target.kind === 'reference'
    ? `${kind}: ${referenceText(t, target.reference)}`
    : target.kind === 'label'
      ? `${kind}: ${target.label}`
      : `${kind}: ${target.label ?? t.targetPending}`;
  return <WrapAnywhereText variant="body2" color="text.secondary" component={inline ? 'span' : 'p'}>{text}</WrapAnywhereText>;
};

const ProposerWarnings = ({ keyState, issuerIsVerifiedOwner }: { keyState: ChangeProposalKeyState; issuerIsVerifiedOwner: boolean }) => {
  const t = useTranslations().changeProposals;
  const warnings = [
    keyState === 'revoked' ? t.warningKeyRevoked : null,
    keyState === 'purged' ? t.warningKeyPurged : null,
    keyState === 'expired' ? t.warningKeyExpired : null,
    issuerIsVerifiedOwner ? null : t.warningIssuerNotOwner,
  ].filter((warning): warning is string => warning !== null);
  return warnings.length === 0 ? null : (
    <Stack useFlexGap spacing="0.5rem" data-testid="proposal-warnings">
      {warnings.map((warning) => <Alert key={warning} severity="warning">{warning}</Alert>)}
    </Stack>
  );
};

const ProposalMeta = ({
  keyName,
  createdAt,
  expiresAt,
}: {
  keyName: string | null;
  createdAt: string;
  expiresAt: string | null;
}) => {
  const t = useTranslations().changeProposals;
  const { language } = useLanguage();
  return (
    <Stack useFlexGap spacing="0.15rem">
      {keyName === null ? null : <WrapAnywhereText variant="body2" component="p">{t.proposedBy({ key: keyName })}</WrapAnywhereText>}
      <FinePrint component="p">
        {t.proposedAt({ date: formatDateTime(createdAt, language) })}
        {expiresAt === null ? null : ` · ${t.expiresAt({ date: formatDateTime(expiresAt, language) })}`}
      </FinePrint>
    </Stack>
  );
};

const useStockNow = (proposal: Pick<ChangeProposalOwnerView, 'operation' | 'input'>, live: boolean): StockNow | undefined => {
  const productId = live ? stockAdjustmentProductId(proposal) : null;
  const stock = useQuery({ ...actions.productStock(productId ?? ''), enabled: productId !== null });
  if (productId === null || stock.data === undefined) return undefined;
  return stock.data.stock === null ? { tracked: false } : { tracked: true, onHand: stock.data.stock.onHand };
};

export const ProposalBody = ({
  proposal,
  references,
  live,
  labelComponent,
}: {
  proposal: Pick<ChangeProposalOwnerView, 'operation' | 'input' | 'effect'>;
  references?: GroupReferences;
  live: boolean;
  labelComponent?: 'h3' | 'h4';
}) => {
  const t = useTranslations().changeProposals;
  const stockNow = useStockNow(proposal, live);
  const known = knownChangeProposalOperation(proposal.operation) !== null;
  return (
    <Stack useFlexGap spacing="0.75rem">
      {known ? null : (
        <Stack useFlexGap spacing="0.25rem" data-testid="proposal-unknown-operation">
          <FinePrint component="p">{t.unknownOperationName({ operation: proposal.operation })}</FinePrint>
          {live ? <Typography variant="body2">{t.unknownOperationNotApprovable}</Typography> : null}
        </Stack>
      )}
      <ProposalFieldRows
        proposal={proposal}
        {...(references === undefined ? {} : { references })}
        stockNow={stockNow}
        {...(labelComponent === undefined ? {} : { labelComponent })}
      />
    </Stack>
  );
};

const RejectNoteField = ({ note, onChange }: { note: string; onChange: (note: string) => void }) => {
  const t = useTranslations().changeProposals;
  return (
    <TextField
      label={t.rejectNoteLabel}
      helperText={t.rejectNoteHelp}
      value={note}
      onChange={(event) => onChange(event.target.value)}
      multiline
      minRows={2}
      fullWidth
      slotProps={{ htmlInput: { maxLength: CHANGE_PROPOSAL_LIMITS.decisionNoteMaxLength, 'data-testid': 'proposal-reject-note' } }}
    />
  );
};

const DecisionDialogs = ({
  dialog,
  onClose,
  approveTitle,
  approveBody,
  rejectTitle,
  pending,
  onApprove,
  onReject,
}: {
  dialog: 'approve' | 'reject' | null;
  onClose: () => void;
  approveTitle: string;
  approveBody: string;
  rejectTitle: string;
  pending: boolean;
  onApprove: () => void;
  onReject: (note: string) => void;
}) => {
  const t = useTranslations();
  const [note, setNote] = useState('');
  return (
    <>
      <ConfirmDialog
        open={dialog === 'approve'}
        title={approveTitle}
        body={<Typography variant="body2">{approveBody}</Typography>}
        confirmLabel={t.changeProposals.approveConfirm}
        cancelLabel={t.common.cancel}
        confirmColor="primary"
        pending={pending}
        onConfirm={onApprove}
        onClose={onClose}
        confirmTestId="proposal-approve-confirm"
        data-testid="proposal-approve-dialog"
      />
      <ConfirmDialog
        open={dialog === 'reject'}
        title={rejectTitle}
        body={(
          <>
            <Typography variant="body2">{t.changeProposals.rejectBody}</Typography>
            <RejectNoteField note={note} onChange={setNote} />
          </>
        )}
        confirmLabel={t.changeProposals.rejectConfirm}
        cancelLabel={t.common.cancel}
        pending={pending}
        onConfirm={() => onReject(note.trim())}
        onClose={onClose}
        confirmTestId="proposal-reject-confirm"
        data-testid="proposal-reject-dialog"
      />
    </>
  );
};

const useDecisionFeedback = () => {
  const t = useTranslations();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const refreshLists = () => queryClient.invalidateQueries(actions.changeProposalsInvalidates());
  const refreshAfterApproval = () =>
    Promise.all(actions.approveChangeProposalInvalidates().map((filter) => queryClient.invalidateQueries(filter)));
  const failed = async (error: unknown): Promise<void> => {
    if (errorCode(error) === 'unavailable') {
      setBusy(true);
      toast.error(t.changeProposals.busy);
      return;
    }
    if (errorCode(error) === 'conflict') {
      toast.info(t.changeProposals.alreadyDecided);
      await refreshLists();
      return;
    }
    toast.error(localizePanelError(error, t));
  };
  return { t, toast, busy, setBusy, refreshLists, refreshAfterApproval, failed };
};

const DecisionActions = ({
  approveLabel,
  rejectLabel,
  approvable,
  pending,
  onApprove,
  onReject,
  testIdPrefix,
}: {
  approveLabel: string;
  rejectLabel: string;
  approvable: boolean;
  pending: boolean;
  onApprove: () => void;
  onReject: () => void;
  testIdPrefix: string;
}) => (
  <>
    <Button variant="outlined" color="error" disabled={pending} onClick={onReject} data-testid={`${testIdPrefix}-reject`}>
      {rejectLabel}
    </Button>
    <Button variant="contained" disabled={pending || !approvable} onClick={onApprove} data-testid={`${testIdPrefix}-approve`}>
      {approveLabel}
    </Button>
  </>
);

const CardNotice = ({ children, testId }: { children: ReactNode; testId: string }) => (
  <Alert severity="info" data-testid={testId}>{children}</Alert>
);

export const SingleProposalCard = ({
  proposal,
  onSettled,
  onDecided,
}: { proposal: ChangeProposalOwnerView } & DecisionCallbacks) => {
  const { t, toast, busy, setBusy, refreshLists, refreshAfterApproval, failed } = useDecisionFeedback();
  const [dialog, setDialog] = useState<'approve' | 'reject' | null>(null);
  const title = operationTitle(t.changeProposals, proposal.operation);
  const known = knownChangeProposalOperation(proposal.operation) !== null;

  const approve = useMutation({
    ...actions.approveChangeProposal,
    onSuccess: async ({ proposal: decided }) => {
      setDialog(null);
      await refreshAfterApproval();
      if (decided.status === 'applied') {
        toast.success(t.changeProposals.outcomeApplied);
        onDecided();
        return;
      }
      if (isSettledStatus(decided.status)) {
        const explanation = outcomeExplanation(t.changeProposals, decided.status, decided.failureMessage);
        if (explanation !== null) toast.info(explanation);
        onSettled({ key: decided.id, title, status: decided.status, reason: decided.failureMessage });
      }
    },
    onError: async (error) => {
      setDialog(null);
      await failed(error);
    },
  });
  const reject = useMutation({
    ...actions.rejectChangeProposal,
    onSuccess: async () => {
      setDialog(null);
      await refreshLists();
      toast.success(t.changeProposals.outcomeRejected);
      onDecided();
    },
    onError: async (error) => {
      setDialog(null);
      await failed(error);
    },
  });
  const pending = approve.isPending || reject.isPending;

  return (
    <SectionCard
      title={title}
      description={<TargetLine proposal={proposal} inline />}
      data-testid={`proposal-card-${proposal.id}`}
      actions={(
        <DecisionActions
          approveLabel={t.changeProposals.approve}
          rejectLabel={t.changeProposals.reject}
          approvable={known}
          pending={pending}
          onApprove={() => { setBusy(false); setDialog('approve'); }}
          onReject={() => { setBusy(false); setDialog('reject'); }}
          testIdPrefix="proposal"
        />
      )}
    >
      <ProposalMeta keyName={proposal.proposedBy.keyName} createdAt={proposal.createdAt} expiresAt={proposal.expiresAt} />
      <ProposerWarnings keyState={proposal.proposedBy.keyState} issuerIsVerifiedOwner={proposal.proposedBy.issuerIsVerifiedOwner} />
      {busy ? <CardNotice testId="proposal-busy">{t.changeProposals.busy}</CardNotice> : null}
      <ProposalBody proposal={proposal} live />
      <DecisionDialogs
        dialog={dialog}
        onClose={() => setDialog(null)}
        approveTitle={t.changeProposals.approveTitle}
        approveBody={t.changeProposals.approveBody({ what: title })}
        rejectTitle={t.changeProposals.rejectTitle}
        pending={pending}
        onApprove={() => approve.mutate({ id: proposal.id })}
        onReject={(note) => reject.mutate({ id: proposal.id, ...(note === '' ? {} : { note }) })}
      />
    </SectionCard>
  );
};

const groupStatusLabel = (t: Translations, status: ChangeProposalGroupOwnerView['status']): string =>
  status === 'open' ? t.status.pending : t.status[status];

const orderedItems = (group: ChangeProposalGroupOwnerView) =>
  group.items.toSorted((left, right) => (left.groupPosition ?? 0) - (right.groupPosition ?? 0));

const GroupItem = ({ item, position, references }: { item: ChangeProposalOwnerView; position: number; references: GroupReferences }) => {
  const t = useTranslations().changeProposals;
  return (
    <Stack useFlexGap spacing="0.5rem" component="li" data-testid={`proposal-group-item-${item.id}`} sx={{ listStyle: 'none' }}>
      <Typography variant="h3" component="h3">
        {t.groupStep({ position, operation: operationTitle(t, item.operation) })}
      </Typography>
      <TargetLine proposal={item} references={references} />
      <ProposalBody proposal={item} references={references} live labelComponent="h4" />
    </Stack>
  );
};

export const GroupProposalCard = ({
  groupId,
  itemCount,
  onSettled,
  onDecided,
}: { groupId: string; itemCount: number } & DecisionCallbacks) => {
  const { t, toast, busy, setBusy, refreshLists, refreshAfterApproval, failed } = useDecisionFeedback();
  const group = useQuery(actions.changeProposalGroup(groupId));
  const [dialog, setDialog] = useState<'approve' | 'reject' | null>(null);
  const [changed, setChanged] = useState(false);
  const groupView = group.data?.group;
  const items = groupView === undefined ? [] : orderedItems(groupView);
  const count = groupView === undefined ? itemCount : items.length;
  const heading = t.changeProposals.groupHeading({ count });

  const groupFailed = async (error: unknown): Promise<void> => {
    setDialog(null);
    if (groupItemsChanged(error)) {
      setChanged(true);
      toast.info(t.changeProposals.groupChanged);
      await Promise.all([group.refetch(), refreshLists()]);
      return;
    }
    await failed(error);
  };
  const approve = useMutation({
    ...actions.approveChangeProposalGroup,
    onSuccess: async ({ group: decided }) => {
      setDialog(null);
      await refreshAfterApproval();
      if (decided.status === 'applied') {
        toast.success(t.changeProposals.outcomeGroupApplied({ count: decided.items.length }));
        onDecided();
        return;
      }
      const offending = decided.items.find((item) => item.status === 'failed') ?? decided.items.find((item) => item.status === 'stale');
      const status = decided.status === 'failed' ? 'failed' : 'stale';
      const reason = status === 'failed' ? offending?.failureMessage ?? null : null;
      const explanation = outcomeExplanation(t.changeProposals, status, reason);
      if (explanation !== null) toast.info(explanation);
      onSettled({ key: decided.id, title: decided.title, status, reason });
    },
    onError: groupFailed,
  });
  const reject = useMutation({
    ...actions.rejectChangeProposalGroup,
    onSuccess: async () => {
      setDialog(null);
      await refreshLists();
      toast.success(t.changeProposals.outcomeGroupRejected);
      onDecided();
    },
    onError: groupFailed,
  });
  const pending = approve.isPending || reject.isPending;
  const open = groupView?.status === 'open';
  const approvable = open && items.length > 0 && items.every((item) => knownChangeProposalOperation(item.operation) !== null);
  const references = groupReferences(items);

  return (
    <SectionCard
      title={heading}
      data-testid={`proposal-group-card-${groupId}`}
      actions={groupView === undefined || !open ? undefined : (
        <DecisionActions
          approveLabel={t.changeProposals.approveGroup({ count })}
          rejectLabel={t.changeProposals.rejectGroup}
          approvable={approvable}
          pending={pending || group.isFetching}
          onApprove={() => { setBusy(false); setChanged(false); setDialog('approve'); }}
          onReject={() => { setBusy(false); setChanged(false); setDialog('reject'); }}
          testIdPrefix="proposal-group"
        />
      )}
    >
      {group.isPending ? (
        <StatusView state={{ kind: 'loading', label: t.changeProposals.groupLoading }} />
      ) : group.isError ? (
        <StatusView state={{ kind: 'error', message: localizePanelError(group.error, t), retry: { label: t.common.retry, onRetry: () => void group.refetch() } }} />
      ) : (
        <>
          <Stack useFlexGap spacing="0.15rem">
            <FinePrint component="p">{t.changeProposals.groupTitleAttribution({ key: group.data.group.proposedBy.keyName ?? group.data.group.proposedBy.keyId })}</FinePrint>
            <WrapAnywhereText variant="body1" component="p" data-testid="proposal-group-title">{group.data.group.title}</WrapAnywhereText>
          </Stack>
          <ProposalMeta keyName={group.data.group.proposedBy.keyName} createdAt={group.data.group.createdAt} expiresAt={group.data.group.expiresAt} />
          <ProposerWarnings keyState={group.data.group.proposedBy.keyState} issuerIsVerifiedOwner={group.data.group.proposedBy.issuerIsVerifiedOwner} />
          {changed ? <CardNotice testId="proposal-group-changed">{t.changeProposals.groupChanged}</CardNotice> : null}
          {busy ? <CardNotice testId="proposal-busy">{t.changeProposals.busy}</CardNotice> : null}
          {open ? <Typography variant="body2">{t.changeProposals.groupAllOrNothing}</Typography> : (
            <Typography variant="body2">{groupStatusLabel(t.changeProposals, group.data.group.status)}</Typography>
          )}
          <Stack component="ol" useFlexGap spacing="1.25rem" sx={{ m: 0, p: 0 }}>
            {items.map((item, index) => (
              <GroupItem key={item.id} item={item} position={item.groupPosition ?? index + 1} references={references} />
            ))}
          </Stack>
        </>
      )}
      <DecisionDialogs
        dialog={dialog}
        onClose={() => setDialog(null)}
        approveTitle={t.changeProposals.approveGroupTitle}
        approveBody={t.changeProposals.approveGroupBody({ count, title: groupView?.title ?? '' })}
        rejectTitle={t.changeProposals.rejectGroupTitle}
        pending={pending}
        onApprove={() => approve.mutate({ id: groupId, itemIds: items.map((item) => item.id) })}
        onReject={(note) => reject.mutate({ id: groupId, ...(note === '' ? {} : { note }) })}
      />
    </SectionCard>
  );
};
