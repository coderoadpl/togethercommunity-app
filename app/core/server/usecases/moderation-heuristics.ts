import {
  postReportEventSchema,
  postReportSchema,
  type HeuristicSignal,
  type Post,
} from '#core/domain/index.js';

import type { Clock, IdGenerator, PostReportRepository } from '../ports.js';

interface HeuristicModerationDeps {
  reports: PostReportRepository;
  ids: IdGenerator;
  clock: Clock;
}

export const openHeuristicReport = async (
  tenantId: string,
  post: Post,
  signals: HeuristicSignal[],
  deps: HeuristicModerationDeps,
): Promise<void> => {
  const now = deps.clock.nowIso();
  const report = postReportSchema.parse({
    id: deps.ids.nextId(),
    tenantId,
    postId: post.id,
    reporterUserId: null,
    reporterDisplay: null,
    source: 'heuristic',
    reason: 'spam',
    note: null,
    signals,
    status: 'open',
    createdAt: now,
    resolvedAt: null,
    resolvedByUserId: null,
  });
  const event = postReportEventSchema.parse({
    id: deps.ids.nextId(),
    tenantId,
    reportId: report.id,
    postId: post.id,
    type: 'opened',
    occurredAt: now,
  });
  await deps.reports.open(tenantId, report, event);
};
