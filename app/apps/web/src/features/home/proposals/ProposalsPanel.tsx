import { useEffect, useId, useRef, useState, type SyntheticEvent } from 'react';
import { Alert, AlertTitle, Box, Button, Chip, Stack, Tab, Tabs, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';

import { CHANGE_PROPOSAL_WITHDRAWAL_NOTES, type ChangeProposalEventView, type ChangeProposalOwnerView } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { PanelPage, StatusView } from '../../../components/layout/index.js';
import { PanelListRow } from '../../../components/ui/PanelListRow.js';
import { localizePanelError, useLanguage, useTranslations, type Messages } from '../../../i18n/index.js';
import { formatDateTime } from '../../../lib/format.js';
import { EntryDate, FinePrint, WrapAnywhereText } from '../../../theme.js';
import { usePanelContext } from '../panel-context.js';
import {
  GroupProposalCard,
  operationTitle,
  outcomeExplanation,
  ProposalBody,
  SingleProposalCard,
  TargetLine,
  type SettledOutcome,
} from './ProposalCards.js';
import { groupReferences } from './proposal-display.js';

type ProposalTab = 'pending' | 'history';

type Translations = Messages['changeProposals'];

const PENDING_PAGE_SIZE = 100;
const HISTORY_PAGE_SIZE = 50;

type PendingCard =
  | { kind: 'single'; createdAt: string; proposal: ChangeProposalOwnerView }
  | { kind: 'group'; createdAt: string; groupId: string; itemCount: number };

const pendingCards = (proposals: readonly ChangeProposalOwnerView[]): PendingCard[] => {
  const groups = new Map<string, { createdAt: string; itemCount: number }>();
  const singles: PendingCard[] = [];
  for (const proposal of proposals) {
    if (proposal.groupId === null) {
      singles.push({ kind: 'single', createdAt: proposal.createdAt, proposal });
      continue;
    }
    const known = groups.get(proposal.groupId);
    groups.set(proposal.groupId, {
      createdAt: known === undefined || proposal.createdAt < known.createdAt ? proposal.createdAt : known.createdAt,
      itemCount: (known?.itemCount ?? 0) + 1,
    });
  }
  const grouped: PendingCard[] = [...groups].map(([groupId, group]) => ({ kind: 'group', groupId, ...group }));
  return [...singles, ...grouped].toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
};

const SettledNotice = ({ outcome, onDismiss }: { outcome: SettledOutcome; onDismiss: () => void }) => {
  const t = useTranslations().changeProposals;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <Alert
      ref={ref}
      tabIndex={-1}
      severity="warning"
      closeText={t.dismiss}
      onClose={onDismiss}
      data-testid={`proposal-outcome-${outcome.key}`}
    >
      <AlertTitle>{outcome.title}</AlertTitle>
      {outcomeExplanation(t, outcome.status, outcome.reason)}
    </Alert>
  );
};

