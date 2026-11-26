import { useEffect, useId, useRef, useState, type SyntheticEvent } from 'react';
import { Alert, AlertTitle, Box, Button, Chip, Stack, Tab, Tabs, Typography } from '@mui/material';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';

import {
  CHANGE_PROPOSAL_WITHDRAWAL_NOTES,
  type ChangeProposalEventView,
  type ChangeProposalOwnerView,
} from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { PanelPage, StatusView } from '../../../components/layout/index.js';
import { PanelListRow } from '../../../components/ui/PanelListRow.js';
import { localizePanelError, useLanguage, useTranslations, type Messages } from '../../../i18n/index.js';
import { formatDateTime } from '../../../lib/format.js';
import { EntryDate, FinePrint, WrapAnywhereText } from '../../../theme.js';
import { usePanelContext } from '../panel-context.js';
import {
  GroupProposalCard,
  failureOf,
  GroupTitle,
  mayBeStaleForMissingAsset,
  missingAssetOf,
  outcomeExplanation,
  ProposalBody,
  ProposedBy,
  SingleProposalCard,
  staleForMissingAsset,
  TargetLine,
  type MissingAsset,
  type SettledOutcome,
  type StaleCause,
} from './ProposalCards.js';
import { groupReferences } from './proposal-display.js';
import { Isolated, operationTitle } from './proposal-text.js';

type ProposalTab = 'pending' | 'history';

type Translations = Messages['changeProposals'];

const PENDING_PAGE_SIZE = 100;
const HISTORY_PAGE_SIZE = 50;

type PendingCard =
  | { kind: 'single'; key: string; createdAt: string; proposal: ChangeProposalOwnerView }
  | { kind: 'group'; key: string; createdAt: string; groupId: string; itemCount: number };

const pendingCards = (proposals: readonly ChangeProposalOwnerView[]): PendingCard[] => {
  const groups = new Map<string, { createdAt: string; itemCount: number }>();
  const singles: PendingCard[] = [];
  for (const proposal of proposals) {
    if (proposal.groupId === null) {
      singles.push({ kind: 'single', key: proposal.id, createdAt: proposal.createdAt, proposal });
      continue;
    }
    const known = groups.get(proposal.groupId);
    groups.set(proposal.groupId, {
      createdAt: known === undefined || proposal.createdAt < known.createdAt ? proposal.createdAt : known.createdAt,
      itemCount: (known?.itemCount ?? 0) + 1,
    });
  }
  const grouped: PendingCard[] = [...groups].map(([groupId, group]) => ({ kind: 'group', key: `group:${groupId}`, groupId, ...group }));
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
      {outcomeExplanation(t, outcome.status, outcome.failure, outcome.missing)}
    </Alert>
  );
};

