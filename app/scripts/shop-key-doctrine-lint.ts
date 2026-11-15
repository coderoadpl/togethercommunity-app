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
    file: 'app/docs/shop-management-keys.md',
    text: 'a retention job for `shop_management_key_events` is a follow-up',
    reason: 'must state that the key history has no retention job yet',
  },
  {
    file: 'app/docs/shop-management-keys.md',
    text: 'The bound multiplies by the number of keys, and the number of shop management keys per workspace is not capped.',
    reason: 'must state that the history bound multiplies by the uncapped number of keys',
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

export const collectShopKeyDoctrineProblems = (files: ReadonlyMap<string, string>): string[] => [
  ...new Set(
    shopKeyDoctrineRequirements
      .map((requirement) => requirementProblem(files, requirement))
      .filter((problem): problem is string => problem !== null),
  ),
];
