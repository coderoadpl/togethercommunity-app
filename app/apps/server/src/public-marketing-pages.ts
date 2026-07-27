import { DEFAULT_LANGUAGE, languageSchema, type Language, type Tenant, type TenantSettings } from '@core/domain/index.js';

interface PublicMarketingMessages {
  language: string;
  polish: string;
  english: string;
  preferencesTitle: string;
  preferencesEyebrow: string;
  preferencesFor: (input: { email: string }) => string;
  scopeAll: string;
  scopeNamed: (input: { scope: string }) => string;
  scopeIntro: (input: { scope: string }) => string;
  unsubscribeScope: string;
  unsubscribeEverything: (input: { tenant: string }) => string;
  unsubscribeWarning: string;
  consentsTitle: string;
  consentsIntro: string;
  pendingConfirmation: string;
  noOptionalConsents: string;
  savePreferences: string;
  globallyUnsubscribed: (input: { tenant: string }) => string;
  preferencesSavedTitle: string;
  preferencesSavedBody: string;
  preferencesPendingBody: string;
  unsubscribedTitle: string;
  unsubscribedScopeBody: (input: { scope: string }) => string;
  unsubscribedAllBody: (input: { tenant: string }) => string;
  resubscribeHint: string;
  backToPreferences: string;
  legalEyebrow: string;
  immutableVersion: (input: { version: number; date: string }) => string;
  confirmationEyebrow: string;
  confirmationPromptTitle: string;
  confirmationPromptBody: (input: { tenant: string }) => string;
  confirmationSubmit: string;
  confirmationSuccessTitle: string;
  confirmationSuccessBody: (input: { tenant: string }) => string;
  confirmationExpiredTitle: string;
  confirmationExpiredBody: string;
}

