import { z } from 'zod';

const dnsLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const localSuffixes = ['localhost', 'local', 'internal', 'home.arpa'];

export const signInClientHostSchema = z.string().max(253).refine((host) => {
  const labels = host.split('.');
  return labels.length >= 2
    && !/\.[0-9]+$/u.test(host)
    && labels.every((label) => dnsLabel.test(label) && !label.startsWith('xn--'))
    && !localSuffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
    && URL.parse(`https://${host}/`)?.hostname === host;
}, 'Expected a canonical DNS hostname');

export const isSignInClientPlatformHost = (host: string, baseDomain: string): boolean => {
  const apex = baseDomain.toLowerCase().replace(/\.$/u, '');
  return host === apex || host.endsWith(`.${apex}`);
};

const canonicalPathEscapes = (path: string): boolean => {
  if (/%(?![0-9A-F]{2})/u.test(path)) return false;
  for (const [escape] of path.matchAll(/%[0-9A-F]{2}/gu)) {
    const byte = Number.parseInt(escape.slice(1), 16);
    if (byte <= 32 || byte === 127 || /[A-Za-z0-9._~*\\-]/u.test(String.fromCharCode(byte))) return false;
  }
  return true;
};

const redirectUriSchema = z.string().max(2048).refine((uri) => {
  if (/[\s\p{Cc}\\*?#]/u.test(uri) || new TextEncoder().encode(uri).length > 2048) return false;
  const [, host, path] = /^https:\/\/([^/]+)(\/.*)$/u.exec(uri) ?? [];
  return host !== undefined && path !== undefined
    && signInClientHostSchema.safeParse(host).success
    && canonicalPathEscapes(path)
    && URL.parse(uri)?.href === uri;
}, 'Expected a canonical HTTPS return address');

const redirectUrisSchema = z.array(redirectUriSchema).min(1).max(5).refine((uris) => {
  const host = URL.parse(uris[0] ?? '')?.hostname;
  return new Set(uris).size === uris.length && uris.every((uri) => URL.parse(uri)?.hostname === host);
}, 'Expected distinct return addresses on one host');

export const signInClientIdSchema = z.string().regex(/^sc_[A-Za-z0-9_-]{22}$/u);
export const signInClientSecretSchema = z.string().regex(/^tc_sc_[A-Za-z0-9_-]{43}$/u);

const nameSchema = z.string().trim().min(1).max(120).refine((name) => !/\p{Cc}/u.test(name));
const credentialVersionSchema = z.number().int().min(1).max(2_147_483_647);
const instant = z.string().datetime();

export const createSignInClientInputSchema = z.object({ name: nameSchema, redirectUris: redirectUrisSchema }).strict();
export const rotateSignInClientSecretInputSchema = z.object({ expectedCredentialVersion: credentialVersionSchema }).strict();
export const listSignInClientsInputSchema = z.object({
  cursor: signInClientIdSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50),
}).strict();

const publicClient = z.object({
  id: signInClientIdSchema,
  redirectHost: signInClientHostSchema,
  credentialVersion: credentialVersionSchema,
  createdAt: instant,
  updatedAt: instant,
  secretRotatedAt: instant.nullable(),
  hostVerifiedAt: z.null(),
  activatedAt: z.null(),
}).strict();

export const signInClientPublicSchema = z.discriminatedUnion('state', [
  publicClient.extend({
    state: z.literal('pending_activation'),
    name: nameSchema,
    redirectUris: redirectUrisSchema,
    secretExpiresAt: instant,
    retiredAt: z.null(),
  }),
  publicClient.extend({
    state: z.literal('retired'),
    name: z.null(),
    redirectUris: z.tuple([]),
    secretExpiresAt: z.null(),
    retiredAt: instant,
  }),
]).refine((client) => client.redirectUris.every((uri) => URL.parse(uri)?.hostname === client.redirectHost));

export const signInClientCredentialSchema = z.object({
  client: signInClientPublicSchema,
  secret: signInClientSecretSchema,
}).strict().refine(({ client }) => client.state === 'pending_activation');

export const signInClientPageSchema = z.object({
  clients: z.array(signInClientPublicSchema).max(100),
  nextCursor: signInClientIdSchema.nullable(),
}).strict();

export const signInClientEventSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  clientId: signInClientIdSchema,
  kind: z.enum(['created', 'secret_rotated', 'retired']),
  actorKind: z.literal('direct_owner'),
  credentialVersion: credentialVersionSchema,
  occurredAt: instant,
}).strict();

const preapprovedPairSchema = z.tuple([
  z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u),
  signInClientHostSchema,
]);

export const signInClientHostsSchema = z.string().default('').transform((raw, ctx) => {
  const allowed = new Map<string, Set<string>>();
  if (raw === '') return allowed;
  for (const entry of raw.split(',')) {
    const pair = preapprovedPairSchema.safeParse(entry.split('='));
    if (!pair.success || allowed.get(pair.data[0])?.has(pair.data[1]) === true) {
      ctx.addIssue({ code: 'custom', message: 'Expected distinct workspace=hostname pairs' });
      return z.NEVER;
    }
    const [tenantId, host] = pair.data;
    const hosts = allowed.get(tenantId) ?? new Set<string>();
    hosts.add(host);
    allowed.set(tenantId, hosts);
  }
  return allowed;
});

export type SignInClientHosts = ReadonlyMap<string, ReadonlySet<string>>;
export type CreateSignInClientInput = z.input<typeof createSignInClientInputSchema>;
export type RotateSignInClientSecretInput = z.infer<typeof rotateSignInClientSecretInputSchema>;
export type ListSignInClientsInput = z.input<typeof listSignInClientsInputSchema>;
export type SignInClientPublic = z.infer<typeof signInClientPublicSchema>;
export type SignInClientCredential = z.infer<typeof signInClientCredentialSchema>;
export type SignInClientPage = z.infer<typeof signInClientPageSchema>;
export type SignInClientEvent = z.infer<typeof signInClientEventSchema>;
