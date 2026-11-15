interface DoctrineRequirement {
  file: string;
  section?: string;
  text: string;
  reason: string;
}

export const shopKeyDoctrineRequirements: readonly DoctrineRequirement[] = [
  {
    file: 'app/CLAUDE.md',
    text: 'Shop management keys (owner decision 2026-11-14):',
    reason: 'must record the dated owner decision on shop management keys',
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
    text: '`shop_management`',
    reason: 'must describe the shop management key kind',
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
];

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
  if (scope.includes(requirement.text)) return null;
  const where = requirement.section === undefined ? requirement.file : `${requirement.file} "${requirement.section}"`;
  return `[shop-key-doctrine] ${where} ${requirement.reason} (expected "${requirement.text}")`;
};

export const collectShopKeyDoctrineProblems = (files: ReadonlyMap<string, string>): string[] => [
  ...new Set(
    shopKeyDoctrineRequirements
      .map((requirement) => requirementProblem(files, requirement))
      .filter((problem): problem is string => problem !== null),
  ),
];
