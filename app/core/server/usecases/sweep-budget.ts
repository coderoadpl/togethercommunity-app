const SWEEP_MINIMUM_DELETE_MS = 1_000;

const SWEEP_MINIMUM_LOCK_WAIT_MS = 250;

const SWEEP_MINIMUM_STATEMENT_MS = 1_000;

/** The milliseconds left of a sweep's wall-clock budget; a request outside a sweep has none. */
export type SweepBudget = () => number;

export const UNBOUNDED: SweepBudget = () => Number.POSITIVE_INFINITY;

export interface StagingSweepOutcome {
  tenants: number;
  removed: number;
  failed: number;
}

const bounded = (budget: SweepBudget): boolean => Number.isFinite(budget());

/**
 * The lock wait of a sweep step that still leaves each of its `deletes` storage deletes the minimum, or null when what
 * is left cannot cover them; undefined outside a sweep, so the repository keeps its own bound.
 */
export const sweepLockWait = (budget: SweepBudget, deletes: number): number | null | undefined => {
  if (!bounded(budget)) return undefined;
  const wait = Math.floor(budget() - deletes * SWEEP_MINIMUM_DELETE_MS);
  return wait < SWEEP_MINIMUM_LOCK_WAIT_MS ? null : wait;
};

/**
 * The part of what is left that one of `stagesLeft` stages may spend; what it leaves unspent stays for the stages after
 * it, so a stage whose requests keep hanging cannot take the time of the others.
 */
export const sweepStageBudget = (budget: SweepBudget, stagesLeft: number): SweepBudget => {
  if (!bounded(budget) || stagesLeft < 1) return budget;
  const reserved = budget() - budget() / stagesLeft;
  return () => budget() - reserved;
};

/**
 * The bound of one database statement of a sweep, lock waits included: what is left, but at least a second, so the
 * bookkeeping of a step that used up the budget still runs within the margin the caller keeps after it; undefined outside
 * a sweep.
 */
export const sweepStatementBound = (budget: SweepBudget): number | undefined =>
  bounded(budget) ? Math.max(SWEEP_MINIMUM_STATEMENT_MS, Math.floor(budget())) : undefined;

export const sweepDeleteDeadline = (budget: SweepBudget, deleteMs: number, deletesAfter: number): number =>
  Math.max(1, Math.min(deleteMs, Math.floor(budget() - deletesAfter * SWEEP_MINIMUM_DELETE_MS)));
