import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { en } from '../../../i18n/en.js';
import { LanguageProvider } from '../../../i18n/index.js';
import { pl } from '../../../i18n/pl.js';
import { languagePreference } from '../../../theme-mode.js';
import { enumValueLabel, fieldLabel, fileTypeLabel, Isolated, operationTitle, Sentence } from './proposal-text.js';

describe('proposal text', () => {
  it('labels every enumerated value it knows and falls back to the raw value', () => {
    expect(enumValueLabel(en, 'type', 'physical')).toBe(en.salesLinks.physical);
    expect(enumValueLabel(pl, 'visibility', 'unlisted')).toBe(pl.products.unlisted);
    expect(enumValueLabel(en, 'salesChannel', 'sales_links_only')).toBe(en.products.salesChannelSalesLinksOnly);
    expect(enumValueLabel(en, 'deliveryMethod', 'pickup')).toBe(en.shipping.deliveryMethods.pickup);
    expect(enumValueLabel(en, 'parcelTemplate', 'large')).toBe(en.shipx.parcelTemplates.large);
    expect(enumValueLabel(en, 'kind', 'one_time')).toBe(en.products.oneTime);
    expect(enumValueLabel(pl, 'interval', 'month')).toBe(pl.changeProposals.priceInterval.month);
    expect(enumValueLabel(en, 'vatRate', 23)).toBe('23%');
    expect(enumValueLabel(en, 'vatRate', 'exempt')).toBe(en.salesLinks.exempt);
    expect(enumValueLabel(en, 'invoiceVatMode', 'exempt')).toBe(en.billing.vatTreatmentExempt);
    expect(enumValueLabel(en, 'invoiceExemptionBasisKind', 'art_43_1')).toBe(en.billing.exemptionBasisKindArt43_1);
    expect(enumValueLabel(en, 'invoicingProvider', 'ksef')).toBe(en.billing.providerKsef);
    expect(enumValueLabel(en, 'ksefSubmissionMode', 'manual')).toBe(en.billing.ksefSubmissionManual);
    expect(enumValueLabel(en, 'autoIssueInvoiceScope', 'b2b_only')).toBe(en.billing.b2bOnly);
    expect(enumValueLabel(en, 'type', 'hologram')).toBe('hologram');
  });

  it('names the active switch with the gender of its target in Polish', () => {
    expect(fieldLabel(pl.changeProposals, 'active', 'sales-link')).toBe(pl.changeProposals.fields.activeSalesLink);
    expect(fieldLabel(pl.changeProposals, 'active', 'price')).toBe(pl.changeProposals.fields.activePrice);
    expect(pl.changeProposals.fields.activeSalesLink).not.toBe(pl.changeProposals.fields.activePrice);
    expect(fieldLabel(pl.changeProposals, 'giftWrap')).toBe('giftWrap');
  });

  it('words counts with the Polish plural forms and a one-item group as a single change', () => {
    expect(en.changeProposals.approveGroup({ count: 1 })).toBe('Approve the change');
    expect(pl.changeProposals.approveGroup({ count: 1 })).not.toMatch(/\d/u);
    const body = (count: number) => pl.changeProposals.approveGroupBody({ count }).replace(String(count), 'N');
    expect(new Set([body(1), body(3), body(5)]).size).toBe(3);
    expect(body(22)).toBe(body(3));
    expect(body(12)).toBe(body(5));
    const fields = (count: number) => pl.changeProposals.approveFieldsChange({ target: 'X', count }).replace(String(count), 'N');
    expect(new Set([fields(1), fields(4), fields(7)]).size).toBe(3);
    expect(fields(24)).toBe(fields(4));
  });

  it('ends the Polish group confirmation like the card and names the target before the price it turns off', () => {
    for (const count of [3, 5, 22]) {
      expect(pl.changeProposals.approveGroupBody({ count })).toMatch(/ razem albo wcale\.$/u);
    }
    expect(pl.changeProposals.groupAllOrNothing).toMatch(/ razem albo wcale\.$/u);
    expect(pl.changeProposals.approvePriceDeactivate({ target: 'Club', price: 'P' })).toMatch(/^Produkt \u201EClub\u201D: /u);
    expect(pl.changeProposals.decidedByFormerTeamMember({ date: 'D' })).toMatch(/^Decyzja: \S+ osoba z zespo\S+, D$/u);
  });

  it('isolates the inserted value so it cannot reorder the sentence', () => {
    const { container } = render(<p><Isolated sentence={(key) => en.changeProposals.proposedBy({ key })} value={'Agent” \u202Eone'} /></p>);
    expect(container.querySelector('bdi')).toHaveTextContent('Agent” \u202Eone');
    expect(container).toHaveTextContent('Proposed by the key “Agent” \u202Eone”');
  });

  it('puts every part in its own slot of the sentence, whatever order the language writes them in', () => {
    const { container } = render(
      <p><Sentence text={(file, product) => `${product} gets ${file}; ${file} again`} parts={[<bdi key="file">{'a\u202Eb.pdf'}</bdi>, <strong key="product">Mug</strong>]} /></p>,
    );
    expect(container).toHaveTextContent('Mug gets a\u202Eb.pdf; a\u202Eb.pdf again');
    expect(container.querySelectorAll('bdi')).toHaveLength(2);
    expect(container.querySelector('strong')).toHaveTextContent('Mug');
    expect(container.textContent).not.toMatch(/[\u{E000}-\u{E001}]/u);
  });

  it('labels the file types a key may stage and falls back to the raw type', () => {
    expect(fileTypeLabel('application/pdf')).toBe('PDF');
    expect(fileTypeLabel('application/epub+zip')).toBe('EPUB');
    expect(fileTypeLabel('audio/mp4')).toBe('M4A');
    expect(fileTypeLabel('video/mp4')).toBe('MP4');
    expect(fileTypeLabel('text/plain')).toBe('text/plain');
  });

  it('titles every operation the server can store, and only an unregistered one as unknown', () => {
    for (const translations of [en.changeProposals, pl.changeProposals]) {
      for (const operation of ['product.set-access', 'download.add', 'download.replace', 'download.remove'] as const) {
        expect(operationTitle(translations, operation)).toBe(translations.operation[operation]);
        expect(operationTitle(translations, operation)).not.toBe(translations.unknownOperation);
      }
      expect(operationTitle(translations, 'download.rename')).toBe(translations.unknownOperation);
    }
  });

  it('sets the document language to the active language', () => {
    languagePreference.save('pl');
    render(<LanguageProvider><span>content</span></LanguageProvider>);
    expect(screen.getByText('content')).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('pl');
  });
});
