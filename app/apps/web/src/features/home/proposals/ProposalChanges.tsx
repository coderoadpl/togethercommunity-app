import { useId, useState } from 'react';
import { Button, Stack, Typography } from '@mui/material';

import type { ChangeProposalOwnerView } from '#core/domain/index.js';

import { useLanguage, useTranslations, type Messages } from '../../../i18n/index.js';
import { formatDateTime, formatFileSize, formatPrice } from '../../../lib/format.js';
import { FinePrint, PreLineText } from '../../../theme.js';
import { FieldDiffEmpty, FieldDiffImage, FieldDiffList, FieldDiffRow, FieldDiffText } from '../FieldDiff.js';
import {
  proposalInputText,
  proposalRemovesRecord,
  proposalRows,
  type DisplayValue,
  type GroupItemReference,
  type GroupReferences,
} from './proposal-display.js';

type Translations = Messages['changeProposals'];

const COLLAPSED_LENGTH = 280;

const isKnownField = (fields: Translations['fields'], field: string): field is keyof Translations['fields'] =>
  Object.hasOwn(fields, field);

const fieldLabel = (t: Translations, field: string): string =>
  isKnownField(t.fields, field) ? t.fields[field] : field;

export const referenceText = (t: Translations, reference: GroupItemReference): string => {
  const thing = t.referenceKind[reference.thing];
  return reference.label === null
    ? t.reference({ thing, position: reference.position })
    : t.referenceWithLabel({ thing, position: reference.position, label: reference.label });
};

const amountText = (amountCents: number, currency: string | null, language: string): string =>
  currency === null ? (amountCents / 100).toFixed(2) : formatPrice(amountCents, currency, language);

const valueText = (value: DisplayValue, t: Translations, language: string): string => {
  switch (value.kind) {
    case 'empty':
      return t.emptyValue;
    case 'text':
      return value.text;
    case 'boolean':
      return value.value ? t.yes : t.no;
    case 'number':
      return String(value.value);
    case 'money':
      return amountText(value.amountCents, value.currency, language);
    case 'price': {
      const price = formatPrice(value.amountCents, value.currency, language);
      const terms = value.interval === null
        ? t.priceOneTime({ price })
        : t.priceRecurring({ price, interval: t.priceInterval[value.interval] });
      return value.active === false ? t.priceInactive({ price: terms }) : terms;
    }
    case 'date':
      return formatDateTime(value.iso, language);
    case 'image':
      return value.path;
    case 'reference':
      return referenceText(t, value);
    case 'file':
      return value.sizeBytes === null ? value.fileName : `${value.fileName} · ${formatFileSize(value.sizeBytes, language)}`;
    case 'list':
      return value.items.map((item) => valueText(item, t, language)).join(', ');
    case 'record':
      return value.entries.map((entry) => `${fieldLabel(t, entry.field)}: ${valueText(entry.value, t, language)}`).join('; ');
  }
};

const LongText = ({ text }: { text: string }) => {
  const t = useTranslations().changeProposals;
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const collapsible = text.length > COLLAPSED_LENGTH;
  return (
    <Stack useFlexGap spacing="0.25rem" sx={{ alignItems: 'flex-start' }}>
      <PreLineText id={id} variant="body2">
        {collapsible && !expanded ? `${text.slice(0, COLLAPSED_LENGTH)}…` : text}
      </PreLineText>
      {collapsible ? (
        <Button size="small" variant="text" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)}>
          {expanded ? t.showLess : t.showMore}
        </Button>
      ) : null}
    </Stack>
  );
};

const ProposalValue = ({ value }: { value: DisplayValue }) => {
  const t = useTranslations().changeProposals;
  const { language } = useLanguage();
  switch (value.kind) {
    case 'empty':
      return <FieldDiffEmpty>{t.emptyValue}</FieldDiffEmpty>;
    case 'text':
      return value.long ? <LongText text={value.text} /> : <FieldDiffText breakAnywhere={value.breakAnywhere}>{value.text}</FieldDiffText>;
    case 'image':
      return <FieldDiffImage url={value.path} />;
    case 'list':
      return (
        <FieldDiffList items={value.items.map((item, index) => ({ key: String(index), content: valueText(item, t, language) }))} />
      );
    case 'record':
      return (
        <FieldDiffList
          items={value.entries.map((entry) => ({
            key: entry.field,
            content: `${fieldLabel(t, entry.field)}: ${valueText(entry.value, t, language)}`,
          }))}
        />
      );
    default:
      return <FieldDiffText breakAnywhere>{valueText(value, t, language)}</FieldDiffText>;
  }
};

export type StockNow = { tracked: false } | { tracked: true; onHand: number };

export const ProposalFieldRows = ({
  proposal,
  references,
  stockNow,
  labelComponent = 'h4',
}: {
  proposal: Pick<ChangeProposalOwnerView, 'effect' | 'input'>;
  references?: GroupReferences;
  stockNow?: StockNow | undefined;
  labelComponent?: 'h3' | 'h4';
}) => {
  const t = useTranslations().changeProposals;
  const rows = proposalRows(proposal, references);
  const removal = proposalRemovesRecord(proposal);
  if (rows.length === 0) return <FinePrint component="p">{t.noFieldChanges}</FinePrint>;
  return (
    <Stack useFlexGap spacing="0.5rem" data-testid="proposal-field-rows">
      {rows.map((row) => {
        if (row.kind === 'delta') {
          const reason = proposalInputText(proposal, 'reason');
          return (
            <FieldDiffRow
              key={row.field}
              label={t.stockDeltaLabel}
              labelComponent={labelComponent}
              changed
              data-testid="proposal-stock-delta"
              columns={[{
                label: t.columnAfter,
                value: (
                  <Stack useFlexGap spacing="0.25rem">
                    <Typography variant="body1" component="p">{t.stockDelta({ delta: row.delta })}</Typography>
                    {reason === null ? null : <FieldDiffText breakAnywhere>{t.stockReason({ reason })}</FieldDiffText>}
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
        }
        const columns = [
          ...(row.before === null ? [] : [{ label: removal ? t.columnRemoved : t.columnNow, value: <ProposalValue value={row.before} /> }]),
          ...(row.after === null ? [] : [{ label: t.columnAfter, value: <ProposalValue value={row.after} /> }]),
        ];
        return (
          <FieldDiffRow
            key={row.field}
            label={fieldLabel(t, row.field)}
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