const messages: Record<Language, PublicMarketingMessages> = {
  pl: {
    language: 'Język',
    polish: 'Polski',
    english: 'English',
    preferencesTitle: 'Preferencje e-mail',
    preferencesEyebrow: 'Twoja prywatność i zgody',
    preferencesFor: ({ email }) => `Ustawienia dla adresu ${email}`,
    scopeAll: 'wszystkie wiadomości marketingowe',
    scopeNamed: ({ scope }) => `zgoda „${scope}”`,
    scopeIntro: ({ scope }) => `Ten link dotyczy zakresu: ${scope}.`,
    unsubscribeScope: 'Wypisz mnie z tego zakresu',
    unsubscribeEverything: ({ tenant }) => `Wypisz mnie ze wszystkiego od ${tenant}`,
    unsubscribeWarning: 'Zmiana zostanie zastosowana od razu. Możesz też dokładnie ustawić zgody poniżej.',
    consentsTitle: 'Opcjonalne zgody',
    consentsIntro: 'Zaznacz wiadomości, które nadal chcesz otrzymywać. Żadne pole nie jest obowiązkowe.',
    pendingConfirmation: 'Oczekuje na potwierdzenie w wiadomości e-mail.',
    noOptionalConsents: 'Ten twórca nie ma innych aktywnych zgód opcjonalnych.',
    savePreferences: 'Zapisz preferencje',
    globallyUnsubscribed: ({ tenant }) => `Adres jest wypisany ze wszystkich wiadomości marketingowych od ${tenant}.`,
    preferencesSavedTitle: 'Preferencje zapisane',
    preferencesSavedBody: 'Twoje ustawienia zostały zaktualizowane.',
    preferencesPendingBody: 'Wyślemy wiadomość z linkiem potwierdzającym dla nowo wybranych zgód.',
    unsubscribedTitle: 'Wypisanie potwierdzone',
    unsubscribedScopeBody: ({ scope }) => `Nie będziesz już otrzymywać wiadomości w zakresie: ${scope}.`,
    unsubscribedAllBody: ({ tenant }) => `Nie będziesz już otrzymywać żadnych wiadomości marketingowych od ${tenant}.`,
    resubscribeHint: 'Jeśli zmienisz zdanie, możesz spokojnie wrócić i ponownie wybrać opcjonalne zgody.',
    backToPreferences: 'Wróć do preferencji',
    legalEyebrow: 'Dokument prawny',
    immutableVersion: ({ version, date }) => `To niezmienna wersja ${version}, opublikowana ${date}.`,
    confirmationEyebrow: 'Potwierdzenie zgody',
    confirmationPromptTitle: 'Potwierdź zapis',
    confirmationPromptBody: ({ tenant }) => `Potwierdź, że chcesz otrzymywać wiadomości od ${tenant}.`,
    confirmationSubmit: 'Potwierdzam zapis',
    confirmationSuccessTitle: 'Adres e-mail potwierdzony',
    confirmationSuccessBody: ({ tenant }) => `Zgoda na wiadomości od ${tenant} jest teraz aktywna.`,
    confirmationExpiredTitle: 'Link nie jest już aktywny',
    confirmationExpiredBody: 'Link potwierdzający wygasł albo jest nieprawidłowy. Poproś twórcę o ponowne zapisanie Cię do wybranej komunikacji.',
  },
  en: {
    language: 'Language',
    polish: 'Polski',
    english: 'English',
    preferencesTitle: 'Email preferences',
    preferencesEyebrow: 'Your privacy and consents',
    preferencesFor: ({ email }) => `Settings for ${email}`,
    scopeAll: 'all marketing messages',
    scopeNamed: ({ scope }) => `“${scope}” consent`,
    scopeIntro: ({ scope }) => `This link applies to: ${scope}.`,
    unsubscribeScope: 'Unsubscribe me from this scope',
    unsubscribeEverything: ({ tenant }) => `Unsubscribe me from everything from ${tenant}`,
    unsubscribeWarning: 'The change takes effect immediately. You can also fine-tune your consents below.',
    consentsTitle: 'Optional consents',
    consentsIntro: 'Select the messages you still want to receive. None of these choices is required.',
    pendingConfirmation: 'Waiting for confirmation from the email we sent.',
    noOptionalConsents: 'This creator has no other active optional consents.',
    savePreferences: 'Save preferences',
    globallyUnsubscribed: ({ tenant }) => `This address is unsubscribed from all marketing messages from ${tenant}.`,
    preferencesSavedTitle: 'Preferences saved',
    preferencesSavedBody: 'Your settings have been updated.',
    preferencesPendingBody: 'We will send a confirmation link for each newly selected consent.',
    unsubscribedTitle: 'Unsubscribe confirmed',
    unsubscribedScopeBody: ({ scope }) => `You will no longer receive messages covered by: ${scope}.`,
    unsubscribedAllBody: ({ tenant }) => `You will no longer receive any marketing messages from ${tenant}.`,
    resubscribeHint: 'If you change your mind, you can quietly return and select optional consents again.',
    backToPreferences: 'Back to preferences',
    legalEyebrow: 'Legal document',
    immutableVersion: ({ version, date }) => `This is immutable version ${version}, published on ${date}.`,
    confirmationEyebrow: 'Consent confirmation',
    confirmationPromptTitle: 'Confirm your subscription',
    confirmationPromptBody: ({ tenant }) => `Confirm that you want to receive messages from ${tenant}.`,
    confirmationSubmit: 'Confirm subscription',
    confirmationSuccessTitle: 'Email address confirmed',
    confirmationSuccessBody: ({ tenant }) => `Your consent to messages from ${tenant} is now active.`,
    confirmationExpiredTitle: 'This link is no longer active',
    confirmationExpiredBody: 'The confirmation link has expired or is invalid. Ask the creator to subscribe you to the selected communication again.',
  },
};

export interface PublicBrand {
  tenant: Tenant;
  settings: TenantSettings | null;
}

export interface PublicPreferenceDefinition {
  id: string;
  label: string;
  active: boolean;
  pendingConfirmation: boolean;
}

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character] ?? character);

const safeHref = (value: string): string | null => {
  if (value.startsWith('/') || value.startsWith('#')) return value;
  if (!URL.canParse(value)) return null;
  const protocol = new URL(value).protocol;
  return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:' ? value : null;
};

