import type { Notification } from '#core/domain/index.js';

import { serializeErrorChain } from './log-safety.js';
import type {
  ChangeProposalOwnerNotice,
  ChangeProposalOwnerNotifier,
  ChangeProposalWrite,
  Clock,
  IdGenerator,
  RealtimeBusPort,
} from './ports.js';

export interface ChangeProposalNotifyDeps {
  changeProposalOwnerNotifier: ChangeProposalOwnerNotifier;
  realtimeBus: Pick<RealtimeBusPort, 'publish'>;
  logger: { error(message: string): void };
  ids: IdGenerator;
  clock: Clock;
}

interface ProposedChange {
  tenantId: string;
  keyId: string;
  keyName: string;
  group: { id: string; title: string } | null;
  notice: ChangeProposalOwnerNotice;
}

type RaiseOutcome =
  | { kind: 'settled'; raised: ChangeProposalWrite<Notification[]> }
  | { kind: 'failed'; cause: unknown }
  | { kind: 'late' };

const changeProposalNotificationSourceKey = (keyId: string): string => `change-proposal:${keyId}`;

const ownerNotification = (deps: ChangeProposalNotifyDeps, change: ProposedChange, createdAt: string) =>
  (recipientUserId: string): Notification => ({
    id: deps.ids.nextId(),
    tenantId: change.tenantId,
    recipientUserId,
    kind: 'change-proposal',
    payload: {
      rootPostId: null,
      postId: null,
      contextKind: 'tenant',
      contextId: change.group?.id ?? null,
      courseId: null,
      eventId: null,
      domain: null,
      lessonName: '',
      authorDisplay: change.keyName,
      authorAvatarUrl: null,
      snippet: change.group?.title ?? '',
    },
    sourceKey: changeProposalNotificationSourceKey(change.keyId),
    readAt: null,
    createdAt,
  });

const settled = (raised: ChangeProposalWrite<Notification[]>): RaiseOutcome => ({ kind: 'settled', raised });

const failed = (cause: unknown): RaiseOutcome => ({ kind: 'failed', cause });

const logFailure = (deps: ChangeProposalNotifyDeps, tenantId: string, cause: unknown): void => {
  deps.logger.error(`[change-proposal] owner notification failed tenant=${tenantId}: ${serializeErrorChain(cause)}`);
};

const raiseWithinDeadline = async (deps: ChangeProposalNotifyDeps, change: ProposedChange, createdAt: string): Promise<RaiseOutcome> => {
  const raising = deps.changeProposalOwnerNotifier
    .raiseForOwners(change.tenantId, ownerNotification(deps, change, createdAt), change.notice)
    .then(settled, failed);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<RaiseOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'late' }), deps.changeProposalOwnerNotifier.deadlineMs);
  });
  try {
    const outcome = await Promise.race([raising, deadline]);
    if (outcome.kind === 'late') {
      void raising.then((late) => {
        if (late.kind === 'failed') logFailure(deps, change.tenantId, late.cause);
      });
    }
    return outcome;
  } finally {
    clearTimeout(timer);
  }
};

const notifyOwners = async (deps: ChangeProposalNotifyDeps, change: ProposedChange): Promise<void> => {
  const createdAt = deps.clock.nowIso();
  const outcome = await raiseWithinDeadline(deps, change, createdAt);
  if (outcome.kind === 'failed') {
    logFailure(deps, change.tenantId, outcome.cause);
    return;
  }
  if (outcome.kind === 'late') {
    deps.logger.error(`[change-proposal] owner notification passed its ${String(deps.changeProposalOwnerNotifier.deadlineMs)} ms deadline tenant=${change.tenantId}; the proposal is stored`);
    return;
  }
  if (outcome.raised.kind === 'busy') {
    deps.logger.error(`[change-proposal] owner notification timed out tenant=${change.tenantId}; the proposal is stored`);
    return;
  }
  for (const notification of outcome.raised.value) {
    deps.realtimeBus.publish({
      kind: 'notification',
      tenantId: notification.tenantId,
      recipientUserId: notification.recipientUserId,
      notificationId: notification.id,
      notificationKind: notification.kind,
      createdAt,
    });
  }
};

/** Runs after the proposal committed and never fails it: the bell is a pointer, the proposal list is the record. */
export const notifyOwnersOfProposal = async (deps: ChangeProposalNotifyDeps, change: ProposedChange): Promise<void> => {
  try {
    await notifyOwners(deps, change);
  } catch (cause) {
    logFailure(deps, change.tenantId, cause);
  }
};
