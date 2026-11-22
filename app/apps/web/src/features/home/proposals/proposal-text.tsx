import { Fragment } from 'react';

import {
  DELIVERY_METHODS,
  knownChangeProposalOperation,
  PARCEL_TEMPLATES,
  PRODUCT_TYPES,
  type ChangeProposalTargetKind,
  type ChangeProposalTargetPrice,
} from '#core/domain/index.js';

import type { Messages } from '../../../i18n/index.js';
import { formatPrice } from '../../../lib/format.js';
import { productTypeLabel } from '../products/product-type.js';
import type { PriceDisplay } from './proposal-display.js';

type Translations = Messages['changeProposals'];

const SLOT = '\u{E000}';

/** Puts text written by a key or a person in its own bidirectional run, so it cannot reorder the sentence around it. */
export const Isolated = ({ sentence, value }: { sentence: (slot: string) => string; value: string }) => {
  const [first = '', ...rest] = sentence(SLOT).split(SLOT);
  return (
    <>
      {first}
      {rest.map((after, index) => (
        <Fragment key={index}>
          <bdi>{value}</bdi>
          {after}
        </Fragment>
      ))}
    </>
  );
};

export const operationTitle = (t: Translations, operation: string): string => {
  const known = knownChangeProposalOperation(operation);
  return known === null ? t.unknownOperation : t.operation[known];
};

const VAT_PERCENT_FIELDS = new Set(['vatRate', 'invoiceVatRatePercent']);

const enumLabels = (t: Messages, field: string): Readonly<Partial<Record<string, string>>> => {
  switch (field) {
    case 'type':
      return Object.fromEntries(PRODUCT_TYPES.map((type) => [type, productTypeLabel(type, t)]));
    case 'visibility':
      return { listed: t.products.listed, unlisted: t.products.unlisted };
    case 'salesChannel':
      return { any: t.products.salesChannelAny, sales_links_only: t.products.salesChannelSalesLinksOnly };
    case 'deliveryMethod':
      return Object.fromEntries(DELIVERY_METHODS.map((method) => [method, t.shipping.deliveryMethods[method]]));
    case 'parcelTemplate':
      return Object.fromEntries(PARCEL_TEMPLATES.map((template) => [template, t.shipx.parcelTemplates[template]]));
    case 'kind':
      return { one_time: t.products.oneTime, recurring: t.products.recurring };
    case 'interval':
      return t.changeProposals.priceInterval;
    case 'vatRate':
      return { exempt: t.salesLinks.exempt };
    case 'invoiceVatMode':
      return { rate: t.billing.vatTreatmentRate, exempt: t.billing.vatTreatmentExempt };
    case 'invoiceExemptionBasisKind':
      return {
        art_113_1: t.billing.exemptionBasisKindArt113_1,
        art_113_9: t.billing.exemptionBasisKindArt113_9,
        art_43_1: t.billing.exemptionBasisKindArt43_1,
        other_statute: t.billing.exemptionBasisKindOtherStatute,
        other: t.billing.exemptionBasisKindOther,
      };
    case 'invoicingProvider':
      return { ifirma: t.billing.providerIfirma, ksef: t.billing.providerKsef };
    case 'ksefSubmissionMode':
      return { automatic: t.billing.ksefSubmissionAutomatic, manual: t.billing.ksefSubmissionManual };
    case 'autoIssueInvoiceScope':
      return { b2b_only: t.billing.b2bOnly, all: t.billing.allBuyers };
    case 'defaultLanguage':
      return t.emailLanguageSettings.options;
    default:
      return {};
  }
};

export const enumValueLabel = (t: Messages, field: string, value: string | number): string => {
  if (typeof value === 'number') return VAT_PERCENT_FIELDS.has(field) ? t.changeProposals.percent({ value }) : String(value);
  return enumLabels(t, field)[value] ?? value;
};

const isKnownField = (fields: Translations['fields'], field: string): field is keyof Translations['fields'] =>
  Object.hasOwn(fields, field);

export const fieldLabel = (t: Translations, field: string, targetKind?: ChangeProposalTargetKind): string => {
  if (field === 'active') return targetKind === 'price' ? t.fields.activePrice : t.fields.activeSalesLink;
  return isKnownField(t.fields, field) ? t.fields[field] : field;
};

export const priceTerms = (
  t: Translations,
  price: Pick<PriceDisplay, 'amountCents' | 'currency' | 'interval' | 'intervalCount' | 'active'>,
  language: string,
): string => {
  const amount = formatPrice(price.amountCents, price.currency, language);
  const terms = price.interval === null
    ? t.priceOneTime({ price: amount })
    : price.intervalCount > 1
      ? t.priceRecurringEvery({ price: amount, count: price.intervalCount, interval: price.interval })
      : t.priceRecurring({ price: amount, interval: t.priceInterval[price.interval] });
  return price.active === false ? t.priceInactive({ price: terms }) : terms;
};

export const targetPriceTerms = (t: Translations, price: ChangeProposalTargetPrice, language: string): string =>
  priceTerms(t, {
    amountCents: price.amountCents,
    currency: price.currency,
    interval: price.kind === 'recurring' ? price.interval : null,
    intervalCount: price.intervalCount,
    active: null,
  }, language);
