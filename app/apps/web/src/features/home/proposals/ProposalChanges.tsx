import { useId, useState, type ReactNode } from 'react';
import { Box, Button, Paper, Stack, Typography } from '@mui/material';

import { stockAdjustmentEventType, type ChangeProposalOwnerView, type ChangeProposalTargetKind } from '#core/domain/index.js';

import { useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDateTime, formatFileSize, formatPrice } from '../../../lib/format.js';
import { FinePrint, PreLineText } from '../../../theme.js';
import { FieldDiffEmpty, FieldDiffImage, FieldDiffList, FieldDiffRow, FieldDiffText } from '../FieldDiff.js';
import {
  priceOf,
  proposalCreatesRecord,
  proposalRemovesRecord,
  proposalRows,
  stockAdjustmentReason,
  type DisplayRow,
  type DisplayValue,
  type GroupItemReference,
  type GroupReferences,
} from './proposal-display.js';
import { enumValueLabel, fieldLabel, Isolated, priceTerms } from './proposal-text.js';

const COLLAPSED_LENGTH = 280;

export const ReferenceText = ({ reference }: { reference: GroupItemReference }) => {
  const t = useTranslations().changeProposals;
  const thing = t.referenceKind[reference.thing];
  return reference.label === null
    ? <>{t.reference({ thing, position: reference.position })}</>
    : <Isolated sentence={(label) => t.referenceWithLabel({ thing, position: reference.position, label })} value={reference.label} />;
};

const amountText = (amountCents: number, currency: string | null, language: string): string =>
  currency === null ? (amountCents / 100).toFixed(2) : formatPrice(amountCents, currency, language);

const ValueText = ({ value }: { value: DisplayValue }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const proposals = t.changeProposals;
  switch (value.kind) {
    case 'empty':
      return <>{proposals.emptyValue}</>;
    case 'text':
      return <bdi>{value.text}</bdi>;
    case 'boolean':
      return <>{value.value ? proposals.yes : proposals.no}</>;
    case 'number':
      return <>{String(value.value)}</>;
    case 'money':
      return <>{amountText(value.amountCents, value.currency, language)}</>;
    case 'enum':
      return <>{enumValueLabel(t, value.field, value.value)}</>;
    case 'price':
      return <>{priceTerms(proposals, value, language)}</>;
    case 'date':
      return <>{formatDateTime(value.iso, language)}</>;
    case 'image':
      return <bdi>{value.path}</bdi>;
    case 'reference':
      return <ReferenceText reference={value} />;
    case 'file':
      return value.sizeBytes === null
        ? <bdi>{value.fileName}</bdi>
        : <><bdi>{value.fileName}</bdi>{` · ${formatFileSize(value.sizeBytes, language)}`}</>;
    case 'list':
      return <>{value.items.map((item, index) => <span key={index}>{index === 0 ? null : ', '}<ValueText value={item} /></span>)}</>;
    case 'record':
      return <RecordText entries={value.entries} />;
  }
};

const RecordText = ({ entries }: { entries: Extract<DisplayValue, { kind: 'record' }>['entries'] }) => {
  const t = useTranslations().changeProposals;
  return (
    <>
      {entries.map((entry, index) => (
        <span key={entry.field}>
          {index === 0 ? null : '; '}
          {`${fieldLabel(t, entry.field)}: `}
          <ValueText value={entry.value} />
        </span>
      ))}
    </>
  );
};

const LongText = ({ text, initiallyExpanded }: { text: string; initiallyExpanded: boolean }) => {
  const t = useTranslations().changeProposals;
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const id = useId();
  const collapsible = text.length > COLLAPSED_LENGTH;
  return (
    <Stack useFlexGap spacing="0.25rem" sx={{ alignItems: 'flex-start' }}>
      <PreLineText id={id} variant="body2">
        <bdi>{collapsible && !expanded ? `${text.slice(0, COLLAPSED_LENGTH)}…` : text}</bdi>
      </PreLineText>
      {collapsible ? (
        <Button size="small" variant="text" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)}>
          {expanded ? t.showLess : t.showMore}
        </Button>
      ) : null}
    </Stack>
  );
};

const ProposalValue = ({ value, initiallyExpanded = false }: { value: DisplayValue; initiallyExpanded?: boolean }) => {
  const t = useTranslations().changeProposals;
  switch (value.kind) {
    case 'empty':
      return <FieldDiffEmpty>{t.emptyValue}</FieldDiffEmpty>;
    case 'text':
      return value.long
        ? <LongText text={value.text} initiallyExpanded={initiallyExpanded} />
        : <FieldDiffText breakAnywhere={value.breakAnywhere}><bdi>{value.text}</bdi></FieldDiffText>;
    case 'image':
      return <FieldDiffImage key={value.path} url={value.path} failedNote={t.imageNotShown} />;
    case 'list':
      return <FieldDiffList items={value.items.map((item, index) => ({ key: String(index), content: <ValueText value={item} /> }))} />;
    case 'record':
      return (
        <FieldDiffList
          items={value.entries.map((entry) => ({
            key: entry.field,
            content: <>{`${fieldLabel(t, entry.field)}: `}<ValueText value={entry.value} /></>,
          }))}
        />
      );
    case 'boolean':
    case 'number':
    case 'money':
    case 'enum':
    case 'price':
    case 'date':
    case 'reference':
    case 'file':
      return <FieldDiffText breakAnywhere><ValueText value={value} /></FieldDiffText>;
  }
};