const PendingList = ({
  proposals,
  onLoadMore,
  loadingMore,
}: {
  proposals: readonly ChangeProposalOwnerView[];
  onLoadMore: (() => void) | null;
  loadingMore: boolean;
}) => {
  const t = useTranslations().changeProposals;
  const [settled, setSettled] = useState<SettledOutcome[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const cards = pendingCards(proposals);
  const callbacks = {
    onSettled: (outcome: SettledOutcome) => setSettled((current) => [outcome, ...current.filter((entry) => entry.key !== outcome.key)]),
    onDecided: () => listRef.current?.focus(),
  };
  return (
    <Stack ref={listRef} tabIndex={-1} useFlexGap spacing="1.25rem" data-testid="proposals-pending" aria-label={t.tabPending}>
      {settled.map((outcome) => (
        <SettledNotice
          key={outcome.key}
          outcome={outcome}
          onDismiss={() => {
            setSettled((current) => current.filter((entry) => entry.key !== outcome.key));
            listRef.current?.focus();
          }}
        />
      ))}
      {cards.length === 0 && !loadingMore ? (
        <StatusView
          data-testid="proposals-pending-empty"
          state={{ kind: 'empty', title: t.pendingEmptyTitle, body: t.pendingEmptyBody }}
        />
      ) : null}
      {cards.map((card) => card.kind === 'single' ? (
        <SingleProposalCard key={card.proposal.id} proposal={card.proposal} {...callbacks} />
      ) : (
        <GroupProposalCard key={card.groupId} groupId={card.groupId} itemCount={card.itemCount} {...callbacks} />
      ))}
      {loadingMore ? <StatusView state={{ kind: 'loading', label: t.loading }} /> : null}
      {onLoadMore === null ? null : (
        <Button variant="outlined" onClick={onLoadMore} data-testid="proposals-load-more">{t.loadMore}</Button>
      )}
    </Stack>
  );
};

const PendingPage = ({ cursor, earlier }: { cursor: string | undefined; earlier: readonly ChangeProposalOwnerView[] }) => {
  const t = useTranslations();
  const page = useQuery(actions.changeProposals({
    status: 'pending',
    limit: PENDING_PAGE_SIZE,
    ...(cursor === undefined ? {} : { cursor }),
  }));
  const [more, setMore] = useState(false);
  if (page.isPending) {
    return earlier.length === 0
      ? <StatusView state={{ kind: 'loading', label: t.changeProposals.loading }} />
      : <PendingList proposals={earlier} onLoadMore={null} loadingMore />;
  }
  if (page.isError) {
    return (
      <StatusView
        state={{ kind: 'error', message: localizePanelError(page.error, t), retry: { label: t.common.retry, onRetry: () => void page.refetch() } }}
      />
    );
  }
  const proposals = [...earlier, ...page.data.proposals];
  const next = page.data.nextCursor;
  if (more && next !== null) return <PendingPage cursor={next} earlier={proposals} />;
  return <PendingList proposals={proposals} onLoadMore={next === null ? null : () => setMore(true)} loadingMore={false} />;
};

const eventNote = (t: Translations, event: ChangeProposalEventView): string | null => {
  if (event.note === null) return null;
  if (event.kind === 'rejected') return t.decisionNote({ note: event.note });
  if (event.note === CHANGE_PROPOSAL_WITHDRAWAL_NOTES.keyRevoked) return t.eventNoteKeyRevoked;
  if (event.note === CHANGE_PROPOSAL_WITHDRAWAL_NOTES.keyPurged) return t.eventNoteKeyPurged;
  return null;
};

const HistoryDetails = ({ proposal, siblings }: { proposal: ChangeProposalOwnerView; siblings: readonly ChangeProposalOwnerView[] }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const detail = useQuery(actions.changeProposal(proposal.id));
  const references = proposal.groupId === null ? undefined : groupReferences(siblings.filter((entry) => entry.groupId === proposal.groupId));
  if (detail.isPending) return <StatusView state={{ kind: 'loading', label: t.changeProposals.detailsLoading }} />;
  if (detail.isError) {
    return (
      <StatusView
        state={{ kind: 'error', message: localizePanelError(detail.error, t), retry: { label: t.common.retry, onRetry: () => void detail.refetch() } }}
      />
    );
  }
  return (
    <Stack useFlexGap spacing="1rem">
      <ProposalBody proposal={detail.data.proposal} {...(references === undefined ? {} : { references })} live={false} labelComponent="h4" />
      <Stack useFlexGap spacing="0.35rem">
        <Typography variant="h3" component="h3">{t.changeProposals.timelineHeading}</Typography>
        <Stack component="ol" useFlexGap spacing="0.25rem" sx={{ m: 0, pl: '1.1rem' }} data-testid="proposal-timeline">
          {detail.data.proposal.events.map((event) => {
            const note = eventNote(t.changeProposals, event);
            return (
              <Typography key={event.sequence} component="li" variant="body2">
                <EntryDate component="time" dateTime={event.at}>{formatDateTime(event.at, language)}</EntryDate>
                {` · ${t.changeProposals.event[event.kind]}`}
                {note === null ? null : ` · ${note}`}
              </Typography>
            );
          })}
        </Stack>
      </Stack>
    </Stack>
  );
};

const HistoryRow = ({ proposal, siblings }: { proposal: ChangeProposalOwnerView; siblings: readonly ChangeProposalOwnerView[] }) => {
  const t = useTranslations().changeProposals;
  const { language } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const explanation = outcomeExplanation(t, proposal.status, proposal.failureMessage);
  const decided = proposal.decidedAt === null
    ? null
    : proposal.decidedByEmail === null
      ? t.decidedByUnknown({ date: formatDateTime(proposal.decidedAt, language) })
      : t.decidedBy({ who: proposal.decidedByEmail, date: formatDateTime(proposal.decidedAt, language) });
  return (
    <PanelListRow
      data-testid={`proposal-history-${proposal.id}`}
      title={operationTitle(t, proposal.operation)}
      badges={<Chip size="small" variant="outlined" label={t.status[proposal.status]} data-testid="proposal-history-status" />}
      actions={(
        <Button
          variant="text"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded(!expanded)}
          data-testid="proposal-history-toggle"
        >
          {expanded ? t.hideDetails : t.showDetails}
        </Button>
      )}
      meta={(
        <>
          <TargetLine proposal={proposal} />
          {proposal.groupId === null || proposal.groupTitle === null ? null : (
            <WrapAnywhereText variant="body2" component="p">
              {t.partOfGroup({ title: proposal.groupTitle, position: proposal.groupPosition ?? 1 })}
            </WrapAnywhereText>
          )}
          <FinePrint component="p">
            {t.proposedBy({ key: proposal.proposedBy.keyName })}
            {` · ${t.proposedAt({ date: formatDateTime(proposal.createdAt, language) })}`}
          </FinePrint>
          {decided === null ? null : <FinePrint component="p">{decided}</FinePrint>}
          {proposal.decisionNote === null ? null : (
            <WrapAnywhereText variant="body2" component="p">{t.decisionNote({ note: proposal.decisionNote })}</WrapAnywhereText>
          )}
          {explanation === null ? null : <Typography variant="body2" component="p">{explanation}</Typography>}
        </>
      )}
    >
      {expanded ? (
        <Box id={detailsId}>
          <HistoryDetails proposal={proposal} siblings={siblings} />
        </Box>
      ) : null}
    </PanelListRow>
  );
};

