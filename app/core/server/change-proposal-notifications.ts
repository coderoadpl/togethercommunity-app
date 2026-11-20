import type { Notification } from '#core/domain/index.js';

import { serializeErrorChain } from './log-safety.js';
import type { ChangeProposalOwnerNotifier, Clock, IdGenerator, RealtimeBusPort } from './ports.js';

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
}

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

const raiseForOwners = async (deps: ChangeProposalNotifyDeps, change: ProposedChange): Promise<void> => {
  const raised = await deps.changeProposalOwnerNotifier.raiseForOwners(change.tenantId, ownerNotification(deps, change, deps.clock.nowIso()));
  if (raised.kind === 'busy') {
    deps.logger.error(`[change-proposal] owner notification timed out tenant=${change.tenantId}; the proposal is stored`);
    return;
  }
  for (const notification of raised.value) {
    deps.realtimeBus.publish({
      kind: 'notification',
      tenantId: notification.tenantId,
      recipientUserId: notification.recipientUserId,
      notificationId: notification.id,
      notificationKind: notification.kind,
      createdAt: notification.createdAt,
    });
  }
};

/** Runs after the proposal committed and never fails it: the bell is a pointer, the proposal list is the record. */
export const notifyOwnersOfProposal = async (deps: ChangeProposalNotifyDeps, change: ProposedChange): Promise<void> => {
  try {
    await raiseForOwners(deps, change);
  } catch (cause) {
    deps.logger.error(`[change-proposal] owner notification failed tenant=${change.tenantId}: ${serializeErrorChain(cause)}`);
  }
};