const sameCollapsedStart = (row: Extract<DisplayRow, { kind: 'change' }>): boolean =>
  row.before?.kind === 'text' && row.after?.kind === 'text' && (row.before.long || row.after.long)
  && row.before.text.slice(0, COLLAPSED_LENGTH) === row.after.text.slice(0, COLLAPSED_LENGTH);

export type StockNow = { tracked: false } | { tracked: true; onHand: number };

type HeadingLevel = 'h3' | 'h4';

const StockDeltaRow = ({
  row,
  proposal,
  stockNow,
  labelComponent,
}: {
  row: Extract<DisplayRow, { kind: 'delta' }>;
  proposal: Pick<ChangeProposalOwnerView, 'input'>;
  stockNow: StockNow | undefined;
  labelComponent: HeadingLevel;
}) => {
  const t = useTranslations().changeProposals;
  const reason = stockAdjustmentReason(proposal);
  const returned = reason !== null && stockAdjustmentEventType(row.delta, reason) === 'returned';
  return (
    <FieldDiffRow
      label={t.stockDeltaLabel}
      labelComponent={labelComponent}
      changed
      data-testid="proposal-stock-delta"
      columns={[{
        label: t.columnAfter,
        value: (
          <Stack useFlexGap spacing="0.25rem">
            <Typography variant="body1" component="p">{t.stockDelta({ delta: row.delta })}</Typography>
            {reason === null ? null : (
              <FieldDiffText breakAnywhere>
                {returned ? t.stockReason({ reason: t.stockReasonReturned }) : <Isolated sentence={(slot) => t.stockReason({ reason: slot })} value={reason} />}
              </FieldDiffText>
            )}
            {stockNow === undefined ? null : (
              <FinePrint component="p">
                {stockNow.tracked ? t.stockOnHandNow({ count: stockNow.onHand }) : t.stockNotTrackedNow}
              </FinePrint>
            )}
            <FinePrint component="p">{t.stockDeltaRule}</FinePrint>
          </Stack>
        ),
      }]}
    />
  );
};

interface NewRecordEntry {
  field: string;
  label: string;
  value: ReactNode;
}

const NewRecord = ({ entries }: { entries: readonly NewRecordEntry[] }) => {
  const t = useTranslations().changeProposals;
  return (
    <Paper variant="outlined" sx={{ p: '1rem' }} data-testid="proposal-new-record">
      <FinePrint component="p">{t.newRecordCaption}</FinePrint>
      <Box
        component="dl"
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'minmax(8rem, 13rem) minmax(0, 1fr)' },
          columnGap: '1rem',
          rowGap: { xs: '0.15rem', sm: '0.6rem' },
          m: 0,
          mt: '0.75rem',
        }}
      >
        {entries.map((entry) => (
          <Box key={entry.field} sx={{ display: 'contents' }} data-testid={`proposal-field-${entry.field}`}>
            <Typography component="dt" variant="body2" color="text.secondary" sx={{ pt: { xs: '0.5rem', sm: 0 } }}>
              {entry.label}
            </Typography>
            <Box component="dd" sx={{ m: 0, minWidth: 0 }}>
              {entry.value}
            </Box>
          </Box>
        ))}
      </Box>
    </Paper>
  );
};

export const ProposalFieldRows = ({
  proposal,
  targetKind,
  references,
  stockNow,
  labelComponent = 'h3',
}: {
  proposal: Pick<ChangeProposalOwnerView, 'effect' | 'input'> & Partial<Pick<ChangeProposalOwnerView, 'operation'>>;
  targetKind?: ChangeProposalTargetKind;
  references?: GroupReferences;
  stockNow?: StockNow | undefined;
  labelComponent?: HeadingLevel;
}) => {
  const t = useTranslations().changeProposals;
  const { language } = useLanguage();
  const rows = proposalRows(proposal, references);
  const removal = proposalRemovesRecord(proposal);
  const newPrice = proposal.operation === 'price.create' ? priceOf(proposal.input) : null;
  if (newPrice !== null) {
    return <NewRecord entries={[{ field: 'price', label: t.fields.priceCents, value: <FieldDiffText breakAnywhere>{priceTerms(t, newPrice, language)}</FieldDiffText> }]} />;
  }
  if (rows.length === 0) return <FinePrint component="p">{t.noFieldChanges}</FinePrint>;
  if (proposalCreatesRecord(proposal)) {
    const entries = rows.flatMap((row): NewRecordEntry[] => row.kind === 'change' && row.after !== null
      ? [{ field: row.field, label: fieldLabel(t, row.field, targetKind), value: <ProposalValue value={row.after} /> }]
      : []);
    return <NewRecord entries={entries} />;
  }
  return (
    <Stack useFlexGap spacing="0.5rem" data-testid="proposal-field-rows">
      {rows.map((row) => {
        if (row.kind === 'delta') {
          return <StockDeltaRow key={row.field} row={row} proposal={proposal} stockNow={stockNow} labelComponent={labelComponent} />;
        }
        const expanded = sameCollapsedStart(row);
        const columns = [
          ...(row.before === null ? [] : [{
            label: removal ? t.columnRemoved : t.columnNow,
            value: <ProposalValue value={row.before} initiallyExpanded={expanded} />,
          }]),
          ...(row.after === null ? [] : [{ label: t.columnAfter, value: <ProposalValue value={row.after} initiallyExpanded={expanded} /> }]),
        ];
        return (
          <FieldDiffRow
            key={row.field}
            label={fieldLabel(t, row.field, targetKind)}
            labelComponent={labelComponent}
            changed={row.before !== null && row.after !== null}
            data-testid={`proposal-field-${row.field}`}
            columns={columns}
          />
        );
      })}
    </Stack>
  );
};
