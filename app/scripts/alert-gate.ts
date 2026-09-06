import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface AlertGateState {
  green: boolean;
  paging: boolean;
  failing: string[];
  cleared: string[];
}

/**
 * `checks` is the inventory the monitor measured. A failing name outside it is a
 * monitor-level failure — the run could not measure its checks at all — and pages
 * as soon as the monitor is armed, while a check inside it must have been green
 * here once before it may page.
 */
export interface AlertGateInput {
  previous: AlertGateState | null;
  previousConclusion: string | null;
  failing: readonly string[];
  checks: readonly string[];
}

export interface AlertGateDecision {
  shouldPage: boolean;
  recovered: boolean;
  observeOnly: boolean;
  failing: string[];
  pageable: string[];
  reason: string;
  next: AlertGateState;
}

const INITIAL_STATE: AlertGateState = { green: false, paging: false, failing: [], cleared: [] };

const unique = (names: readonly string[]): string[] => [...new Set(names)].sort();

const sameSet = (left: readonly string[], right: readonly string[]): boolean =>
  unique(left).join(',') === unique(right).join(',');

const list = (names: readonly string[]): string => (names.length === 0 ? 'nothing' : unique(names).join(','));

export const decideAlert = (input: AlertGateInput): AlertGateDecision => {
  const previous = input.previous ?? INITIAL_STATE;
  const failing = unique(input.failing);
  const measured = unique(input.checks);
  const passing = measured.filter((name) => !failing.includes(name));
  const cleared = unique([...previous.cleared, ...passing]);
  const green = failing.length === 0;
  const pageable = failing.filter(
    (name) => previous.cleared.includes(name) || !measured.includes(name),
  );

  const decide = (): Pick<AlertGateDecision, 'shouldPage' | 'recovered' | 'observeOnly' | 'reason'> => {
    if (!previous.green) {
      return {
        shouldPage: false,
        recovered: false,
        observeOnly: true,
        reason: green
          ? 'first green run on this environment; the monitor may page from now on'
          : `observe-only until the first green run on this environment: ${list(failing)}`,
      };
    }
    if (green) {
      return {
        shouldPage: false,
        recovered: previous.paging,
        observeOnly: false,
        reason: previous.paging ? 'green again after a page' : 'green',
      };
    }
    if (pageable.length === 0) {
      return {
        shouldPage: false,
        recovered: false,
        observeOnly: true,
        reason: `only checks that have never been green on this environment are failing: ${list(failing)}`,
      };
    }
    if (previous.failing.length === 0 && input.previousConclusion !== 'failure') {
      return {
        shouldPage: true,
        recovered: false,
        observeOnly: false,
        reason: `the previous completed run was ${input.previousConclusion ?? 'never run'} and this one fails: ${list(pageable)}`,
      };
    }
    if (sameSet(pageable, previous.failing)) {
      return {
        shouldPage: false,
        recovered: false,
        observeOnly: false,
        reason: `the previous run already paged for ${list(pageable)}`,
      };
    }
    return {
      shouldPage: true,
      recovered: false,
      observeOnly: false,
      reason: `the failing set changed from ${list(previous.failing)} to ${list(pageable)}`,
    };
  };

  const decision = decide();

  return {
    ...decision,
    failing,
    pageable,
    next: {
      green: previous.green || green,
      paging: green ? false : decision.shouldPage || previous.paging,
      failing: green ? [] : pageable,
      cleared,
    },
  };
};

const names = (value: string | undefined): string[] =>
  (value ?? '').split(',').map((name) => name.trim()).filter((name) => name.length > 0);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [];

export const parseState = (source: string): AlertGateState | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  return {
    green: parsed['green'] === true,
    paging: parsed['paging'] === true,
    failing: stringArray(parsed['failing']),
    cleared: stringArray(parsed['cleared']),
  };
};

const readState = (path: string | undefined): AlertGateState | null => {
  if (path === undefined || path === '') return null;
  try {
    return parseState(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};

const summary = (monitor: string, decision: AlertGateDecision): string => [
  `### Alert gate — ${monitor}`,
  '',
  `- failing: \`${list(decision.failing)}\``,
  `- pageable: \`${list(decision.pageable)}\``,
  `- paging: \`${String(decision.shouldPage)}\``,
  `- observe-only: \`${String(decision.observeOnly)}\``,
  `- reason: ${decision.reason}`,
  '',
].join('\n');

const run = (env: NodeJS.ProcessEnv): void => {
  const decision = decideAlert({
    previous: readState(env['ALERT_GATE_STATE_FILE']),
    previousConclusion: env['ALERT_GATE_PREVIOUS_CONCLUSION']?.trim() || null,
    failing: names(env['ALERT_GATE_FAILING']),
    checks: names(env['ALERT_GATE_CHECKS']),
  });
  const monitor = env['ALERT_GATE_MONITOR'] ?? 'monitor';

  const outputPath = env['GITHUB_OUTPUT'];
  if (outputPath !== undefined && outputPath !== '') {
    appendFileSync(outputPath, [
      `should_page=${String(decision.shouldPage)}`,
      `recovered=${String(decision.recovered)}`,
      `observe_only=${String(decision.observeOnly)}`,
      `pageable=${decision.pageable.join(',')}`,
      `reason=${decision.reason}`,
      '',
    ].join('\n'));
  }

  const nextStatePath = env['ALERT_GATE_NEXT_STATE_FILE'];
  if (nextStatePath !== undefined && nextStatePath !== '') {
    writeFileSync(nextStatePath, `${JSON.stringify(decision.next, null, 2)}\n`);
  }

  const summaryPath = env['GITHUB_STEP_SUMMARY'];
  if (summaryPath !== undefined && summaryPath !== '') {
    appendFileSync(summaryPath, summary(monitor, decision));
  }

  process.stdout.write(`::notice::alert gate (${monitor}): ${decision.reason}\n`);
};

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) run(process.env);
