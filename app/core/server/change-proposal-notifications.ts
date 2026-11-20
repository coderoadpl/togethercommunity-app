import { serializeErrorChain } from './log-safety.js';
import type { Clock, IdGenerator, RealtimeBusPort, TenantAccessReader, UnreadNotificationRaiser } from './ports.js';

export interface ChangeProposalNotifyDeps {
  unreadNotifications: UnreadNotificationRaiser;
  tenantAccess: Pick<TenantAccessReader, 'listStaffForTenant'>;
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

const raiseForOwners = async (deps: ChangeProposalNotifyDeps, change: ProposedChange): Promise<void> => {
  const owners = (await deps.tenantAccess.listStaffForTenant(change.tenantId)).filter((staff) => staff.staffRole === 'owner');
  const createdAt = deps.clock.nowIso();
  for (const owner of owners) {
    const raised = await deps.unreadNotifications.raiseUnread(change.tenantId, {
      id: deps.ids.nextId(),
      tenantId: change.tenantId,
      recipientUserId: owner.userId,
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
    if (raised === null) continue;
    deps.realtimeBus.publish({
      kind: 'notification',
      tenantId: raised.tenantId,
      recipientUserId: raised.recipientUserId,
      notificationId: raised.id,
      notificationKind: raised.kind,
      createdAt: raised.createdAt,
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
