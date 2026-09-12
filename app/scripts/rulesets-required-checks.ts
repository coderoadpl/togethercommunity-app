import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';
import { z } from 'zod';

export const RULESET_BRANCHES = ['staging', 'main'] as const;
export type RulesetBranch = typeof RULESET_BRANCHES[number];
export type RequiredChecksByBranch = Record<RulesetBranch, string[]>;

export interface WorkflowSource {
  file: string;
  text: string;
}

export interface RulesetComparison {
  expectedMissing: string[];
  requiredUnknown: string[];
}

export type RulesetComparisonByBranch = Record<RulesetBranch, RulesetComparison>;

export const IGNORED_WORKFLOW_FILES: Readonly<Record<string, string>> = {
  'chromatic.yml':
    'the token-detection job is not a product gate, and the Chromatic job is gated on an optional project token',
};

const scalarSchema = z.union([z.string(), z.number(), z.boolean()]);

const workflowSchema = z.object({
  name: z.string().optional(),
  on: z.unknown().optional(),
  jobs: z.record(z.object({
    name: z.string().optional(),
    if: z.union([z.string(), z.boolean()]).optional(),
    'continue-on-error': z.union([z.boolean(), z.string()]).optional(),
    strategy: z.object({
      matrix: z.record(z.unknown()).optional(),
    }).passthrough().optional(),
  }).passthrough()),
}).passthrough();

type WorkflowJob = z.output<typeof workflowSchema>['jobs'][string];

type Scalar = string | number | boolean | null;

const UNRESOLVED = Symbol('unresolved');
type Resolved = Scalar | typeof UNRESOLVED;

type Token =
  | { kind: 'value'; value: Scalar }
  | { kind: 'path'; value: string }
  | { kind: 'op'; value: string };

const operators = ['==', '!=', '<=', '>=', '&&', '||', '!', '<', '>', '(', ')', ',', '[', ']'];

const keywords: Readonly<Record<string, Scalar>> = { true: true, false: false, null: null };

