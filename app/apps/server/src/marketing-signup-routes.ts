import type { Hono, Context, MiddlewareHandler } from 'hono';
import { z } from 'zod';

import { API_PATHS, marketingSignupContracts } from '#core/contract/index.js';
import { err, internal, notFound, tenantNotFound, validation } from '#core/domain/index.js';
import { resolveTenant, authLinkBaseUrl, createMarketingSignupForm, getMarketingSignupForm, listMarketingSignupForms, updateMarketingSignupForm, submitMarketingSignupForm } from '#core/server/index.js';

import type { AppDeps } from './composition.js';
import type { AppVars } from './app-vars.js';
import { ctxOf } from './ctx-of.js';
import { readJson } from './read-json.js';
import { respond } from './respond.js';
import { trustedClientIp } from './auth-network.js';
import { isMarketingSignupSubmissionPath } from './body-limits.js';
import { languageFromRequest, renderSignupFormPage } from './public-marketing-pages.js';

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
const resolveForm = async (c: Context<AppVars>, deps: AppDeps) => {
  const resolved = await resolveTenant(c.req.header('host') ?? '', null, deps);
  if (!resolved.ok || resolved.value === null) return resolved.ok ? err(tenantNotFound()) : resolved;
  const form = await deps.marketingSignup?.forms.findBySlug(resolved.value.tenant.id, c.req.param('slug') ?? '');
  if (form === undefined || form === null || form.status !== 'active') return err(notFound('Signup form was not found'));
  const settings = await deps.tenants.findSettings(resolved.value.tenant.id);
  return { ok: true, value: { resolved: resolved.value, form, brand: { tenant: resolved.value.tenant, settings }, language: languageFromRequest(c.req.raw, settings?.defaultLanguage) } } as const;
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
export const registerPublicMarketingSignupRoutes = (app: Hono<AppVars>, deps: AppDeps): void => {
  const page = async (c: Context<AppVars>, thanks: boolean) => {
    const context = await resolveForm(c, deps);
    if (!context.ok) return respond(context);
    const { form, brand, language } = context.value;
    if (form.redirectUrl !== null) c.set('signupRedirectOrigin', new URL(form.redirectUrl).origin);
    const definition = await deps.marketing?.definitions.findById(form.tenantId, form.consentDefinitionId);
    const version = form.consentVersion;
    if (definition === undefined || definition === null || definition.status !== 'active' || version === undefined) return respond(err(notFound('Signup form was not found')));
    return c.html(renderSignupFormPage({ nonce: c.get('secureHeadersNonce') ?? '', brand, language, form, wording: version.label, doubleOptIn: definition.doubleOptIn, thanks }), 200, { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
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
    const context = await resolveForm(c, deps);
    if (!context.ok) return respond(context);
    if (deps.marketingSignup === undefined) return respond(err(internal('Signup forms are unavailable')));
    const { form, language, resolved } = context.value;
    const contentType = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
    const json = contentType === 'application/json';
    if (!json && contentType !== 'application/x-www-form-urlencoded') return c.body(null, 415);
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
    if (!result.ok) return respond(result);
    if (json) return c.json({ status: result.value.status }, 200, { 'cache-control': 'no-store' });
    return c.redirect(result.value.form.redirectUrl ?? `/marketing/forms/${encodeURIComponent(form.slug)}/thanks?lang=${language}`, 303);
  });
};