const renderMarkdownText = (source: string): string => {
  let output = '';
  let cursor = 0;
  for (const match of source.matchAll(/`([^`\n]+)`|\*\*([^*\n]+)\*\*|(?<![\p{L}\p{N}_])_([^_\n]+)_(?![\p{L}\p{N}_])/gu)) {
    const index = match.index;
    if (index === undefined) continue;
    output += escapeHtml(source.slice(cursor, index));
    const [token, code, strong, emphasis] = match;
    if (code !== undefined) output += `<code>${escapeHtml(code)}</code>`;
    else if (strong !== undefined) output += `<strong>${escapeHtml(strong)}</strong>`;
    else output += `<em>${escapeHtml(emphasis ?? '')}</em>`;
    cursor = index + token.length;
  }
  return output + escapeHtml(source.slice(cursor));
};

const renderInlineMarkdown = (source: string): string => {
  let output = '';
  let cursor = 0;
  for (const match of source.matchAll(/\[([^\]]+)]\(([^)\s]+)\)/g)) {
    const index = match.index;
    const label = match[1];
    const href = match[2];
    if (index === undefined || label === undefined || href === undefined) continue;
    output += renderMarkdownText(source.slice(cursor, index));
    const safe = safeHref(href);
    output += safe === null
      ? renderMarkdownText(match[0])
      : `<a href="${escapeHtml(safe)}">${renderMarkdownText(label)}</a>`;
    cursor = index + match[0].length;
  }
  return output + renderMarkdownText(source.slice(cursor));
};

export const renderHostedMarkdown = (source: string): string => {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let code: string[] | null = null;
  const flushParagraph = (): void => {
    if (paragraph.length > 0) blocks.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = (): void => {
    if (list.length > 0) blocks.push(`<ul>${list.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</ul>`);
    list = [];
  };
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      flushParagraph();
      flushList();
      if (code === null) code = [];
      else {
        blocks.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
        code = null;
      }
      continue;
    }
    if (code !== null) {
      code.push(line);
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading !== null) {
      flushParagraph();
      flushList();
      const level = heading[1]?.length ?? 1;
      blocks.push(`<h${String(level)}>${renderInlineMarkdown(heading[2] ?? '')}</h${String(level)}>`);
      continue;
    }
    const item = /^[-*]\s+(.+)$/.exec(line);
    if (item !== null) {
      flushParagraph();
      list.push(item[1] ?? '');
      continue;
    }
    const quote = /^>\s?(.+)$/.exec(line);
    if (quote !== null) {
      flushParagraph();
      flushList();
      blocks.push(`<blockquote>${renderInlineMarkdown(quote[1] ?? '')}</blockquote>`);
      continue;
    }
    if (line.trim() === '') {
      flushParagraph();
      flushList();
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  if (code !== null) blocks.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
  return blocks.join('\n');
};

export const languageFromRequest = (request: Request): Language => {
  const queryLanguage = languageSchema.safeParse(new URL(request.url).searchParams.get('lang'));
  if (queryLanguage.success) return queryLanguage.data;
  const cookieLanguage = request.headers.get('cookie')?.match(/(?:^|;\s*)together-language=(pl|en)(?:;|$)/)?.[1];
  const parsedCookie = languageSchema.safeParse(cookieLanguage);
  if (parsedCookie.success) return parsedCookie.data;
  return request.headers.get('accept-language')?.toLowerCase().startsWith('en') === true ? 'en' : DEFAULT_LANGUAGE;
};

const publicStyles = `
:root{color-scheme:light;--bg:#f6f2ea;--surface:#fdfbf6;--ink:#191512;--muted:#5c5348;--line:rgba(25,21,18,.16);--accent:#7c3aed;--danger:#a32222;--radius:3px;--shadow:none;font-family:Inter,ui-sans-serif,system-ui,sans-serif}
:root[data-theme="material"]{--bg:#fafafa;--surface:#fff;--ink:#212121;--muted:#616161;--line:rgba(0,0,0,.18);--radius:4px;--shadow:0 2px 5px rgba(0,0,0,.14)}
:root[data-theme="shadcn"]{--bg:#fafafa;--surface:#fff;--ink:#09090b;--muted:#64646b;--line:#e4e4e7;--radius:8px;--shadow:0 1px 2px rgba(0,0,0,.05)}
:root[data-theme="scoreboard"]{--bg:#07110c;--surface:#0c1a12;--ink:#f2ffe9;--muted:#a8c6ab;--line:#315c3c;--accent:#b7f34a;--danger:#ff7b72;--radius:0;--shadow:none;color-scheme:dark}
@media(prefers-color-scheme:dark){:root:not([data-theme]){--bg:#11100e;--surface:#1c1915;--ink:#f6f2ea;--muted:#b7aea1;--line:rgba(246,242,234,.2);--danger:#ff8a80;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);line-height:1.6}a{color:var(--accent);text-underline-offset:.18em}button,input{font:inherit}button{min-height:44px;border:1px solid var(--ink);border-radius:var(--radius);padding:.72rem 1rem;background:var(--ink);color:var(--surface);cursor:pointer;font-weight:650}button.secondary{background:transparent;color:var(--ink)}button.danger{border-color:var(--danger);background:var(--danger);color:#fff}button:disabled{opacity:.55;cursor:not-allowed}:focus-visible{outline:3px solid color-mix(in srgb,var(--accent) 52%,transparent);outline-offset:3px}.shell{width:min(calc(100% - 2rem),44rem);margin:0 auto;padding:2.5rem 0 5rem}.brand{display:flex;align-items:center;justify-content:space-between;gap:1rem;border-bottom:1px solid var(--line);padding-bottom:1rem}.brand-mark{display:flex;align-items:center;gap:.75rem;min-width:0}.brand img{display:block;max-width:10rem;max-height:2.5rem}.brand-name{font-weight:750;letter-spacing:-.01em}.languages{display:flex;gap:.65rem;font-size:.82rem;white-space:nowrap}.languages a{display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px}.languages a[aria-current="page"]{color:var(--ink);text-decoration:none;font-weight:700}.page{padding-top:3rem}.eyebrow{margin:0 0 .55rem;color:var(--muted);font-size:.75rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase}.page h1{margin:0;font-family:Fraunces,Georgia,serif;font-size:clamp(2rem,7vw,3.3rem);line-height:1.08;letter-spacing:-.035em}.lede{margin:1rem 0 0;color:var(--muted);font-size:1.02rem}.card{margin-top:2rem;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);box-shadow:var(--shadow);padding:clamp(1.15rem,5vw,2rem)}.card h2{margin:0 0 .5rem;font-size:1.15rem}.actions{display:flex;flex-wrap:wrap;gap:.75rem;margin-top:1.25rem}.danger-zone{border-color:color-mix(in srgb,var(--danger) 35%,var(--line))}.fine{color:var(--muted);font-size:.88rem}.choice{display:grid;grid-template-columns:auto 1fr;gap:.15rem .75rem;padding:.85rem 0;border-bottom:1px solid var(--line)}.choice:last-of-type{border-bottom:0}.choice input{width:1.2rem;height:1.2rem;margin-top:.2rem;accent-color:var(--accent)}.choice small{grid-column:2;color:var(--muted)}.notice{margin-top:1.5rem;border-left:3px solid var(--accent);padding:.75rem 1rem;background:color-mix(in srgb,var(--accent) 8%,var(--surface))}.status{padding-block:clamp(3rem,12vw,7rem);text-align:center}.status .actions{justify-content:center}.prose{margin-top:2.5rem}.prose h1,.prose h2,.prose h3{font-family:Fraunces,Georgia,serif;line-height:1.2;margin:2rem 0 .7rem}.prose h1{font-size:1.8rem}.prose h2{font-size:1.4rem}.prose h3{font-size:1.15rem}.prose p,.prose ul,.prose blockquote{margin:0 0 1rem}.prose blockquote{border-left:3px solid var(--line);padding-left:1rem;color:var(--muted)}.prose pre{overflow:auto;padding:1rem;background:color-mix(in srgb,var(--ink) 7%,var(--surface));border:1px solid var(--line)}.prose code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.9em}@media(max-width:520px){.shell{width:min(calc(100% - 1.25rem),44rem);padding-top:1rem}.brand{align-items:flex-start}.brand-mark{align-items:flex-start}.languages{flex-direction:column;gap:.1rem;text-align:right}.page{padding-top:2rem}.actions{flex-direction:column}.actions button{width:100%}}
`;

const renderPage = (input: {
  brand: PublicBrand;
  language: Language;
  path: string;
  title: string;
  eyebrow: string;
  body: string;
  testId: string;
}): string => {
  const t = messages[input.language];
  const accent = input.brand.settings?.accentColor ?? '#7c3aed';
  const logoUrl = input.brand.settings?.logoUrl;
  const faviconUrl = input.brand.settings?.faviconUrl;
  const brandMark = logoUrl === null || logoUrl === undefined
    ? `<span class="brand-name">${escapeHtml(input.brand.tenant.name)}</span>`
    : `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(input.brand.tenant.name)}">`;
  const favicon = faviconUrl === null || faviconUrl === undefined
    ? ''
    : `<link rel="icon" href="${escapeHtml(faviconUrl)}">`;
  return `<!doctype html><html lang="${input.language}" style="--accent:${escapeHtml(accent)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${favicon}<title>${escapeHtml(input.title)} · ${escapeHtml(input.brand.tenant.name)}</title><script>try{const theme=localStorage.getItem('together-theme-mode');if(theme)document.documentElement.dataset.theme=theme}catch{}</script><style>${publicStyles}</style></head><body><main class="shell" data-testid="${escapeHtml(input.testId)}"><header class="brand"><div class="brand-mark">${brandMark}</div><nav class="languages" aria-label="${escapeHtml(t.language)}"><a href="${escapeHtml(input.path)}?lang=pl"${input.language === 'pl' ? ' aria-current="page"' : ''}>${escapeHtml(t.polish)}</a><a href="${escapeHtml(input.path)}?lang=en"${input.language === 'en' ? ' aria-current="page"' : ''}>${escapeHtml(t.english)}</a></nav></header><section class="page"><p class="eyebrow">${escapeHtml(input.eyebrow)}</p><h1>${escapeHtml(input.title)}</h1>${input.body}</section></main></body></html>`;
};

export const renderPreferencesPage = (input: {
  brand: PublicBrand;
  language: Language;
  token: string;
  email: string;
  scope: string;
  scopeLabel: string | null;
  globallySuppressed: boolean;
  definitions: PublicPreferenceDefinition[];
}): string => {
  const t = messages[input.language];
  const path = `/u/${encodeURIComponent(input.token)}`;
  const formSuffix = `?lang=${input.language}`;
  const scope = input.scope === 'all_marketing'
    ? t.scopeAll
    : t.scopeNamed({ scope: input.scopeLabel ?? input.scope.slice('consent:'.length) });
  const choices = input.definitions.length === 0
    ? `<p class="fine">${escapeHtml(t.noOptionalConsents)}</p>`
    : input.definitions.map((definition) => `<label class="choice"><input type="checkbox" name="consent" value="${escapeHtml(definition.id)}"${definition.active ? ' checked' : ''}${input.globallySuppressed ? ' disabled' : ''}><span>${escapeHtml(definition.label)}</span>${definition.pendingConfirmation ? `<small>${escapeHtml(t.pendingConfirmation)}</small>` : ''}</label>`).join('');
  const preferenceForm = input.globallySuppressed
    ? `<p class="notice">${escapeHtml(t.globallyUnsubscribed({ tenant: input.brand.tenant.name }))}</p>`
    : `<form method="post" action="${path}/preferences${formSuffix}">${choices}<div class="actions"><button type="submit">${escapeHtml(t.savePreferences)}</button></div></form>`;
  const body = `<p class="lede">${escapeHtml(t.preferencesFor({ email: input.email }))}</p><p class="notice">${escapeHtml(t.scopeIntro({ scope }))}</p><section class="card danger-zone"><h2>${escapeHtml(t.unsubscribeScope)}</h2><p class="fine">${escapeHtml(t.unsubscribeWarning)}</p><div class="actions"><form method="post" action="${path}/confirm${formSuffix}"><button class="danger" type="submit">${escapeHtml(t.unsubscribeScope)}</button></form><form method="post" action="${path}/all${formSuffix}"><button class="secondary" type="submit">${escapeHtml(t.unsubscribeEverything({ tenant: input.brand.tenant.name }))}</button></form></div></section><section class="card"><h2>${escapeHtml(t.consentsTitle)}</h2><p class="fine">${escapeHtml(t.consentsIntro)}</p>${preferenceForm}</section>`;
  return renderPage({ brand: input.brand, language: input.language, path, title: t.preferencesTitle, eyebrow: t.preferencesEyebrow, body, testId: 'marketing-preferences' });
};

export const renderPreferenceResultPage = (input: {
  brand: PublicBrand;
  language: Language;
  token: string;
  result: 'saved' | 'scope_unsubscribed' | 'all_unsubscribed';
  scopeLabel: string | null;
  pendingConfirmations?: number;
}): string => {
  const t = messages[input.language];
  const path = `/u/${encodeURIComponent(input.token)}`;
  const saved = input.result === 'saved';
  const title = saved ? t.preferencesSavedTitle : t.unsubscribedTitle;
  const summary = input.result === 'saved'
    ? `${t.preferencesSavedBody}${(input.pendingConfirmations ?? 0) > 0 ? ` ${t.preferencesPendingBody}` : ''}`
    : input.result === 'all_unsubscribed'
      ? t.unsubscribedAllBody({ tenant: input.brand.tenant.name })
      : t.unsubscribedScopeBody({ scope: input.scopeLabel ?? t.scopeAll });
  const hint = input.result === 'scope_unsubscribed'
    ? `<p class="fine">${escapeHtml(t.resubscribeHint)}</p>`
    : '';
  const body = `<div class="status"><p class="lede">${escapeHtml(summary)}</p>${hint}<div class="actions"><a href="${path}?lang=${input.language}">${escapeHtml(t.backToPreferences)}</a></div></div>`;
  return renderPage({ brand: input.brand, language: input.language, path, title, eyebrow: t.preferencesEyebrow, body, testId: 'marketing-preference-result' });
};

export const renderLegalDocumentPage = (input: {
  brand: PublicBrand;
  language: Language;
  path: string;
  title: string;
  content: string;
  immutableVersion: { version: number; publishedAt: string } | null;
}): string => {
  const t = messages[input.language];
  const locale = input.language === 'pl' ? 'pl-PL' : 'en-US';
  const notice = input.immutableVersion === null
    ? ''
    : `<p class="notice">${escapeHtml(t.immutableVersion({
        version: input.immutableVersion.version,
        date: new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(input.immutableVersion.publishedAt)),
      }))}</p>`;
  const body = `${notice}<article class="prose">${renderHostedMarkdown(input.content)}</article>`;
  return renderPage({ brand: input.brand, language: input.language, path: input.path, title: input.title, eyebrow: t.legalEyebrow, body, testId: 'hosted-legal-document' });
};

export const renderConfirmationPage = (input: {
  brand: PublicBrand;
  language: Language;
  path: string;
  state: 'prompt' | 'success' | 'expired';
}): string => {
  const t = messages[input.language];
  const success = input.state === 'success';
  const prompt = input.state === 'prompt';
  const title = prompt ? t.confirmationPromptTitle : success ? t.confirmationSuccessTitle : t.confirmationExpiredTitle;
  const summary = success
    ? t.confirmationSuccessBody({ tenant: input.brand.tenant.name })
    : prompt
      ? t.confirmationPromptBody({ tenant: input.brand.tenant.name })
      : t.confirmationExpiredBody;
  const action = prompt
    ? `<form class="actions" method="post" action="${input.path}?lang=${input.language}"><button type="submit">${escapeHtml(t.confirmationSubmit)}</button></form>`
    : '';
  return renderPage({
    brand: input.brand,
    language: input.language,
    path: input.path,
    title,
    eyebrow: t.confirmationEyebrow,
    body: `<div class="status"><p class="lede">${escapeHtml(summary)}</p>${action}</div>`,
    testId: `marketing-confirmation-${input.state}`,
  });
};