const tokenize = (source: string): Token[] => {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index] ?? '';
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "'") {
      let literal = '';
      index += 1;
      for (;;) {
        if (index >= source.length) throw new Error(`unterminated string in expression: ${source}`);
        if (source[index] === "'") {
          if (source[index + 1] === "'") {
            literal += "'";
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        literal += source[index] ?? '';
        index += 1;
      }
      tokens.push({ kind: 'value', value: literal });
      continue;
    }
    const operator = operators.find((candidate) => source.startsWith(candidate, index));
    if (operator !== undefined) {
      tokens.push({ kind: 'op', value: operator });
      index += operator.length;
      continue;
    }
    const number = /^\d+(?:\.\d+)?/.exec(source.slice(index));
    if (number !== null) {
      tokens.push({ kind: 'value', value: Number(number[0]) });
      index += number[0].length;
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(source.slice(index));
    if (word === null) throw new Error(`unsupported character "${char}" in expression: ${source}`);
    const keyword = keywords[word[0]];
    tokens.push(keyword === undefined
      ? { kind: 'path', value: word[0] }
      : { kind: 'value', value: keyword });
    index += word[0].length;
  }
  return tokens;
};

const isTruthy = (value: Scalar): boolean =>
  value !== false && value !== 0 && value !== '' && value !== null;

const negate = (value: Resolved): Resolved =>
  value === UNRESOLVED ? UNRESOLVED : !isTruthy(value);

const looseEquals = (left: Resolved, right: Resolved): Resolved => {
  if (left === UNRESOLVED || right === UNRESOLVED) return UNRESOLVED;
  if (typeof left === 'string' && typeof right === 'string') {
    return left.toLowerCase() === right.toLowerCase();
  }
  return left === right;
};

const evaluateExpression = (source: string, context: ReadonlyMap<string, Scalar>): Resolved => {
  const tokens = tokenize(source);
  let position = 0;
  const peek = (): Token | undefined => tokens[position];
  const eat = (value: string): boolean => {
    const token = peek();
    if (token?.kind === 'op' && token.value === value) {
      position += 1;
      return true;
    }
    return false;
  };
  const skipCallArguments = (): void => {
    let depth = 1;
    while (depth > 0) {
      const token = peek();
      if (token === undefined) throw new Error(`unbalanced call in expression: ${source}`);
      position += 1;
      if (token.kind !== 'op') continue;
      if (token.value === '(') depth += 1;
      if (token.value === ')') depth -= 1;
    }
  };
  const parsePrimary = (): Resolved => {
    if (eat('(')) {
      const value = parseOr();
      if (!eat(')')) throw new Error(`unbalanced parentheses in expression: ${source}`);
      return value;
    }
    if (eat('!')) return negate(parsePrimary());
    const token = peek();
    if (token === undefined) throw new Error(`unexpected end of expression: ${source}`);
    position += 1;
    if (token.kind === 'value') return token.value;
    if (token.kind === 'path') {
      if (eat('(')) {
        skipCallArguments();
        return UNRESOLVED;
      }
      return context.has(token.value) ? context.get(token.value) ?? null : UNRESOLVED;
    }
    throw new Error(`unsupported token "${token.value}" in expression: ${source}`);
  };
  const parseComparison = (): Resolved => {
    let value = parsePrimary();
    while (eat('<=') || eat('>=') || eat('<') || eat('>')) {
      parsePrimary();
      value = UNRESOLVED;
    }
    return value;
  };
  const parseEquality = (): Resolved => {
    let value = parseComparison();
    for (;;) {
      if (eat('==')) value = looseEquals(value, parseComparison());
      else if (eat('!=')) value = negate(looseEquals(value, parseComparison()));
      else return value;
    }
  };
  const parseAnd = (): Resolved => {
    let value = parseEquality();
    while (eat('&&')) {
      const right = parseEquality();
      if (value === UNRESOLVED) {
        value = right !== UNRESOLVED && !isTruthy(right) ? right : UNRESOLVED;
      } else value = isTruthy(value) ? right : value;
    }
    return value;
  };
  function parseOr(): Resolved {
    let value = parseAnd();
    while (eat('||')) {
      const right = parseAnd();
      if (value === UNRESOLVED) {
        value = right !== UNRESOLVED && isTruthy(right) ? right : UNRESOLVED;
      } else value = isTruthy(value) ? value : right;
    }
    return value;
  }
  const result = parseOr();
  if (position !== tokens.length) {
    throw new Error(`unsupported trailing tokens in expression: ${source}`);
  }
  return result;
};

const interpolationPattern = /\$\{\{([\s\S]*?)\}\}/g;

const evaluateCondition = (
  condition: string | boolean,
  context: ReadonlyMap<string, Scalar>,
): boolean | typeof UNRESOLVED => {
  if (typeof condition === 'boolean') return condition;
  const body = condition.trim();
  const wrapped = /^\$\{\{([\s\S]*)\}\}$/.exec(body);
  const value = evaluateExpression(wrapped === null ? body : wrapped[1] ?? '', context);
  return value === UNRESOLVED ? UNRESOLVED : isTruthy(value);
};

const renderName = (
  name: string,
  context: ReadonlyMap<string, Scalar>,
  describe: string,
): string => {
  if (!name.includes('${{')) return name;
  const unresolvable = new Error(
    `${describe}: name expression "${name}" does not resolve to a pull-request check name`,
  );
  const rendered = name.replace(interpolationPattern, (_match, body: string) => {
    const value = evaluateExpression(body, context);
    if (value === UNRESOLVED || value === null) throw unresolvable;
    return String(value);
  }).trim();
  if (rendered === '') throw unresolvable;
  return rendered;
};

type MatrixValues = Record<string, string | number | boolean>;

const matrixEntrySchema = z.record(scalarSchema);

const matrixCombinations = (
  matrix: Record<string, unknown> | undefined,
  describe: string,
): MatrixValues[] => {
  if (matrix === undefined) return [{}];
  const axes: [string, (string | number | boolean)[]][] = [];
  for (const [key, value] of Object.entries(matrix)) {
    if (key === 'include' || key === 'exclude') continue;
    const parsed = z.array(scalarSchema).nonempty().safeParse(value);
    if (!parsed.success) {
      throw new Error(
        `${describe}: matrix axis "${key}" is not a non-empty list of scalars, so its check names cannot be derived`,
      );
    }
    axes.push([key, [...parsed.data]]);
  }
  const listEntries = (key: 'include' | 'exclude'): MatrixValues[] => {
    const raw = matrix[key];
    if (raw === undefined) return [];
    const parsed = z.array(matrixEntrySchema).safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `${describe}: matrix ${key} is not a list of scalar objects, so its check names cannot be derived`,
      );
    }
    return parsed.data.map((entry) => ({ ...entry }));
  };
  const includes = listEntries('include');
  const excludes = listEntries('exclude');
  const matches = (combination: MatrixValues, entry: MatrixValues): boolean =>
    Object.entries(entry).every(([key, value]) => combination[key] === value);
  if (axes.length === 0) {
    if (includes.length === 0) {
      throw new Error(`${describe}: matrix declares neither axes nor include entries`);
    }
    return includes;
  }
  let combinations: MatrixValues[] = [{}];
  for (const [key, values] of axes) {
    combinations = combinations.flatMap((combination) =>
      values.map((value) => ({ ...combination, [key]: value })));
  }
  combinations = combinations.filter((combination) =>
    !excludes.some((entry) => matches(combination, entry)));
  const axisKeys = new Set(axes.map(([key]) => key));
  for (const entry of includes) {
    const axisPart = Object.fromEntries(
      Object.entries(entry).filter(([key]) => axisKeys.has(key)),
    );
    const targets = combinations.filter((combination) => matches(combination, axisPart));
    if (targets.length === 0) {
      combinations.push({ ...entry });
      continue;
    }
    for (const target of targets) Object.assign(target, entry);
  }
  return combinations;
};

