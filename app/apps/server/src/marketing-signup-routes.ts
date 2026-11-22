import type { Hono, Context, MiddlewareHandler } from 'hono';
import { z } from 'zod';

import { API_PATHS, HTTP_STATUS_BY_ERROR_CODE, marketingSignupContracts } from '#core/contract/index.js';
import { err, internal, marketingSignupSubmissionSchema, notFound, tenantNotFound, validation, type AppError, type MarketingSignupForm } from '#core/domain/index.js';
import { resolveTenant, authLinkBaseUrl, createMarketingSignupForm, getMarketingSignupForm, listMarketingSignupForms, updateMarketingSignupForm, submitMarketingSignupForm } from '#core/server/index.js';

import type { AppDeps } from './composition.js';
import type { AppVars } from './app-vars.js';
import { ctxOf } from './ctx-of.js';
import { readJson } from './read-json.js';
import { respond, retryAfterHeaders } from './respond.js';
import { trustedClientIp } from './auth-network.js';
import { isMarketingSignupSubmissionPath } from './body-limits.js';
import { languageFromRequest, renderSignupFormPage, renderSignupUnavailablePage, type SignupFormError } from './public-marketing-pages.js';

export const registerSessionMarketingSignupRoutes = (app: Hono<AppVars>, deps: AppDeps): void => {
  app.get(API_PATHS.listMarketingSignupForms, async (c) => deps.marketingSignup === undefined ? respond(err(internal('Signup forms are unavailable'))) : respond(await listMarketingSignupForms(ctxOf(c), deps.marketingSignup)));
  app.get(API_PATHS.getMarketingSignupForm, async (c) => deps.marketingSignup === undefined ? respond(err(internal('Signup forms are unavailable'))) : respond(await getMarketingSignupForm(ctxOf(c), { slug: c.req.param('slug') ?? '' }, deps.marketingSignup)));
  app.post(API_PATHS.createMarketingSignupForm, async (c) => {
    if (deps.marketingSignup === undefined) return respond(err(internal('Signup forms are unavailable')));
    const parsed = marketingSignupContracts.createMarketingSignupForm.input.safeParse(await readJson(c.req.raw));
    return parsed.success ? respond(await createMarketingSignupForm(ctxOf(c), parsed.data, deps.marketingSignup), { successStatus: 201 }) : respond(err(validation('Invalid signup form')));
  });
  app.post(API_PATHS.updateMarketingSignupForm, async (c) => {
    if (deps.marketingSignup === undefined) return respond(err(internal('Signup forms are unavailable')));
    const parsed = marketingSignupContracts.updateMarketingSignupForm.input.safeParse(await readJson(c.req.raw));
    if (!parsed.success || parsed.data.slug !== c.req.param('slug')) return respond(err(validation('Invalid signup form update')));
    return respond(await updateMarketingSignupForm(ctxOf(c), parsed.data, deps.marketingSignup));
  });
};
const resolveWorkspace = async (c: Context<AppVars>, deps: AppDeps) => {
  const resolved = await resolveTenant(c.req.header('host') ?? '', null, deps);
  if (!resolved.ok || resolved.value === null) return resolved.ok ? err(tenantNotFound()) : resolved;
  const settings = await deps.tenants.findSettings(resolved.value.tenant.id);
  return { ok: true, value: { resolved: resolved.value, brand: { tenant: resolved.value.tenant, settings }, language: languageFromRequest(c.req.raw, settings?.defaultLanguage) } } as const;
};
type Workspace = Extract<Awaited<ReturnType<typeof resolveWorkspace>>, { ok: true }>['value'];
const activeForm = async (deps: AppDeps, tenantId: string, slug: string): Promise<MarketingSignupForm | null> => {
  const form = await deps.marketingSignup?.forms.findBySlug(tenantId, slug);
  return form?.status === 'active' ? form : null;
};
const resolveForm = async (c: Context<AppVars>, deps: AppDeps) => {
  const workspace = await resolveWorkspace(c, deps);
  if (!workspace.ok) return workspace;
  const form = await activeForm(deps, workspace.value.brand.tenant.id, c.req.param('slug') ?? '');
  return form === null ? err(notFound('Signup form was not found')) : { ok: true, value: { ...workspace.value, form } } as const;
};
const formPageData = async (deps: AppDeps, form: MarketingSignupForm) => {
  const definition = await deps.marketing?.definitions.findById(form.tenantId, form.consentDefinitionId);
  if (definition === undefined || definition === null || definition.status !== 'active' || form.consentVersion === undefined) return null;
  const reference = form.consentVersion.documentVersionRef;
  const document = reference.mode === 'hosted'
    ? await deps.marketing?.documents.findPublishedVersionById(form.tenantId, reference.documentVersionId) ?? null
    : null;
  return {
    wording: form.consentVersion.label,
    doubleOptIn: definition.doubleOptIn,
    consentDocument: document === null
      ? null
      : { title: document.document.title, href: `/legal/${encodeURIComponent(document.document.slug)}/v/${String(document.version.version)}` },
  };
};
const submissionSlug = (path: string): string => decodeURIComponent(path.split('/').at(-2) ?? '');
const submissionOriginAllowed = async (c: Context<AppVars>, deps: AppDeps, origin: string): Promise<boolean> => {
  const resolved = await resolveTenant(c.req.header('host') ?? '', null, deps);
  if (!resolved.ok || resolved.value === null) return false;
  const form = await deps.marketingSignup?.forms.findBySlug(resolved.value.tenant.id, submissionSlug(c.req.path));
  return form !== undefined && form !== null && form.status === 'active' && form.allowedOrigins.includes(origin);
};
// Handlers answer with freshly built Response objects, so allow-list headers survive only when applied after the handler.
export const marketingSignupCorsMiddleware = (deps: AppDeps): MiddlewareHandler<AppVars> => async (c, next) => {
  const origin = c.req.header('origin');
  const applies = origin !== undefined && (c.req.method === 'POST' || c.req.method === 'OPTIONS') && isMarketingSignupSubmissionPath(c.req.path);
  const allowed = applies && await submissionOriginAllowed(c, deps, origin);
  await next();
  if (!allowed || origin === undefined) return;
  c.res.headers.set('access-control-allow-origin', origin);
  const vary = c.res.headers.get('vary');
  if (vary === null || !vary.toLowerCase().split(',').map((value) => value.trim()).includes('origin')) c.res.headers.append('vary', 'Origin');
};
const formPath = (slug: string): string => `/marketing/forms/${encodeURIComponent(slug)}`;
const htmlResponse = (body: string, status: number, extraHeaders: HeadersInit = {}): Response => {
  const headers = new Headers(extraHeaders);
  headers.set('content-type', 'text/html; charset=UTF-8');
  headers.set('cache-control', 'no-store');
  headers.set('referrer-policy', 'no-referrer');
  return new Response(body, { status, headers });
};
const typedValue = (value: unknown, maxLength: number): string => typeof value === 'string' ? value.slice(0, maxLength) : '';
const signupFormError = (error: AppError, fields: Record<string, unknown>): SignupFormError => {
  if (error.code === 'rate_limited') return 'rate_limited';
  return error.code === 'validation' && !marketingSignupSubmissionSchema.shape.email.safeParse(fields['email']).success ? 'email' : 'generic';
};
export const registerPublicMarketingSignupRoutes = (app: Hono<AppVars>, deps: AppDeps): void => {
  const nonce = (c: Context<AppVars>): string => c.get('secureHeadersNonce') ?? '';
  const unavailable = (c: Context<AppVars>, workspace: Workspace, slug: string): Response =>
    htmlResponse(renderSignupUnavailablePage({ nonce: nonce(c), brand: workspace.brand, language: workspace.language, path: formPath(slug) }), HTTP_STATUS_BY_ERROR_CODE.not_found);
  const rejectedFormPage = async (c: Context<AppVars>, workspace: Workspace, slug: string, error: AppError, fields: Record<string, unknown>): Promise<Response> => {
    const form = error.code === 'not_found' ? null : await activeForm(deps, workspace.brand.tenant.id, slug);
    const data = form === null ? null : await formPageData(deps, form);
    if (form === null || data === null) return unavailable(c, workspace, slug);
    if (form.redirectUrl !== null) c.set('signupRedirectOrigin', new URL(form.redirectUrl).origin);
    return htmlResponse(renderSignupFormPage({
      nonce: nonce(c), brand: workspace.brand, language: workspace.language, form, ...data, thanks: false,
      values: { email: typedValue(fields['email'], 254), displayName: typedValue(fields['displayName'], 120) },
      error: signupFormError(error, fields),
    }), HTTP_STATUS_BY_ERROR_CODE[error.code], retryAfterHeaders(error));
  };
  const page = async (c: Context<AppVars>, thanks: boolean) => {
    const workspace = await resolveWorkspace(c, deps);
    if (!workspace.ok) return respond(workspace);
    const slug = c.req.param('slug') ?? '';
    const form = await activeForm(deps, workspace.value.brand.tenant.id, slug);
    const data = form === null ? null : await formPageData(deps, form);
    if (form === null || data === null) return unavailable(c, workspace.value, slug);
    if (form.redirectUrl !== null) c.set('signupRedirectOrigin', new URL(form.redirectUrl).origin);
    return htmlResponse(renderSignupFormPage({ nonce: nonce(c), brand: workspace.value.brand, language: workspace.value.language, form, ...data, thanks }), 200);
  };
  app.get('/marketing/forms/:slug', (c) => page(c, false));
  app.get('/marketing/forms/:slug/thanks', (c) => page(c, true));
  app.options(API_PATHS.submitMarketingSignupForm, async (c) => {
    const context = await resolveForm(c, deps);
    if (!context.ok) return respond(context);
    const origin = c.req.header('origin');
    if (origin === undefined || !context.value.form.allowedOrigins.includes(origin)) return c.body(null, 403);
    return c.body(null, 204, { vary: 'Origin', 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '60' });
  });
  app.post(API_PATHS.submitMarketingSignupForm, async (c) => {
    const started = performance.now();
    const contentType = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
    const json = contentType === 'application/json';
    const formPost = contentType === 'application/x-www-form-urlencoded';
    const workspace = await resolveWorkspace(c, deps);
    if (!workspace.ok) return respond(workspace);
    const slug = c.req.param('slug') ?? '';
    const form = await activeForm(deps, workspace.value.brand.tenant.id, slug);
    if (form === null) return formPost ? unavailable(c, workspace.value, slug) : respond(err(notFound('Signup form was not found')));
    const rateLimit = c.get('signupRateLimit');
    if (rateLimit !== undefined) {
      return formPost
        ? rejectedFormPage(c, workspace.value, slug, rateLimit, Object.fromEntries(new URLSearchParams(await c.req.text())))
        : respond(err(rateLimit), { headers: retryAfterHeaders(rateLimit) });
    }
    if (deps.marketingSignup === undefined) return respond(err(internal('Signup forms are unavailable')));
    const { resolved, language } = workspace.value;
    if (!json && !formPost) return c.body(null, 415);
    const origin = c.req.header('origin');
    if (json && origin !== undefined && !form.allowedOrigins.includes(origin)) return c.body(null, 403);
    const input: unknown = json ? await readJson(c.req.raw) : Object.fromEntries(new URLSearchParams(await c.req.text()));
    const fields = z.record(z.unknown()).safeParse(input);
    if (!fields.success) return respond(err(validation('Invalid signup submission')));
    const result = await submitMarketingSignupForm(form.tenantId, form.slug, fields.data, {
      ipHash: deps.marketingSignup.hmac.compute(form.tenantId, trustedClientIp(c, deps.authTrustedProxyHeader) ?? 'unattributed'),
      userAgent: (c.req.header('user-agent') ?? '').slice(0, 1000), language,
      confirmationBaseUrl: `${await authLinkBaseUrl(resolved, deps)}/marketing/confirm`,
    }, deps.marketingSignup);
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, 500 - (performance.now() - started))));
    if (!result.ok) return formPost ? rejectedFormPage(c, workspace.value, slug, result.error, fields.data) : respond(result);
    if (json) return c.json({ status: result.value.status }, 200, { 'cache-control': 'no-store' });
    return c.redirect(result.value.form.redirectUrl ?? `${formPath(form.slug)}/thanks?lang=${language}`, 303);
  });
};