const HistoryTab = () => {
  const t = useTranslations();
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [previousCursors, setPreviousCursors] = useState<(string | undefined)[]>([]);
  const page = useQuery(actions.changeProposals({ limit: HISTORY_PAGE_SIZE, ...(cursor === undefined ? {} : { cursor }) }));
  if (page.isPending) return <StatusView state={{ kind: 'loading', label: t.changeProposals.loading }} />;
  if (page.isError) {
    return (
      <StatusView
        state={{ kind: 'error', message: localizePanelError(page.error, t), retry: { label: t.common.retry, onRetry: () => void page.refetch() } }}
      />
    );
  }
  const decided = page.data.proposals.filter((proposal) => proposal.status !== 'pending');
  const next = page.data.nextCursor;
  if (decided.length === 0 && next === null && previousCursors.length === 0) {
    return (
      <StatusView
        data-testid="proposals-history-empty"
        state={{ kind: 'empty', title: t.changeProposals.historyEmptyTitle, body: t.changeProposals.historyEmptyBody }}
      />
    );
  }
  return (
    <Stack useFlexGap spacing="0.75rem" data-testid="proposals-history">
      {decided.map((proposal) => (
        <HistoryRow key={proposal.id} proposal={proposal} siblings={page.data.proposals} />
      ))}
      <Stack direction="row" useFlexGap spacing="0.75rem" sx={{ justifyContent: 'flex-end' }}>
        <Button
          disabled={previousCursors.length === 0}
          onClick={() => {
            setCursor(previousCursors.at(-1));
            setPreviousCursors(previousCursors.slice(0, -1));
          }}
        >
          {t.pagination.previousPage}
        </Button>
        <Button
          data-testid="proposals-history-next"
          disabled={next === null}
          onClick={() => {
            if (next === null) return;
            setPreviousCursors((history) => [...history, cursor]);
            setCursor(next);
          }}
        >
          {t.pagination.nextPage}
        </Button>
      </Stack>
    </Stack>
  );
};

export const ProposalsPanel = () => {
  const { tenant } = usePanelContext();
  const t = useTranslations();
  const navigate = useNavigate();
  const hash = useRouterState({ select: (state) => state.location.hash });
  const tab: ProposalTab = hash === 'history' ? 'history' : 'pending';

  if (tenant.staffRole !== 'owner') {
    return (
      <PanelPage
        title={t.changeProposals.heading}
        data-testid="proposals-owner-only"
        state={{ kind: 'not-found', title: t.changeProposals.ownerOnlyTitle, body: t.changeProposals.ownerOnlyBody }}
      />
    );
  }

  const changeTab = (_event: SyntheticEvent, value: ProposalTab) => {
    void navigate({ hash: value, replace: true });
  };

  return (
    <PanelPage title={t.changeProposals.heading} description={t.changeProposals.description} data-testid="proposals-page">
      <Tabs value={tab} onChange={changeTab} aria-label={t.changeProposals.tabsAria}>
        <Tab id="proposals-tab-pending" aria-controls="proposals-panel-pending" value="pending" label={t.changeProposals.tabPending} />
        <Tab id="proposals-tab-history" aria-controls="proposals-panel-history" value="history" label={t.changeProposals.tabHistory} />
      </Tabs>
      {tab === 'pending' ? (
        <Box id="proposals-panel-pending" role="tabpanel" aria-labelledby="proposals-tab-pending">
          <PendingPage cursor={undefined} earlier={[]} />
        </Box>
      ) : (
        <Box id="proposals-panel-history" role="tabpanel" aria-labelledby="proposals-tab-history">
          <HistoryTab />
        </Box>
      )}
    </PanelPage>
  );
};