const PendingTab = () => {
  const t = useTranslations();
  const pages = useInfiniteQuery(actions.changeProposalPages({ status: 'pending', limit: PENDING_PAGE_SIZE }));
  const [settled, setSettled] = useState<SettledOutcome[]>([]);
  const [focusAfterMore, setFocusAfterMore] = useState<{ known: ReadonlySet<string>; pageCount: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pageCount = pages.data?.pages.length ?? 0;
  const cards = pendingCards(pages.data?.pages.flatMap((page) => page.proposals) ?? []);
  const cardKeys = cards.map((card) => card.key).join('\n');
  const moreFailed = pages.isFetchNextPageError && !pages.isFetchingNextPage;

  useEffect(() => {
    if (focusAfterMore === null) return;
    if (moreFailed) {
      setFocusAfterMore(null);
      return;
    }
    if (pageCount <= focusAfterMore.pageCount) return;
    setFocusAfterMore(null);
    const first = cardKeys.split('\n').find((key) => !focusAfterMore.known.has(key));
    const cardElements = listRef.current?.querySelectorAll<HTMLElement>('[data-card-key]') ?? [];
    [...cardElements].find((element) => element.dataset['cardKey'] === first)?.focus();
  }, [cardKeys, focusAfterMore, moreFailed, pageCount]);

  if (pages.data === undefined) {
    return pages.isError
      ? <StatusView state={{ kind: 'error', message: localizePanelError(pages.error, t), retry: { label: t.common.retry, onRetry: () => void pages.refetch() } }} />
      : <StatusView state={{ kind: 'loading', label: t.changeProposals.loading }} />;
  }

  const callbacks = {
    onSettled: (outcome: SettledOutcome) => setSettled((current) => [outcome, ...current.filter((entry) => entry.key !== outcome.key)]),
    onDecided: () => listRef.current?.focus(),
  };
  const loadMore = () => {
    setFocusAfterMore({ known: new Set(cards.map((card) => card.key)), pageCount });
    void pages.fetchNextPage();
  };

  return (
    <Stack ref={listRef} tabIndex={-1} useFlexGap spacing="1.25rem" data-testid="proposals-pending" aria-label={t.changeProposals.tabPending}>
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
      {cards.length === 0 ? (
        <StatusView
          data-testid="proposals-pending-empty"
          state={{ kind: 'empty', title: t.changeProposals.pendingEmptyTitle, body: t.changeProposals.pendingEmptyBody }}
        />
      ) : null}
      {cards.map((card) => (
        <Box key={card.key} data-card-key={card.key} tabIndex={-1}>
          {card.kind === 'single'
            ? <SingleProposalCard proposal={card.proposal} {...callbacks} />
            : <GroupProposalCard groupId={card.groupId} itemCount={card.itemCount} {...callbacks} />}
        </Box>
      ))}
      {pages.isFetchingNextPage ? <StatusView state={{ kind: 'loading', label: t.changeProposals.loading }} /> : null}
      {moreFailed ? (
        <Alert
          severity="error"
          data-testid="proposals-load-more-error"
          action={<Button color="inherit" size="small" onClick={loadMore}>{t.common.retry}</Button>}
        >
          {t.changeProposals.loadMoreFailed}
        </Alert>
      ) : null}
      {pages.hasNextPage && !pages.isFetchingNextPage && !moreFailed ? (
        <Button variant="outlined" onClick={loadMore} data-testid="proposals-load-more">{t.changeProposals.loadMore}</Button>
      ) : null}
    </Stack>
  );
};

const eventLabel = (t: Translations, event: ChangeProposalEventView): string => {
  const missing = missingAssetOf(event);
  if (missing === 'image') return t.eventStaleImageUnavailable;
  return missing === 'file' ? t.eventStaleFileUnavailable : t.event[event.kind];
};

const statusLabel = (t: Translations, proposal: Pick<ChangeProposalOwnerView, 'status'>, missing: MissingAsset | null): string => {
  if (missing === 'image') return t.statusStaleImageUnavailable;
  return missing === 'file' ? t.statusStaleFileUnavailable : t.status[proposal.status];
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
      <ProposalBody proposal={detail.data.proposal} {...(references === undefined ? {} : { references })} live={false} labelComponent="h3" />
      <Stack useFlexGap spacing="0.35rem">
        <Typography variant="h3" component="h3">{t.changeProposals.timelineHeading}</Typography>
        <Stack component="ol" useFlexGap spacing="0.25rem" sx={{ m: 0, pl: '1.1rem' }} data-testid="proposal-timeline">
          {detail.data.proposal.events.map((event) => {
            const note = eventNote(t.changeProposals, event);
            return (
              <Typography key={event.sequence} component="li" variant="body2">
                <EntryDate component="time" dateTime={event.at}>{formatDateTime(event.at, language)}</EntryDate>
                {` · ${eventLabel(t.changeProposals, event)}`}
                {note === null ? null : <>{' · '}<bdi>{note}</bdi></>}
              </Typography>
            );
          })}
        </Stack>
      </Stack>
    </Stack>
  );
};

const decidedLine = (t: Translations, proposal: ChangeProposalOwnerView, language: string): string | null => {
  if (proposal.decidedAt === null) return null;
  const date = formatDateTime(proposal.decidedAt, language);
  if (proposal.decidedByEmail !== null) return t.decidedBy({ who: proposal.decidedByEmail, date });
  return proposal.decidedByIsFormerTeamMember ? t.decidedByFormerTeamMember({ date }) : t.decidedByUnknown({ date });
};

