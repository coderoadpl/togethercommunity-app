import {
  buildEmailHeaders, err, ok, renderMarketingTemplate, validation,
  type AppError, type Result,
} from '#core/domain/index.js';

import type { HtmlToText } from '../marketing-delivery-ports.js';

export interface MarketingRenderInput {
  subject: string;
  bodyHtml: string;
  bodyText?: string | null | undefined;
  data: Record<string, unknown>;
  unsubscribeUrl: string;
  legalName: string;
  address: string;
  consentReference: string;
  layoutHtml: string | null;
}

export interface RenderedMarketingPayload {
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
}

export const renderMarketingPayload = (
  input: MarketingRenderInput,
  deps: { htmlToText: HtmlToText },
): Result<RenderedMarketingPayload, AppError> => {
  if ([input.bodyHtml, input.bodyText ?? '', input.layoutHtml ?? ''].some((value) => value.length > 500_000)) {
    return err(validation('Marketing template exceeds the length limit'));
  }
  if (input.bodyText != null && input.bodyText.trim() === '') return err(validation('Explicit plaintext cannot be empty'));
  if ([input.legalName, input.address, input.consentReference].some((value) => value.trim() === '')) {
    return err(validation('Marketing footer requires legal name, address and consent wording'));
  }
  const content = renderMarketingTemplate(input.bodyHtml, input.data);
  if (!content.ok) return content;
  const body = input.layoutHtml === null ? content : renderMarketingTemplate(input.layoutHtml, { ...input.data, content: content.value });
  if (!body.ok) return body;
  const footer = renderMarketingTemplate('<footer><p>{{legalName}}</p><p>{{address}}</p><p>{{consentReference}}</p><p><a href="{{unsubscribeUrl}}">Unsubscribe</a></p></footer>', {
    legalName: input.legalName, address: input.address, consentReference: input.consentReference, unsubscribeUrl: input.unsubscribeUrl,
  });
  if (!footer.ok) return footer;
  const subject = renderMarketingTemplate(input.subject, input.data, { escape: false });
  if (!subject.ok) return subject;
  const authored = input.bodyText == null ? null : renderMarketingTemplate(input.bodyText, input.data, { escape: false });
  if (authored !== null && !authored.ok) return authored;
  const text = `${authored?.value ?? deps.htmlToText.convert(body.value)}\n\n${input.legalName}\n${input.address}\n${input.consentReference}\n\nUnsubscribe: ${input.unsubscribeUrl}`;
  const html = body.value.includes('</body>') ? body.value.replace('</body>', `${footer.value}</body>`) : `${body.value}${footer.value}`;
  if (html.length > 1_000_000 || text.length > 1_000_000) return err(validation('Rendered marketing message exceeds the length limit'));
  const headers = buildEmailHeaders({ kind: 'marketing', unsubscribeUrl: input.unsubscribeUrl });
  return headers.ok ? ok({ subject: subject.value, html, text, headers: headers.value }) : headers;
};
