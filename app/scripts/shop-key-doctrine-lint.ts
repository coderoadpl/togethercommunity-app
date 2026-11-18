interface DoctrineRequirement {
  file: string;
  section?: string;
  text: string;
  reason: string;
}

export const shopKeyDoctrineRequirements: readonly DoctrineRequirement[] = [
  {
    file: 'app/CLAUDE.md',
    text: 'Shop management keys (owner decision 2026-11-14, approved for PR #410 and #411):',
    reason: 'must record the dated owner decision on shop management keys',
  },
  {
    file: 'app/CLAUDE.md',
    text: 'A key with `shop:fulfilment:write` can create carrier shipments (InPost ShipX) for its workspace\'s orders, which the carrier charges for.',
    reason: 'must state in the owner decision that the fulfilment scope can buy carrier shipments',
  },
  {
    file: 'app/CLAUDE.md',
    text: 'its invoicing credentials and its object storage connection, and nothing else',
    reason: 'must name the object storage connection and close the integration scope in the owner decision',
  },
  {
    file: 'app/CLAUDE.md',
    text: 'a key never writes webhook signing secrets or webhook endpoint ids directly',
    reason: 'must state in the owner decision what the integration scope can never write',
  },
  {
    file: 'app/docs/security.md',
    section: '## Tenant API keys',
    text: 'owner decision 2026-11-14',
    reason: 'must reference the owner decision on shop management keys',
  },
  {
    file: 'app/docs/security.md',
    section: '## Tenant API keys',
    text: '`shop_management_keys`',
    reason: 'must describe the separate shop management key table',
  },
  {
    file: 'app/docs/security.md',
    section: '## Tenant API keys',
    text: '`SHOP_MANAGEMENT_KEYS`',
    reason: 'must describe the shop management off switch',
  },
  {
    file: 'app/docs/security.md',
    section: '## Tenant API keys',
    text: '`shop:integrations:write`',
    reason: 'must state what the integration write scope can configure',
  },
  {
    file: 'app/docs/security.md',
    section: '## Tenant API keys',
    text: '`POST /api/m2m/shop/integrations/stripe/configure`',
    reason: 'must state that a key configures Stripe, the live slot included',
  },
  {
    file: 'app/docs/security.md',
    section: '## Tenant API keys',
    text: '`POST /api/m2m/shop/integrations/storage/configure`',
    reason: 'must state that a key configures the storage connection',
  },
  {
    file: 'app/docs/security.md',
    section: '## Tenant API keys',
    text: '`ksef.test.contextNip`',
    reason: 'must list the finite generic secret allow-list of shop keys',
  },
  {
    file: 'app/docs/security.md',
    section: '## Tenant API keys',
    text: 'A refusal returned by the handler (a validation error, an id of another workspace, a conflict) does have a request row',
    reason: 'must state that a refusal returned by a shop route handler has a key history row',
  },
  {
    file: 'app/docs/security.md',
    section: '## Tenant API keys',
    text: 'the bound multiplies by the number of keys, which is not capped per workspace, and a retention job for `shop_management_key_events` is a follow-up',
    reason: 'must state the per-key history bound and the missing retention job',
  },
  {
    file: 'app/docs/security.md',
    section: '## Tenant API keys',
    text: '`shop:fulfilment:write` grants `order:write`, which includes creating carrier shipments (InPost ShipX), a paid action at the carrier',
    reason: 'must state that the fulfilment scope can create paid carrier shipments',
  },
  {
    file: 'app/docs/security.md',
    section: '## InPost ShipX credentials',
    text: '`POST /api/m2m/shop/integrations/shipx/configure`',
    reason: 'must name the keyed ShipX credential write route',
  },
  {
    file: 'app/docs/security.md',
    section: '## InPost ShipX credentials',
    text: '`/api/m2m/shop/orders/<orderId>/shipx`',
    reason: 'must name the keyed ShipX shipment routes',
  },
  {
    file: 'app/docs/security.md',
    section: '## InPost ShipX credentials',
    text: 'classified `api-key`',
    reason: 'must state the api-key origin classification of the keyed ShipX routes',
  },
  {
    file: 'app/docs/security.md',
    section: '## InPost ShipX credentials',
    text: "act as the key's issuer",
    reason: "must state that the keyed ShipX routes act as the key's issuer",
  },
  {
    file: 'app/docs/security.md',
    section: '## InPost ShipX credentials',
    text: "buys the shipment at InPost, charged to the workspace's carrier account, so a key with `shop:fulfilment:write` can spend carrier money",
    reason: 'must state that a keyed ShipX shipment creation is paid at the carrier',
  },
  {
    file: 'app/docs/security.md',
    section: '## InPost ShipX credentials',
    text: 'so a call the use-case then refuses (a lease conflict, a missing configuration, an order of another workspace) keeps its history row',
    reason: 'must state that a keyed ShipX call refused by its use-case keeps its key history row',
  },
  {
    file: 'app/docs/shop-management-keys.md',
    text: 'A key with `shop:fulfilment:write` can create carrier shipments, a paid action at the carrier',
    reason: 'must state that the fulfilment scope can create paid carrier shipments',
  },
  {
    file: 'app/docs/shop-management-keys.md',
    text: 'a retention job for `shop_management_key_events` is a follow-up',
    reason: 'must state that the key history has no retention job yet',
  },
  {
    file: 'app/docs/shop-management-keys.md',
    text: 'The bound multiplies by the number of keys, and the number of shop management keys per workspace is not capped.',
    reason: 'must state that the history bound multiplies by the uncapped number of keys',
  },
  {
    file: 'app/docs/shop-management-keys.md',
    text: '`shop:integrations:write` reaches only an allow-list kept in `core/domain/shop-management-key.ts`',
    reason: 'must state that the integration write scope reaches only the domain allow-list',
  },
  {
    file: 'app/docs/shop-management-keys.md',
    text: 'storage configure (the object storage connection)',
    reason: 'must name the object storage connection among the allow-listed operations',
  },
  {
    file: 'app/docs/shop-management-keys.md',
    text: 'A key never writes a webhook signing secret or endpoint id directly, the Meta Conversions API token',
    reason: 'must state what the integration write scope can never write',
  },
  {
    file: 'app/docs/security.md',
    section: '## Tenant API keys',
    text: 'a key ctx holds that capability only for an operation on the allow-list in `core/domain/shop-management-key.ts`',
    reason: 'must state that the integration write scope holds the secret write capability only for allow-listed operations',
  },
  {
    file: 'app/docs/security.md',
    section: '## Tenant API keys',
    text: 'the storage configure use-case (the object storage connection)',
    reason: 'must name the object storage connection among the allow-listed operations',
  },
  {
    file: 'app/docs/security.md',
    section: '## Tenant API keys',
    text: 'A key never writes a webhook signing secret or endpoint id directly, the Meta Conversions API token',
    reason: 'must state what the integration write scope can never write',
  },
  {
    file: 'app/docs/security.md',
    section: '## Tenant API keys',
    text: 'a key ctx holds that capability only when the use-case names the shop settings update or the branding asset upload with fields from the allow-list `SHOP_MANAGEMENT_KEY_SETTINGS_FIELDS`',
    reason: 'must state that the settings write scope holds the settings write capability only for allow-listed fields',
  },
  {
    file: 'app/docs/shop-management-keys.md',
    text: '`shop:settings:write` reaches only the shop settings fields on the allow-list `SHOP_MANAGEMENT_KEY_SETTINGS_FIELDS` in `core/domain/shop-management-key.ts`',
    reason: 'must state that the settings write scope reaches only the domain field allow-list',
  },
  {
    file: 'app/docs/security.md',
    section: '## Meta conversions credentials',
    text: 'A shop management key never writes or removes it',
    reason: 'must state that a shop management key never writes the Meta Conversions API token',
  },
  {
    file: 'app/docs/security.md',
    section: '## InPost ShipX credentials',
    text: 'A shop management key may write them only through the ShipX configure use-case, never through the generic tenant-secret write',
    reason: 'must state how a shop management key may write the carrier credentials',
  },
  {
    file: 'app/docs/observability.md',
    text: 'Shop management keys are a separate credential class',
    reason: 'must tell shop management keys apart from tenant API keys in the skipped settings check',
  },
  {
    file: 'app/docs/observability.md',
    text: '`shop:settings:read` grants `tenant:settings:read`',
    reason: 'must state that the shop settings read scope grants the settings read capability',
  },
  {
    file: 'app/docs/shop-management-keys.md',
    text: 'A call refused before the handler (an invalid key, an issuer who no longer qualifies, the rate limit, a missing scope, mixed credentials, the off switch or the body size limit) has no row',
    reason: 'must state that a carrier call refused before its handler has no key history row',
  },
];