const HistoryRow = ({ proposal, siblings }: { proposal: ChangeProposalOwnerView; siblings: readonly ChangeProposalOwnerView[] }) => {
  const t = useTranslations().changeProposals;
  const { language } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const assetStale = mayBeStaleForMissingAsset(proposal);
  const detail = useQuery({ ...actions.changeProposal(proposal.id), enabled: assetStale });
  const missing = assetStale && detail.data !== undefined ? staleForMissingAsset(detail.data.proposal.events) : null;
  const cause: StaleCause | null = assetStale && detail.data === undefined ? 'unconfirmed' : missing;
  const explanation = outcomeExplanation(t, proposal.status, failureOf(proposal), cause);
  const decided = decidedLine(t, proposal, language);
  const keyName = proposal.proposedBy.keyName;
  return (
    <PanelListRow
      data-testid={`proposal-history-${proposal.id}`}
      title={operationTitle(t, proposal.operation)}
      badges={(
        <>
          <Chip
            size="small"
            variant="outlined"
            label={statusLabel(t, proposal, missing)}
            data-testid="proposal-history-status"
          />
          <Button
            size="small"
            variant="text"
            aria-expanded={expanded}
            aria-controls={detailsId}
            onClick={() => setExpanded(!expanded)}
            data-testid="proposal-history-toggle"
            sx={{ ml: 'auto' }}
          >
            {expanded ? t.hideDetails : t.showDetails}
          </Button>
        </>
      )}
      meta={(
        <>
          <TargetLine proposal={proposal} />
          {proposal.groupId === null ? null : (
            <WrapAnywhereText variant="body2" component="p">{t.partOfGroup({ position: proposal.groupPosition ?? 1 })}</WrapAnywhereText>
          )}
          {proposal.groupTitle === null ? null : (
            <GroupTitle title={proposal.groupTitle} keyLabel={keyName ?? proposal.proposedBy.keyId} compact />
          )}
          <FinePrint component="p">
            {keyName === null ? null : <><ProposedBy keyName={keyName} />{' · '}</>}
            {t.proposedAt({ date: formatDateTime(proposal.createdAt, language) })}
          </FinePrint>
          {decided === null ? null : <FinePrint component="p">{decided}</FinePrint>}
          {proposal.decisionNote === null ? null : (
            <WrapAnywhereText variant="body2" component="p">
              <Isolated sentence={(note) => t.decisionNote({ note })} value={proposal.decisionNote} />
            </WrapAnywhereText>
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
  const page = useQuery(actions.changeProposals({ status: 'decided', limit: HISTORY_PAGE_SIZE, ...(cursor === undefined ? {} : { cursor }) }));
  if (page.data === undefined) {
    return page.isError
      ? <StatusView state={{ kind: 'error', message: localizePanelError(page.error, t), retry: { label: t.common.retry, onRetry: () => void page.refetch() } }} />
      : <StatusView state={{ kind: 'loading', label: t.changeProposals.loading }} />;
  }
  const { proposals } = page.data;
  const next = page.data.hasMore ? page.data.nextCursor : null;
  const paging = previousCursors.length > 0 || next !== null;
  return (
    <Stack useFlexGap spacing="0.75rem" data-testid="proposals-history">
      {proposals.length === 0 ? (
        <StatusView
          data-testid="proposals-history-empty"
          state={{ kind: 'empty', title: t.changeProposals.historyEmptyTitle, body: t.changeProposals.historyEmptyBody }}
        />
      ) : proposals.map((proposal) => (
        <HistoryRow key={proposal.id} proposal={proposal} siblings={proposals} />
      ))}
      {paging ? (
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
      ) : null}
    </Stack>
  );
};

export const ProposalsPanel = () => {
  const { tenant, emailVerified, impersonating = false } = usePanelContext();
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
  if (impersonating) {
    return (
      <PanelPage
        title={t.changeProposals.heading}
        data-testid="proposals-impersonating"
        state={{ kind: 'empty', title: t.changeProposals.impersonatingTitle, body: t.changeProposals.impersonatingBody }}
      />
    );
  }
  if (!emailVerified) {
    return (
      <PanelPage
        title={t.changeProposals.heading}
        data-testid="proposals-unverified"
        state={{
          kind: 'empty',
          title: t.changeProposals.unverifiedTitle,
          body: t.changeProposals.unverifiedBody,
          action: <Button variant="outlined" component={Link} to="/account">{t.panel.myAccount}</Button>,
        }}
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
          <PendingTab />
        </Box>
      ) : (
        <Box id="proposals-panel-history" role="tabpanel" aria-labelledby="proposals-tab-history">
          <HistoryTab />
        </Box>
      )}
    </PanelPage>
  );
};