const pullRequestContext = (combination: MatrixValues): ReadonlyMap<string, Scalar> => {
  const context = new Map<string, Scalar>([
    ['github.event_name', 'pull_request'],
    ['github.ref', 'refs/pull/1/merge'],
    ['github.ref_name', '1/merge'],
    ['github.ref_type', 'branch'],
  ]);
  for (const [key, value] of Object.entries(combination)) context.set(`matrix.${key}`, value);
  return context;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [];

const hasPullRequestEvent = (value: unknown): boolean => {
  if (value === 'pull_request') return true;
  if (Array.isArray(value)) return value.includes('pull_request');
  return isRecord(value) && Object.hasOwn(value, 'pull_request');
};

const pullRequestBranches = (value: unknown): RulesetBranch[] => {
  if (!hasPullRequestEvent(value)) return [];
  if (!isRecord(value)) return [...RULESET_BRANCHES];
  const trigger = value['pull_request'];
  if (!isRecord(trigger)) return [...RULESET_BRANCHES];
  if (Object.hasOwn(trigger, 'paths') || Object.hasOwn(trigger, 'paths-ignore')) return [];
  const types = strings(trigger['types']);
  if (types.length > 0 && !types.includes('synchronize')) return [];
  const branches = strings(trigger['branches']);
  if (branches.length === 0) return [...RULESET_BRANCHES];
  return RULESET_BRANCHES.filter((branch) => branches.includes(branch));
};

const combinationLabel = (combination: MatrixValues): string =>
  Object.values(combination).map((value) => String(value)).join(', ');

const jobCheckNames = (jobId: string, job: WorkflowJob, describe: string): string[] => {
  if (job['continue-on-error'] === true) return [];
  const names: string[] = [];
  for (const combination of matrixCombinations(job.strategy?.matrix, describe)) {
    const context = pullRequestContext(combination);
    if (job.if !== undefined && evaluateCondition(job.if, context) === false) continue;
    const label = combinationLabel(combination);
    names.push(job.name === undefined
      ? (label === '' ? jobId : `${jobId} (${label})`)
      : renderName(job.name, context, describe));
  }
  return names;
};

const addUnique = (target: string[], names: readonly string[]): void => {
  for (const name of names) {
    if (!target.includes(name)) target.push(name);
  }
};

export const deriveRequiredChecksFromWorkflowSources = (
  sources: readonly WorkflowSource[],
): RequiredChecksByBranch => {
  const checks: RequiredChecksByBranch = { staging: [], main: [] };
  for (const source of sources) {
    if (Object.hasOwn(IGNORED_WORKFLOW_FILES, source.file)) continue;
    const workflow = workflowSchema.parse(parse(source.text));
    const branches = pullRequestBranches(workflow.on);
    if (branches.length === 0) continue;
    for (const [jobId, job] of Object.entries(workflow.jobs)) {
      const names = jobCheckNames(jobId, job, `${source.file} job "${jobId}"`);
      for (const branch of branches) addUnique(checks[branch], names);
    }
  }
  return checks;
};

export const deriveRequiredChecksFromWorkflows = (repoRoot: string): RequiredChecksByBranch => {
  const workflowDir = join(repoRoot, '.github', 'workflows');
  const sources = readdirSync(workflowDir)
    .filter((file) => /\.ya?ml$/.test(file))
    .sort()
    .map((file) => ({ file, text: readFileSync(join(workflowDir, file), 'utf8') }));
  return deriveRequiredChecksFromWorkflowSources(sources);
};

const ordered = (names: Iterable<string>): string[] => [...new Set(names)].sort();

export const compareRulesetChecks = (
  expected: readonly string[],
  required: readonly string[],
): RulesetComparison => {
  const expectedSet = new Set(expected);
  const requiredSet = new Set(required);
  return {
    expectedMissing: ordered(expected.filter((name) => !requiredSet.has(name))),
    requiredUnknown: ordered(required.filter((name) => !expectedSet.has(name))),
  };
};

export const compareRulesetBranches = (
  expected: RequiredChecksByBranch,
  required: RequiredChecksByBranch,
): RulesetComparisonByBranch => ({
  staging: compareRulesetChecks(expected.staging, required.staging),
  main: compareRulesetChecks(expected.main, required.main),
});

export const hasMissingRequiredChecks = (comparison: RulesetComparisonByBranch): boolean =>
  RULESET_BRANCHES.some((branch) => comparison[branch].expectedMissing.length > 0);

export const hasRulesetDrift = (comparison: RulesetComparisonByBranch): boolean =>
  RULESET_BRANCHES.some((branch) =>
    comparison[branch].expectedMissing.length > 0 || comparison[branch].requiredUnknown.length > 0);