export const shopKeyDoctrineContradictions: readonly DoctrineRequirement[] = [
  {
    file: 'app/docs/observability.md',
    text: 'none of them grants `tenant:settings:read`, so a Studio settings read cannot be authenticated by a key from a workflow',
    reason: 'must not claim that no key grants the settings read capability',
  },
  {
    file: 'app/docs/shop-management-keys.md',
    text: 'the refused ones included, has its key history `request` row',
    reason: 'must not claim that every refused carrier call has a key history row',
  },
];

const singleSpaced = (text: string): string => text.replace(/\s+/gu, ' ');

const sectionOf = (text: string, heading: string): string | null => {
  const lines = text.split('\n');
  const start = lines.indexOf(heading);
  if (start === -1) return null;
  const level = heading.slice(0, heading.indexOf(' ') + 1);
  const end = lines.findIndex((line, index) => index > start && line.startsWith(level));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
};

const requirementProblem = (files: ReadonlyMap<string, string>, requirement: DoctrineRequirement): string | null => {
  const text = files.get(requirement.file);
  if (text === undefined) return `[shop-key-doctrine] ${requirement.file} is not tracked markdown`;
  const scope = requirement.section === undefined ? text : sectionOf(text, requirement.section);
  if (scope === null) return `[shop-key-doctrine] ${requirement.file} has no "${requirement.section ?? ''}" section`;
  if (singleSpaced(scope).includes(singleSpaced(requirement.text))) return null;
  const where = requirement.section === undefined ? requirement.file : `${requirement.file} "${requirement.section}"`;
  return `[shop-key-doctrine] ${where} ${requirement.reason} (expected "${requirement.text}")`;
};

const contradictionProblem = (files: ReadonlyMap<string, string>, contradiction: DoctrineRequirement): string | null => {
  const text = files.get(contradiction.file);
  if (text === undefined || !singleSpaced(text).includes(singleSpaced(contradiction.text))) return null;
  return `[shop-key-doctrine] ${contradiction.file} ${contradiction.reason} (found "${contradiction.text}")`;
};

export const collectShopKeyDoctrineProblems = (files: ReadonlyMap<string, string>): string[] => [
  ...new Set([
    ...shopKeyDoctrineRequirements.map((requirement) => requirementProblem(files, requirement)),
    ...shopKeyDoctrineContradictions.map((contradiction) => contradictionProblem(files, contradiction)),
  ].filter((problem): problem is string => problem !== null)),
];
