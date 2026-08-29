import type {
  AppError,
  Course,
  CourseLesson,
  LessonAttachment,
  CourseModule,
  DmConversation,
  DmConversationState,
  DmMessage,
  EntityHistoryEntry,
  EntityKind,
  EmailBranding,
  EmailMessage,
  EmailLayout,
  EmailEvent,
  EmailEventMailKind,
  EmailIntegrationTransport,
  EmailReputationCounts,
  EmailSendListQuery,
  EmailSendProjection,
  TransactionalEmailTransport,
  EmailOutboxPayload,
  Member,
  MemberBanEvent,
  MemberEvent,
  MemberGrant,
  MemberCourseProgress,
  MemberSubscription,
  MemberErasureRequest,
  MemberErasureRequestEvent,
  MemberErasureRequestStatus,
  MemberErasureRequestWithMember,
  MemberWithProductIds,
  Membership,
  Order,
  OrderListItem,
  PaidWithoutGrantRow,
  OrderStatus,
  PriceKind,
  Product,
  ProductDownloadAsset,
  ProductGrant,
  ProductPrice,
  ProcessedPaymentEvent,
  Result,
  StaffRole,
  StreamVideo,
  Notification,
  Post,
  PostContextKind,
  PostReport,
  PostReportEvent,
  PostReportStatus,
  ProviderDiagnostic,
  ReactionEmoji,
  ReactionSummary,
  Space,
  SpaceEvent,
  SpaceEventRsvp,
  SpaceEventRsvpStatus,
  SpaceStats,
  StorageConfiguration,
  Tenant,
  TenantApiKey,
  TenantDomain,
  TenantSecret,
  TenantSecretKey,
  TenantSettings,
  TermsConsent,
  AutomationIdempotencyKey,
  Campaign,
  CampaignEngagementStats,
  CampaignSend,
  CheckoutConsentCapture,
  Coupon,
  CouponOption,
  CouponCheckoutSession,
  CouponEvent,
  CouponRedemptionEvent,
  CouponRedemption,
  CouponStatsCursor,
  CouponStatsItem,
  ConsentDefinition,
  ConsentDefinitionVersion,
  ConsentConfirmationToken,
  MarketingConsent,
  Suppression,
  SchedulerRun,
  SchedulerRunListQuery,
  SchedulerRunTenant,
  SchedulerRunTenantItem,
  SchedulerRunTenantSummary,
  SchedulerRunTotals,
  TenantSesSettings,
  TenantDocument,
  TenantDocumentVersion,
  UnsubscribeToken,
  BillingData,
  Invoice,
  InvoiceEvent,
  InvoiceVatTreatment,
  ImportAuditEvent,
  ImportAuditResourceType,
  FiscalArtifact,
  KsefEnvironment,
  KsefStatus,
} from '#core/domain/index.js';

/**
 * Ports: interfaces the core depends on, implemented in `adapters/`.
 * The core never knows which database, auth provider or platform sits behind them.
 */

/**
 * A previous-state snapshot to write into `entity_versions` in the SAME
 * transaction as the mutation that supersedes it. Passed to write-through
 * repository methods so backward compatibility is captured atomically.
 */
export interface EntityVersionRecord {
  id: string;
  entityKind: EntityKind;
  entityId: string;
  schemaVersion: number;
  payload: unknown;
  createdAt: string;
  createdBy: string | null;
}

export interface EntityVersionRepository {
  list(
    tenantId: string,
    query: { entityKind: EntityKind; entityId: string; limit: number },
  ): Promise<EntityHistoryEntry[]>;
  findById(tenantId: string, id: string): Promise<EntityVersionRecord | null>;
}

export interface UserDisplayReader {
  findDisplayNames(tenantId: string, userIds: string[]): Promise<Map<string, string>>;
}

export interface AvatarSourceReader {
  /**
   * Avatar sources for identities that belong to the tenant: the tenant-scoped
   * member e-mail when a member row exists, the account e-mail otherwise, plus
   * the provider picture from the auth user row.
   */
  listAvatarSources(
    tenantId: string,
    userIds: string[],
  ): Promise<Array<{ userId: string; email: string; image: string | null }>>;
}

export interface ProductRepository {
  listByTenant(tenantId: string): Promise<Product[]>;
  listPublishedByTenant(tenantId: string): Promise<Product[]>;
  findById(tenantId: string, id: string): Promise<Product | null>;
  create(tenantId: string, product: Product): Promise<'created' | 'slug_taken'>;
  updateAccessItems(
    tenantId: string,
    id: string,
    accessItems: Product['accessItems'],
    version?: EntityVersionRecord,
    checkoutConsentDefinitionIds?: string[],
  ): Promise<Product | null>;
  setPublished(tenantId: string, id: string, published: boolean): Promise<void>;
  bumpContentVersion(tenantId: string): Promise<void>;
}

export interface ProductBatchReader {
  findByIds(tenantId: string, ids: string[]): Promise<Product[]>;
}

export interface ProductMetadataRepository {
  update(tenantId: string, product: Product, version: EntityVersionRecord): Promise<Product | null>;
}

export interface CourseRepository {
  list(tenantId: string): Promise<Course[]>;
  findById(tenantId: string, id: string): Promise<Course | null>;
  findByIds(tenantId: string, ids: string[]): Promise<Course[]>;
  create(tenantId: string, course: Course): Promise<void>;
  update(tenantId: string, course: Course, version?: EntityVersionRecord): Promise<Course | null>;
  delete(tenantId: string, id: string): Promise<boolean>;
}

export interface CourseModuleRepository {
  list(tenantId: string): Promise<CourseModule[]>;
  findById(tenantId: string, id: string): Promise<CourseModule | null>;
  findByIds(tenantId: string, ids: string[]): Promise<CourseModule[]>;
  create(tenantId: string, module: CourseModule): Promise<void>;
  update(tenantId: string, module: CourseModule, version?: EntityVersionRecord): Promise<CourseModule | null>;
  delete(tenantId: string, id: string): Promise<boolean>;
}

export interface CourseLessonRepository {
  list(tenantId: string): Promise<CourseLesson[]>;
  listPreviews(tenantId: string): Promise<CourseLessonPreview[]>;
  findById(tenantId: string, id: string): Promise<CourseLesson | null>;
  findByIds(tenantId: string, ids: string[]): Promise<CourseLesson[]>;
  create(tenantId: string, lesson: CourseLesson): Promise<void>;
  update(tenantId: string, lesson: CourseLesson, version?: EntityVersionRecord): Promise<CourseLesson | null>;
  delete(tenantId: string, id: string): Promise<boolean>;
}

export interface CourseLessonPreview {
  id: string;
  name: string;
  courseId: string;
}

export interface LessonAttachmentRepository {
  create(tenantId: string, attachment: LessonAttachment): Promise<void>;
  findById(tenantId: string, attachmentId: string): Promise<LessonAttachment | null>;
  listByLesson(tenantId: string, lessonId: string): Promise<LessonAttachment[]>;
  listReadyByLesson(tenantId: string, lessonId: string): Promise<LessonAttachment[]>;
  markReady(tenantId: string, attachmentId: string, sizeBytes: number): Promise<LessonAttachment | null>;
  delete(tenantId: string, attachmentId: string): Promise<boolean>;
}

export interface ProductDownloadAssetRepository {
  create(tenantId: string, asset: ProductDownloadAsset): Promise<void>;
  findById(tenantId: string, assetId: string): Promise<ProductDownloadAsset | null>;
  listByProduct(tenantId: string, productId: string): Promise<ProductDownloadAsset[]>;
  listReadyByProduct(tenantId: string, productId: string): Promise<ProductDownloadAsset[]>;
  markReady(tenantId: string, assetId: string, sizeBytes: number): Promise<ProductDownloadAsset | null>;
  delete(tenantId: string, assetId: string): Promise<boolean>;
}

export interface PostSearchRow {
  post: Post;
  lessonId: string;
  snippet: string;
}

export interface PostRepository {
  createPost(tenantId: string, post: Post): Promise<Post>;
  findById(tenantId: string, id: string): Promise<Post | null>;
  findByIds(tenantId: string, ids: string[]): Promise<Post[]>;
  countByAuthorSince(
    tenantId: string,
    query: { authorUserId: string; since: string },
  ): Promise<number>;
  listRecentBodiesByAuthor(
    tenantId: string,
    query: { authorUserId: string; since: string; limit: number },
  ): Promise<string[]>;
  listByAuthor(tenantId: string, authorUserId: string): Promise<Post[]>;
  listThreadsForContext(
    tenantId: string,
    query: {
      contextKind: PostContextKind;
      contextId: string;
      cursor?: string;
      limit: number;
      /** 'asc' (lesson discussions, default) or 'desc' (space feeds, newest first). */
      order?: 'asc' | 'desc';
    },
  ): Promise<{ threads: Array<{ post: Post; replyCount: number }>; nextCursor: string | null }>;
  /** Newest-first root threads across several space contexts, for the aggregated home feed. */
  listThreadsForSpaces(
    tenantId: string,
    query: { spaceIds: string[]; cursor?: string; limit: number },
  ): Promise<{ threads: Array<{ post: Post; replyCount: number }>; nextCursor: string | null }>;
  listReplies(tenantId: string, rootPostId: string): Promise<Post[]>;
  updateBody(tenantId: string, input: { id: string; body: string; editedAt: string }): Promise<Post | null>;
  /** Clears pinnedAt when marking a post deleted. */
  softDelete(tenantId: string, input: { id: string; deletedAt: string }): Promise<Post | null>;
  setPinned(tenantId: string, input: { id: string; pinnedAt: string | null }): Promise<Post | null>;
  listPinnedForContext(
    tenantId: string,
    query: { contextKind: PostContextKind; contextId: string; limit: number },
  ): Promise<Post[]>;
  countPinnedForContext(
    tenantId: string,
    query: { contextKind: PostContextKind; contextId: string },
  ): Promise<number>;
  /** Newest non-deleted root post per space, keyed by space id; spaces without one are absent. */
  latestRootPostAt(tenantId: string, spaceIds: string[]): Promise<Map<string, string>>;
  search(
    tenantId: string,
    query: { query: string; lessonIds: string[]; spaceIds: string[]; limit: number },
  ): Promise<PostSearchRow[]>;
}

export interface PostReportRepository {
  open(tenantId: string, report: PostReport, event: PostReportEvent): Promise<PostReport | null>;
  findById(tenantId: string, id: string): Promise<PostReport | null>;
  listByStatus(
    tenantId: string,
    query: { status: PostReportStatus; cursor?: string; limit: number },
  ): Promise<{ reports: PostReport[]; nextCursor: string | null }>;
  countOpenByPost(tenantId: string, postIds: string[]): Promise<Map<string, number>>;
  countOpen(tenantId: string): Promise<number>;
  resolve(
    tenantId: string,
    input: {
      id: string;
      status: 'dismissed' | 'resolved';
      resolvedAt: string;
      resolvedByUserId: string;
    },
    event: PostReportEvent,
  ): Promise<PostReport | null>;
  resolveAllForPost(
    tenantId: string,
    input: { postId: string; resolvedAt: string; resolvedByUserId: string },
    event: (reportId: string) => PostReportEvent,
  ): Promise<number>;
}

export interface SpaceRepository {
  list(tenantId: string, options?: { includeArchived?: boolean }): Promise<Space[]>;
  findById(tenantId: string, id: string): Promise<Space | null>;
  findBySlug(tenantId: string, slug: string): Promise<Space | null>;
  create(tenantId: string, space: Space): Promise<void>;
  update(tenantId: string, space: Space): Promise<Space | null>;
  setArchived(tenantId: string, input: { id: string; archivedAt: string | null }): Promise<Space | null>;
  delete(tenantId: string, id: string): Promise<boolean>;
  stats(tenantId: string, spaceIds: string[]): Promise<Map<string, SpaceStats>>;
}

export interface PostReactionRepository {
  /** Idempotent: returns false when the (post, user, emoji) reaction already exists. */
  add(
    tenantId: string,
    input: { postId: string; userId: string; emoji: ReactionEmoji; createdAt: string },
  ): Promise<boolean>;
  /** Idempotent: returns false when there was nothing to remove. */
  remove(tenantId: string, input: { postId: string; userId: string; emoji: ReactionEmoji }): Promise<boolean>;
  summarize(
    tenantId: string,
    input: { postIds: string[]; viewerUserId: string },
  ): Promise<Map<string, ReactionSummary[]>>;
}

export interface SpaceSubscription {
  tenantId: string;
  userId: string;
  spaceId: string;
  createdAt: string;
}

export interface SpaceSubscriptionRepository {
  follow(tenantId: string, input: { userId: string; spaceId: string; createdAt: string }): Promise<void>;
  unfollow(tenantId: string, input: { userId: string; spaceId: string }): Promise<boolean>;
  listFollowersForSpace(tenantId: string, spaceId: string): Promise<SpaceSubscription[]>;
  listForUser(tenantId: string, input: { userId: string; spaceIds: string[] }): Promise<SpaceSubscription[]>;
}

export interface SpaceSeenRepository {
  markSeen(tenantId: string, input: { userId: string; spaceId: string; seenAt: string }): Promise<void>;
  listForUser(
    tenantId: string,
    input: { userId: string; spaceIds: string[] },
  ): Promise<Array<{ spaceId: string; seenAt: string }>>;
}

export interface ThreadSubscription {
  tenantId: string;
  userId: string;
  rootPostId: string;
  createdAt: string;
  mutedAt: string | null;
}

export interface ThreadSubscriptionRepository {
  upsert(tenantId: string, input: { userId: string; rootPostId: string; createdAt: string }): Promise<ThreadSubscription>;
  mute(tenantId: string, input: { userId: string; rootPostId: string; mutedAt: string }): Promise<ThreadSubscription | null>;
  listSubscribersForRoot(tenantId: string, rootPostId: string): Promise<ThreadSubscription[]>;
  listForUser(tenantId: string, input: { userId: string; rootPostIds: string[] }): Promise<ThreadSubscription[]>;
}

export interface SpaceEventRepository {
  findById(tenantId: string, id: string): Promise<SpaceEvent | null>;
  insert(tenantId: string, event: SpaceEvent): Promise<SpaceEvent>;
  update(tenantId: string, event: SpaceEvent): Promise<SpaceEvent | null>;
  softDelete(tenantId: string, input: { id: string; deletedAt: string }): Promise<SpaceEvent | null>;
  /** 'upcoming' returns events ending at or after `now` ascending, 'past' the rest descending. */
  listForSpace(
    tenantId: string,
    query: { spaceId: string; scope: 'upcoming' | 'past'; now: string; cursor?: string; limit: number },
  ): Promise<{ events: SpaceEvent[]; nextCursor: string | null }>;
  listUpcomingForSpaces(
    tenantId: string,
    query: { spaceIds: string[]; now: string; limit: number },
  ): Promise<SpaceEvent[]>;
}

export interface SpaceEventRsvpRepository {
  upsert(
    tenantId: string,
    input: { eventId: string; userId: string; status: SpaceEventRsvpStatus; updatedAt: string },
  ): Promise<SpaceEventRsvp>;
  countsForEvents(
    tenantId: string,
    eventIds: string[],
  ): Promise<Map<string, { going: number; notGoing: number }>>;
  listForViewer(
    tenantId: string,
    input: { userId: string; eventIds: string[] },
  ): Promise<SpaceEventRsvp[]>;
}

export interface DmConversationRepository {
  findById(tenantId: string, id: string): Promise<DmConversation | null>;
  findByParticipants(
    tenantId: string,
    pair: { low: string; high: string },
  ): Promise<DmConversation | null>;
  insert(tenantId: string, conversation: DmConversation): Promise<DmConversation>;
  listForParticipant(
    tenantId: string,
    query: { userId: string; cursor?: string; limit: number },
  ): Promise<{ conversations: DmConversation[]; nextCursor: string | null }>;
  countCreatedBySince(
    tenantId: string,
    query: { createdByUserId: string; since: string },
  ): Promise<number>;
  countUnreadForParticipant(tenantId: string, userId: string): Promise<number>;
  applyLastMessage(
    tenantId: string,
    input: {
      conversationId: string;
      lastMessageId: string;
      lastMessageAt: string;
      lastMessageSnippet: string;
      lastMessageSenderUserId: string;
    },
  ): Promise<DmConversation | null>;
}

export interface DmMessageRepository {
  insert(tenantId: string, message: DmMessage): Promise<DmMessage>;
  listForConversation(
    tenantId: string,
    query: { conversationId: string; cursor?: string; limit: number },
  ): Promise<{ messages: DmMessage[]; nextCursor: string | null }>;
  countRecentBySender(tenantId: string, senderUserId: string, sinceIso: string): Promise<number>;
}

export interface DmConversationStateRepository {
  findForViewer(
    tenantId: string,
    input: { userId: string; conversationIds: string[] },
  ): Promise<DmConversationState[]>;
  markRead(
    tenantId: string,
    input: { conversationId: string; userId: string; lastReadAt: string },
  ): Promise<DmConversationState>;
}

export interface NotificationRepository {
  insert(tenantId: string, notification: Notification): Promise<Notification>;
  listForRecipient(
    tenantId: string,
    query: { recipientUserId: string; cursor?: string; limit: number },
  ): Promise<{ notifications: Notification[]; nextCursor: string | null }>;
  markRead(tenantId: string, input: { id: string; recipientUserId: string; readAt: string }): Promise<Notification | null>;
  markAllRead(tenantId: string, input: { recipientUserId: string; readAt: string }): Promise<number>;
  unreadCount(tenantId: string, recipientUserId: string): Promise<number>;
  /** Collapse guard: one bell item and one e-mail per conversation burst. */
  hasUnreadDmNotification(
    tenantId: string,
    recipientUserId: string,
    conversationId: string,
  ): Promise<boolean>;
  markDmConversationRead(
    tenantId: string,
    input: { recipientUserId: string; conversationId: string; readAt: string },
  ): Promise<number>;
}

export interface NotificationDeliveryContext {
  recipientEmail: string | null;
  tenantName: string;
  /** Lesson name for lesson contexts, space name for space contexts. */
  contextName: string;
  contextUrl: string;
  language: string;
}

export interface NotificationChannelPort {
  deliver(notification: Notification, context: NotificationDeliveryContext): Promise<Result<void, AppError>>;
}

/**
 * Cross-instance transports cap the payload, so events carry identifiers only
 * and the client refetches the record it needs.
 *
 * @public
 */
export interface RealtimeNotificationEvent {
  kind: 'notification';
  tenantId: string;
  recipientUserId: string;
  notificationId: string;
  createdAt: string;
}

/**
 * Direct messages collapse into a single bell notification per conversation, so
 * an open conversation needs its own lightweight live signal.
 */
/** @public */
export interface RealtimeDmEvent {
  kind: 'dm';
  tenantId: string;
  recipientUserId: string;
  conversationId: string;
  createdAt: string;
}

export type RealtimeEvent = RealtimeNotificationEvent | RealtimeDmEvent;

/** @public */
export interface RealtimeScope {
  tenantId: string;
  recipientUserId: string;
}

export interface RealtimeBusPort {
  publish(event: RealtimeEvent): void;
  subscribe(scope: RealtimeScope, listener: (event: RealtimeEvent) => void): () => void;
}

export interface DiscussionLinkPort {
  lessonDiscussionUrl(input: {
    tenantSlug: string | null;
    courseId: string | null;
    lessonId: string;
  }): string;
  spaceUrl(input: { tenantSlug: string | null; spaceId: string; rootPostId?: string }): string;
  conversationUrl(input: { tenantSlug: string | null; conversationId: string }): string;
  eventUrl(input: { tenantSlug: string | null; spaceId: string; eventId: string }): string;
}

export interface MemberCourseProgressRepository {
  findByMemberAndCourse(
    tenantId: string,
    input: { memberId: string; courseId: string },
  ): Promise<MemberCourseProgress | null>;
  listByMember(tenantId: string, memberId: string): Promise<MemberCourseProgress[]>;
  findOrCreate(
    tenantId: string,
    input: { id: string; memberId: string; courseId: string; now: string },
  ): Promise<MemberCourseProgress>;
  update(tenantId: string, progress: MemberCourseProgress): Promise<MemberCourseProgress | null>;
  countReferencingLesson(tenantId: string, lessonId: string): Promise<number>;
}

export interface MemberRepository {
  findById(tenantId: string, memberId: string): Promise<Member | null>;
  findByEmail(tenantId: string, email: string): Promise<Member | null>;
  listWithProductIds(tenantId: string, now: string): Promise<MemberWithProductIds[]>;
  create(tenantId: string, member: Member): Promise<void>;
  updateEmail(tenantId: string, memberId: string, email: string): Promise<Member | null>;
  updateDisplayName(
    tenantId: string,
    memberId: string,
    displayName: string | null,
  ): Promise<Member | null>;
  updateDmOptOut(
    tenantId: string,
    memberId: string,
    dmOptOutAt: string | null,
  ): Promise<Member | null>;
  setBanned(
    tenantId: string,
    input: {
      memberId: string;
      bannedAt: string | null;
      reason: string | null;
      actorUserId: string;
    },
    event: MemberBanEvent,
  ): Promise<Member | null>;
}

export interface MemberEventRepository {
  append(
    tenantId: string,
    event: Omit<MemberEvent, 'tenantId'>,
  ): Promise<void>;
  listForMember(tenantId: string, memberId: string): Promise<MemberEvent[]>;
}

export interface MemberPseudonymization {
  memberId: string;
  deletedAt: string;
  tombstoneEmail: string;
  severedUserId: string;
  postAuthorDisplay: string;
}

/** @public */
export interface MemberPseudonymizationResult {
  alreadyDeleted: boolean;
  authUserErased: boolean;
  erasureRequestId: string | null;
}

/**
 * Member removal is pseudonymization, never row deletion: order/subscription
 * history must survive for accounting retention while every personal datum on
 * the member (and the orphaned auth user) is erased in one atomic operation.
 */
export interface MemberErasurePort {
  pseudonymize(
    tenantId: string,
    input: MemberPseudonymization,
  ): Promise<MemberPseudonymizationResult | null>;
}

export interface MemberErasureRequestRepository {
  /** Projection row and requested event commit together; the partial unique index rejects a second open request. */
  create(
    tenantId: string,
    request: MemberErasureRequest,
    event: MemberErasureRequestEvent,
  ): Promise<'created' | 'already-open'>;
  findOpenForMember(
    tenantId: string,
    memberId: string,
  ): Promise<MemberErasureRequest | null>;
  findLatestForMember(
    tenantId: string,
    memberId: string,
  ): Promise<MemberErasureRequest | null>;
  list(
    tenantId: string,
    query: { status?: MemberErasureRequestStatus },
  ): Promise<MemberErasureRequestWithMember[]>;
  /** Terminal transition and its event commit together; returns null when the request is no longer open. */
  resolve(
    tenantId: string,
    input: {
      id: string;
      status: Exclude<MemberErasureRequestStatus, 'open'>;
      resolvedAt: string;
      resolvedByUserId: string | null;
      resolutionNote: string | null;
    },
    event: MemberErasureRequestEvent,
  ): Promise<MemberErasureRequest | null>;
}

export interface ProductGrantRepository {
  findById(tenantId: string, grantId: string): Promise<ProductGrant | null>;
  findGrant(tenantId: string, memberId: string, productId: string): Promise<ProductGrant | null>;
  createGrant(tenantId: string, grant: ProductGrant): Promise<boolean>;
  setGrantWindow(
    tenantId: string,
    grantId: string,
    window: { startsAt: string; expiresAt: string | null; occurredAt: string },
  ): Promise<ProductGrant | null>;
  revokeGrant(tenantId: string, grantId: string, expiresAt: string): Promise<ProductGrant | null>;
  listForMemberWithProductNames(tenantId: string, memberId: string, now: string): Promise<MemberGrant[]>;
  listActiveForMember(tenantId: string, memberId: string, now: string): Promise<ProductGrant[]>;
  listGrantedProducts(tenantId: string, memberId: string): Promise<Product[]>;
}

export interface TenantApiKeyRepository {
  listByTenant(tenantId: string): Promise<TenantApiKey[]>;
  create(tenantId: string, apiKey: TenantApiKey): Promise<void>;
  findActiveByHash(tenantId: string, keyHash: string): Promise<TenantApiKey | null>;
  revoke(tenantId: string, id: string, revokedAt: string): Promise<TenantApiKey | null>;
}

export interface ImportAuditEventRepository {
  append(tenantId: string, event: ImportAuditEvent): Promise<void>;
  findLatestByImportKey(
    tenantId: string,
    kind: ImportAuditResourceType,
    importKey: string,
  ): Promise<ImportAuditEvent | null>;
  listByApiKey(
    tenantId: string,
    apiKeyId: string,
    query: { cursor?: string; limit: number },
  ): Promise<{ events: ImportAuditEvent[]; nextCursor: string | null }>;
}

export type ImportContentMutation =
  | { kind: 'course'; action: 'created' | 'updated' | 'unchanged'; resource: Course; event: ImportAuditEvent }
  | { kind: 'module'; action: 'created' | 'updated' | 'unchanged'; resource: CourseModule; event: ImportAuditEvent }
  | { kind: 'lesson'; action: 'created' | 'updated' | 'unchanged'; resource: CourseLesson; event: ImportAuditEvent }
  | { kind: 'product'; action: 'created' | 'updated' | 'unchanged'; resource: Product; event: ImportAuditEvent };

export interface ImportContentRepository {
  commit(
    tenantId: string,
    mutation: ImportContentMutation,
  ): Promise<'saved' | 'conflict' | 'slug_taken'>;
}

export interface ImportAuthUserState {
  id: string;
  email: string;
  credentialPassword: string | null;
  hasCredentialAccount: boolean;
}

export interface ImportMemberResource {
  id: string;
  tenantId: string;
  userId: string;
  email: string;
  displayName: string;
  legacyId: string | null;
  createdAt: string;
}

export type ImportUsersMutation =
  | {
      kind: 'member';
      action: 'created' | 'updated' | 'unchanged';
      resource: ImportMemberResource;
      authUser: {
        action: 'create' | 'keep';
        name: string;
        emailVerified: false;
      };
      event: ImportAuditEvent;
    }
  | {
      kind: 'grant';
      action: 'created' | 'updated' | 'unchanged';
      resource: ProductGrant;
      event: ImportAuditEvent;
    }
  | {
      kind: 'progress';
      action: 'created' | 'updated' | 'unchanged';
      resource: MemberCourseProgress;
      event: ImportAuditEvent;
    };

export interface ImportUsersReader {
  findAuthUserByEmail(tenantId: string, email: string): Promise<ImportAuthUserState | null>;
  findMemberById(tenantId: string, memberId: string): Promise<ImportMemberResource | null>;
  findMemberByEmail(tenantId: string, email: string): Promise<ImportMemberResource | null>;
  findGrantById(tenantId: string, grantId: string): Promise<ProductGrant | null>;
  findGrantByPair(
    tenantId: string,
    input: { memberId: string; productId: string },
  ): Promise<ProductGrant | null>;
  findProgressById(tenantId: string, progressId: string): Promise<MemberCourseProgress | null>;
  findProgressByPair(
    tenantId: string,
    input: { memberId: string; courseId: string },
  ): Promise<MemberCourseProgress | null>;
}

export interface ImportUsersRepository extends ImportUsersReader {
  commit(tenantId: string, mutation: ImportUsersMutation): Promise<'saved' | 'conflict'>;
}

export interface ApiKeyRateLimitRepository {
  claim(tenantId: string, input: {
    apiKeyId: string;
    period: 'minute' | 'hour' | 'day';
    windowStartedAt: string;
    limit: number;
    cost?: number;
  }): Promise<boolean>;
  release(tenantId: string, input: {
    apiKeyId: string;
    period: 'minute' | 'hour' | 'day';
    windowStartedAt: string;
    cost?: number;
  }): Promise<void>;
}

export interface TenantSecretRepository {
  listByTenant(tenantId: string): Promise<TenantSecret[]>;
  findByKey(tenantId: string, key: TenantSecretKey): Promise<TenantSecret | null>;
  upsert(tenantId: string, secret: TenantSecret): Promise<TenantSecret>;
  delete(tenantId: string, key: TenantSecretKey): Promise<boolean>;
}

export interface SecretCrypto {
  encrypt(plaintext: string): { ciphertext: string; iv: string; authTag: string };
  decrypt(input: { ciphertext: string; iv: string; authTag: string }): Result<string, AppError>;
}

export interface TenantSecretResolver {
  resolve(tenantId: string, key: TenantSecretKey): Promise<Result<string, AppError>>;
}

export interface PaymentWebhookEvent {
  id: string;
  type: string;
  objectId: string | null;
  createdAt?: string | null;
  checkoutSession: {
    email: string | null;
    paymentStatus?: 'paid' | 'unpaid' | 'no_payment_required' | null;
    subscriptionId: string | null;
    paymentIntentId?: string | null;
    invoiceId?: string | null;
    amountTotalCents?: number | null;
    discountTotalCents?: number | null;
    metadata: {
      tenantId: string | null;
      productId: string | null;
      priceId: string | null;
      memberEmail: string | null;
      language: string | null;
      checkoutConsentCaptureId?: string | null;
      couponCheckoutSessionId?: string | null;
    };
  } | null;
  invoice?: {
    subscriptionId: string | null;
    chargeId?: string | null;
    paymentIntentId?: string | null;
    amountCents: number | null;
    currency: string | null;
    periodEnd: string | null;
  } | null;
  adjustment?: {
    chargeId: string | null;
    paymentIntentId: string | null;
    invoiceId: string | null;
    refund?: {
      full: boolean;
      amountRefundedCents: number | null;
      amountCents: number | null;
    } | null;
  } | null;
  subscription?: {
    id: string;
    status: string | null;
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: string | null;
    endedAt: string | null;
  } | null;
}

export interface PaymentProvider {
  configureWebhook?(input: {
    tenantId: string;
    restrictedKey: string;
    webhookUrl: string;
  }): Promise<Result<{ webhookEndpointId: string; webhookSecret: string }, AppError>>;
  deleteWebhookEndpoint?(input: {
    restrictedKey: string;
    webhookEndpointId: string;
  }): Promise<Result<{ deleted: true }, AppError>>;
  createCheckoutSession(input: {
    tenantId: string;
    productId: string;
    productName: string;
    priceCents: number;
    currency: string;
    successUrl: string;
    cancelUrl: string;
    customerEmail?: string;
    language?: string;
    priceId?: string;
    recurringInterval?: 'month' | 'year';
    checkoutConsentCaptureId?: string;
    promotionCodeId?: string;
    couponCheckoutSessionId?: string;
  }): Promise<Result<{ url: string; sessionId: string }, AppError>>;
  ensureCouponPromotion?(input: {
    tenantId: string;
    couponId: string;
    code: string;
    kind: 'percent' | 'amount';
    value: number;
    currency: string;
    recurringDuration: 'first_invoice' | 'forever';
    stripeCouponId: string | null;
    stripePromotionCodeId: string | null;
  }): Promise<Result<{ stripeCouponId: string; stripePromotionCodeId: string }, AppError>>;
  expireCheckoutSession(input: {
    tenantId: string;
    sessionId: string;
  }): Promise<Result<{ expired: true }, AppError>>;
  cancelSubscription(input: {
    tenantId: string;
    providerSubscriptionId: string;
    idempotencyKey: string;
  }): Promise<Result<{ canceled: true; alreadySettled: boolean }, AppError>>;
  verifyWebhookEvent(input: {
    payloadRaw: string;
    signatureHeader: string;
    webhookSecret: string;
  }): Promise<Result<PaymentWebhookEvent, AppError>>;
  test(input: {
    tenantId: string;
    appBaseUrl: string;
  }): Promise<Result<ProviderDiagnostic, AppError>>;
}

export interface InvoicingPort {
  issueInvoice(input: {
    order: Order;
    billing: BillingData | null;
    productName: string;
    vat: InvoiceVatTreatment;
    providerInvoiceId: string | null;
    onProviderInvoiceCreateUncertain(): Promise<void>;
    onProviderInvoiceCreated(providerInvoiceId: string): Promise<void>;
    config: { invoiceApiKey: string; username: string };
  }): Promise<Result<{
    providerInvoiceId: string;
    invoiceNumber: string;
    status: 'issued' | 'delivered';
  }, AppError>>;
  getInvoiceStatus(input: {
    providerInvoiceId: string;
    config: { invoiceApiKey: string; username: string };
  }): Promise<Result<'issued' | 'delivered' | 'failed' | 'conflict', AppError>>;
  downloadInvoice(input: {
    providerInvoiceId: string;
    config: { invoiceApiKey: string; username: string };
  }): Promise<Result<{
    content: Uint8Array;
    contentType: 'application/pdf';
  }, AppError>>;
  testConnection(input: {
    config: { invoiceApiKey: string; username: string };
  }): Promise<Result<{ diagnostic: string }, AppError>>;
}

export interface InvoiceRepository {
  findById(tenantId: string, id: string): Promise<Invoice | null>;
  findByIdForMember?(tenantId: string, memberId: string, id: string): Promise<Invoice | null>;
  listForMember?(tenantId: string, memberId: string): Promise<Invoice[]>;
  findCurrentByOrder(tenantId: string, orderId: string): Promise<Invoice | null>;
  findLatestRequestedEvent(tenantId: string, invoiceId: string): Promise<InvoiceEvent | null>;
  create(tenantId: string, invoice: Invoice, event: InvoiceEvent): Promise<boolean>;
  claimRetry(tenantId: string, invoice: Invoice, event: InvoiceEvent): Promise<boolean>;
  update(tenantId: string, invoice: Invoice, event: InvoiceEvent): Promise<Invoice | null>;
  appendEvent(tenantId: string, event: InvoiceEvent): Promise<void>;
  createFrozenKsef?(
    tenantId: string,
    invoice: Invoice,
    event: InvoiceEvent,
    artifact: FiscalArtifact,
    job: KsefSubmissionJob,
  ): Promise<boolean>;
  checkpointKsef?(
    tenantId: string,
    invoice: Invoice,
    event: InvoiceEvent,
  ): Promise<Invoice | null>;
}

/** @public */
export interface KsefNumberAllocation {
  p2: string;
  sequence: number;
}

export interface KsefNumberRepository {
  allocate(
    tenantId: string,
    input: { orderId: string; invoiceType: 'VAT'; year: number; allocatedAt: string },
  ): Promise<KsefNumberAllocation>;
}

/** @public */
export interface KsefSubmissionJob {
  id: string;
  tenantId: string;
  invoiceId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  attempts: number;
  nextAttemptAt: string;
  lockedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface KsefSubmissionJobRepository {
  claimDue(now: string): Promise<KsefSubmissionJob | null>;
  reschedule(
    tenantId: string,
    jobId: string,
    input: { nextAttemptAt: string; error: string | null },
  ): Promise<void>;
  complete(tenantId: string, jobId: string): Promise<void>;
}

export interface AutoInvoiceJob {
  id: string;
  tenantId: string;
  webhookEventId: string;
  orderId: string;
  status: 'queued' | 'running' | 'completed';
  attempts: number;
  nextAttemptAt: string;
  lockedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface AutoInvoiceJobRepository {
  enqueue(tenantId: string, job: AutoInvoiceJob): Promise<boolean>;
  claimDue(now: string): Promise<AutoInvoiceJob | null>;
  reschedule(
    tenantId: string,
    jobId: string,
    input: { nextAttemptAt: string; error: string },
  ): Promise<void>;
  complete(tenantId: string, jobId: string): Promise<void>;
}

export interface KsefCredentials {
  tenantId: string;
  token: string;
  contextNip: string;
}

export interface KsefStatusResult extends KsefStatus {
  ksefNumber: string | null;
  acquisitionAt: string | null;
  invoicingAt: string | null;
  permanentStorageAt: string | null;
}

export interface KsefClientPort {
  validateCredentials(input: {
    environment: KsefEnvironment;
    credentials: KsefCredentials;
  }): Promise<Result<{ diagnostic: string }, AppError>>;
  openSession(input: {
    environment: KsefEnvironment;
    credentials: KsefCredentials;
  }): Promise<Result<{ sessionReference: string }, AppError>>;
  submitInvoice(input: {
    environment: KsefEnvironment;
    credentials: KsefCredentials;
    sessionReference: string;
    xml: string;
    invoiceHashHex: string;
  }): Promise<Result<{ invoiceReference: string }, AppError>>;
  listSessionInvoices(input: {
    environment: KsefEnvironment;
    credentials: KsefCredentials;
    sessionReference: string;
  }): Promise<Result<Array<{
    invoiceReference: string;
    invoiceHash: string;
    status: KsefStatus;
  }>, AppError>>;
  getInvoiceStatus(input: {
    environment: KsefEnvironment;
    credentials: KsefCredentials;
    sessionReference: string;
    invoiceReference: string;
  }): Promise<Result<KsefStatusResult, AppError>>;
  downloadUpo(input: {
    environment: KsefEnvironment;
    credentials: KsefCredentials;
    sessionReference: string;
    invoiceReference: string | null;
    ksefNumber: string | null;
  }): Promise<Result<string, AppError>>;
  verifyDuplicateOriginal(input: {
    environment: KsefEnvironment;
    credentials: KsefCredentials;
    originalSessionReference: string;
    originalKsefNumber: string;
    expected: {
      contextNip: string;
      invoiceType: 'VAT';
      invoiceNumber: string;
      invoiceHashHex: string;
    };
  }): Promise<Result<boolean, AppError>>;
  closeSession(input: {
    environment: KsefEnvironment;
    credentials: KsefCredentials;
    sessionReference: string;
  }): Promise<Result<void, AppError>>;
}

export interface KsefCredentialResolver {
  resolve(tenantId: string): Promise<Result<KsefCredentials, AppError>>;
}

export interface KsefSubmissionRepository {
  findById(tenantId: string, invoiceId: string): Promise<Invoice | null>;
  checkpointKsef(
    tenantId: string,
    invoice: Invoice,
    event: InvoiceEvent,
  ): Promise<Invoice | null>;
}

export interface FiscalArtifactRepository {
  findByKey(tenantId: string, key: string): Promise<FiscalArtifact | null>;
  store(tenantId: string, artifact: FiscalArtifact): Promise<boolean>;
}

export interface ContentHash {
  sha256(content: string | Uint8Array): string;
}

export interface Fa3Validator {
  validate(xml: string): Promise<Result<void, AppError>>;
}

export interface KsefInvoicePdf {
  render(input: { invoice: Invoice; xml: string }): Uint8Array;
}

export interface CouponRepository {
  findByCode(tenantId: string, normalizedCode: string): Promise<Coupon | null>;
  findById(tenantId: string, id: string): Promise<Coupon | null>;
  cacheStripeIds(
    tenantId: string,
    id: string,
    stripeIds: { stripeCouponId: string; stripePromotionCodeId: string },
  ): Promise<Coupon | null>;
}

export interface CouponManagementRepository extends CouponRepository {
  create(tenantId: string, coupon: Coupon, event: CouponEvent): Promise<Coupon | null>;
  archive(tenantId: string, id: string, event: CouponEvent): Promise<Coupon | null>;
}

export interface CouponRedemptionRepository {
  counts(
    tenantId: string,
    couponId: string,
    normalizedEmail: string,
  ): Promise<{ total: number; member: number }>;
  createOrderAndClaim(
    tenantId: string,
    input: {
      order: Order;
      redemption: CouponRedemption;
      event: CouponRedemptionEvent;
      maxRedemptions: number | null;
      maxRedemptionsPerMember: number | null;
    },
  ): Promise<boolean>;
}

export interface CouponCheckoutSessionRepository {
  create(tenantId: string, session: CouponCheckoutSession): Promise<void>;
  attachProviderSession(tenantId: string, id: string, providerSessionId: string): Promise<void>;
  findById(tenantId: string, id: string): Promise<CouponCheckoutSession | null>;
}

export interface ProductPriceHistoryRepository {
  lowestSince(
    tenantId: string,
    input: {
      productId: string;
      priceId: string | null;
      since: string;
      through: string;
      currentAmountCents: number;
    },
  ): Promise<number>;
}

export interface CouponStatsRepository {
  listOptions(tenantId: string): Promise<CouponOption[]>;
  list(
    tenantId: string,
    query: {
      partnerLabel?: string;
      couponId?: string;
      cursor?: CouponStatsCursor;
      limit: number;
      since: string;
      through: string;
    },
  ): Promise<{ items: CouponStatsItem[]; nextCursor: CouponStatsCursor | null }>;
}

export interface CheckoutConsentCaptureRepository {
  create(
    tenantId: string,
    input: { id: string; capture: CheckoutConsentCapture; createdAt: string },
  ): Promise<void>;
  findById(tenantId: string, id: string): Promise<CheckoutConsentCapture | null>;
}

/**
 * Lists videos in an external streaming library (Bunny Stream in production).
 * Credentials arrive per call so the adapter stays stateless and the use-case
 * controls which tenant secret is decrypted.
 */
export interface VideoLibraryPort {
  listVideos(input: {
    apiKey: string;
    libraryId: string;
    search: string | null;
    page: number;
    perPage: number;
  }): Promise<Result<{ videos: StreamVideo[]; totalItems: number }, AppError>>;
}

export interface BunnyTokenSigner {
  signEmbedToken(input: { securityKey: string; videoId: string; expires: number }): string;
  signHlsPlaylistUrl(input: {
    securityKey: string;
    cdnHostname: string;
    videoId: string;
    expires: number;
  }): string;
}

export interface StorageProvider {
  objectUrl(configuration: StorageConfiguration, key: string): URL;
  probe(
    input: StorageConfiguration,
    corsOrigins?: string[] | undefined,
  ): Promise<Result<ProviderDiagnostic, AppError>>;
  presignPut(input: {
    url: string;
    accessKeyId: string;
    secretAccessKey: string;
    region?: string;
    expiresInSeconds: number;
  }): Result<string, AppError>;
  presignGet(input: {
    url: string;
    accessKeyId: string;
    secretAccessKey: string;
    region?: string;
    expiresInSeconds: number;
  }): Result<string, AppError>;
  delete(input: {
    url: string;
    accessKeyId: string;
    secretAccessKey: string;
    region?: string;
  }): Promise<Result<{ deleted: true }, AppError>>;
  head(input: {
    url: string;
    accessKeyId: string;
    secretAccessKey: string;
    region?: string;
  }): Promise<Result<{ sizeBytes: number }, AppError>>;
  healthcheck(input: { tenantId: string }): Promise<Result<{ healthy: true }, AppError>>;
  test(input: {
    tenantId: string;
    corsOrigins?: string[] | undefined;
  }): Promise<Result<ProviderDiagnostic, AppError>>;
}

export interface ProductPriceRepository {
  listByProduct(tenantId: string, productId: string): Promise<ProductPrice[]>;
  listActiveByProducts(tenantId: string, productIds: string[]): Promise<ProductPrice[]>;
  findById(tenantId: string, id: string): Promise<ProductPrice | null>;
  create(tenantId: string, price: ProductPrice): Promise<void>;
  setActive(tenantId: string, id: string, active: boolean): Promise<ProductPrice | null>;
}

export interface OrderListQuery {
  status?: OrderStatus;
  productId?: string;
  kind?: PriceKind;
  couponId?: string;
  search?: string;
  page: number;
  pageSize: number;
}

export interface OrderRepository {
  create(tenantId: string, order: Order): Promise<void>;
  list(tenantId: string, query: OrderListQuery): Promise<{ orders: OrderListItem[]; total: number }>;
  listForMember?(tenantId: string, memberId: string): Promise<Order[]>;
  listBillingForMember?(
    tenantId: string,
    memberId: string,
    page: number,
    pageSize: number,
  ): Promise<{
    orders: Array<{
      id: string;
      createdAt: string;
      billing: BillingData | null;
      invoice: Pick<Invoice, 'id' | 'status' | 'provider'> | null;
    }>;
    total: number;
  }>;
  revenueSince(tenantId: string, sinceIso: string): Promise<Array<{ currency: string; amountCents: number }>>;
  countSince(tenantId: string, sinceIso: string): Promise<number>;
  listPaidWithoutGrant(
    tenantId: string,
    query: { paidBefore: string; limit: number },
  ): Promise<PaidWithoutGrantRow[]>;
}

export interface MemberOrderListReader {
  listForMember(tenantId: string, memberId: string): Promise<OrderListItem[]>;
}

export interface OrderDetailRepository {
  findById(tenantId: string, id: string): Promise<OrderListItem | null>;
}

export interface PaymentRefundRepository {
  findOrderByProviderObjectIds(
    tenantId: string,
    providerObjectIds: Record<string, string>,
  ): Promise<Order | null>;
  findLatestSubscriptionOrder(tenantId: string, providerSubscriptionId: string): Promise<Order | null>;
  listAccessRetainingOrdersForMemberProduct(
    tenantId: string,
    memberId: string,
    productId: string,
  ): Promise<Order[]>;
  markOrderRefunded(tenantId: string, orderId: string): Promise<Order | null>;
  markOrderPartiallyRefunded(tenantId: string, orderId: string): Promise<Order | null>;
}

export interface MemberSubscriptionRepository {
  findById(tenantId: string, id: string): Promise<MemberSubscription | null>;
  findByProviderSubscriptionId(
    tenantId: string,
    providerSubscriptionId: string,
  ): Promise<MemberSubscription | null>;
  listForMember(tenantId: string, memberId: string): Promise<MemberSubscription[]>;
  create(tenantId: string, subscription: MemberSubscription): Promise<void>;
  update(tenantId: string, subscription: MemberSubscription): Promise<MemberSubscription | null>;
  countActive(tenantId: string, now: string): Promise<number>;
}

export type PaymentEventClaim = 'claimed' | 'processed' | 'in_progress';

export interface ProcessedPaymentEventRepository {
  /**
   * Wins the event for this worker, or reports why it could not: another worker still holds the
   * lease (`in_progress`, so the sender should retry) or the effects already committed
   * (`processed`). An expired processing lease can be reclaimed so a worker that dies mid-effect
   * does not strand the event.
   */
  claim(
    tenantId: string,
    event: ProcessedPaymentEvent,
    lease: { workerId: string; now: string; leaseExpiresAt: string },
  ): Promise<PaymentEventClaim>;
  /** Marks the claim terminal after its effects committed. */
  finalize(
    tenantId: string,
    eventId: string,
    workerId: string,
    processedAt: string,
  ): Promise<void>;
  /** Undoes a claim whose effects did not apply, so a later redelivery can reprocess it. */
  release(tenantId: string, eventId: string, workerId: string): Promise<void>;
}

/** Generates and hashes tenant API-key secrets; kept behind a port for deterministic tests. */
export interface ApiKeyCrypto {
  generateSecret(): string;
  hash(secret: string): string;
}

export interface PurchaseRepository {
  createMemberGrant(input: {
    tenantId: string;
    userId: string;
    email: string;
    memberId: string;
    grantId: string;
    productId: string;
    createdAt: string;
  }): Promise<{ member: Member; grantCreated: boolean }>;
}

export interface EmailPort {
  send(message: { to: string; headers?: Record<string, string>; messageId?: string } & EmailMessage): Promise<Result<{ messageId: string }, AppError>>;
  healthcheck(): Promise<Result<{ healthy: true }, AppError>>;
  test(): Promise<Result<ProviderDiagnostic, AppError>>;
}

export interface TransactionalEmailSender {
  send(message: {
    tenantId: string | null;
    to: string;
    headers?: Record<string, string>;
    messageId?: string;
    tenantTransportRequired?: boolean;
  } & EmailMessage): Promise<Result<{ messageId: string; transport: TransactionalEmailTransport }, AppError>>;
}

export interface TransactionalEmailTransportResolver {
  resolve(tenantId: string): Promise<EmailPort | null>;
}

export interface EmailIntegrationTransportResolver {
  resolve(tenantId: string, transport: EmailIntegrationTransport): Promise<EmailPort | null>;
}

export interface PlatformTransactionalPool {
  usage(tenantId: string): Promise<{ sent: number; reserved: number }>;
  reserve(tenantId: string, limit: number): Promise<boolean>;
  settle(tenantId: string, successful: boolean): Promise<void>;
}

export interface EmailEventRepository {
  append(tenantId: string, event: EmailEvent): Promise<void>;
  listByRef(tenantId: string, mailKind: EmailEventMailKind, refId: string): Promise<EmailEvent[]>;
  listByEmailAcrossKinds(tenantId: string, email: string): Promise<EmailEvent[]>;
  purgeEngagement(tenantId: string, olderThan: string): Promise<number>;
  reputationCounts(
    tenantId: string,
    window: { since: string; until: string },
  ): Promise<EmailReputationCounts>;
}

export interface EmailSendRepository {
  listPage(
    tenantId: string,
    query: EmailSendListQuery,
  ): Promise<{ sends: EmailSendProjection[]; nextCursor: string | null }>;
  findById(
    tenantId: string,
    kind: EmailEventMailKind,
    id: string,
  ): Promise<EmailSendProjection | null>;
  listByEmailAcrossKinds(tenantId: string, email: string): Promise<EmailSendProjection[]>;
}

export interface EmailOutboxItem {
  id: string;
  tenantId: string | null;
  to: string;
  payload: unknown;
  attempts: number;
  sesMessageId: string | null;
  transport: TransactionalEmailTransport | null;
  deliveryStatus: 'delivered' | 'bounced' | 'complained' | null;
  deliveryOccurredAt: string | null;
  sourceApp: string | null;
  tenantTransportRequired: boolean;
}

export interface EmailOutboxRepository {
  enqueue(input: { id: string; tenantId: string | null; to: string; payload: EmailOutboxPayload; now: string; sourceApp?: string | null; tenantTransportRequired?: boolean }): Promise<Result<{ id: string }, AppError>>;
  claimBatch(input: { now: string; limit: number; attemptsCap: number; runId: string }): Promise<Result<EmailOutboxItem[], AppError>>;
  markSent(input: { id: string; sentAt: string; sesMessageId: string; transport: TransactionalEmailTransport; runId: string }): Promise<Result<void, AppError>>;
  markFailed(input: { id: string; attempts: number; nextAttemptAt: string; failedAt: string; error: string; errorCode: AppError['code']; transport: TransactionalEmailTransport | null; runId: string }): Promise<Result<void, AppError>>;
  correlateBySesMessageId?(tenantId: string, sesMessageId: string): Promise<EmailOutboxItem | null>;
  markDelivery?(input: {
    tenantId: string;
    id: string;
    status: 'delivered' | 'bounced' | 'complained';
    occurredAt: string;
    event: EmailEvent;
  }): Promise<Result<void, AppError>>;
  hasPendingForTenant?(tenantId: string): Promise<boolean>;
}

export interface EnrollmentTransactionPort {
  run<T>(operation: (deps: { members: MemberRepository; grants: ProductGrantRepository; emailOutbox: EmailOutboxRepository }) => Promise<Result<T, AppError>>): Promise<Result<T, AppError>>;
}

export interface PaymentTransactionPort {
  /** Every payment projection write of one webhook branch commits together or not at all. */
  run<T>(
    operation: (deps: {
      members: MemberRepository;
      grants: ProductGrantRepository;
      orders: OrderRepository;
      subscriptions: MemberSubscriptionRepository;
      paymentRefunds: PaymentRefundRepository;
      couponRedemptions: CouponRedemptionRepository;
      emailOutbox: EmailOutboxRepository;
      autoInvoiceJobs: AutoInvoiceJobRepository;
      processedPaymentEvents: ProcessedPaymentEventRepository;
      enrollmentTransaction: EnrollmentTransactionPort;
    }) => Promise<Result<T, AppError>>,
  ): Promise<Result<T, AppError>>;
}

/**
 * Dev-only sink so tests and the CLI can read magic links without a mailer.
 * @public
 */
export interface DevMagicLink {
  email: string;
  url: string;
  token: string;
}

export interface DevMagicLinkReader {
  findByEmail(email: string): Promise<DevMagicLink | null>;
}

/** @public */
export interface DevEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  messageId: string | null;
  createdAt: string;
}

export interface DevEmailReader {
  findByRecipient(to: string): Promise<DevEmail | null>;
}

/** Dev-only: the sinks are scratch space, so a fresh boot starts from an empty one. */
export interface DevSinkPurge {
  purge(): Promise<{ magicLinks: number; emails: number }>;
}

export interface TenantDomainRepository {
  findByDomain(domain: string): Promise<TenantDomain | null>;
  listVerifiedDomains(): Promise<TenantDomain[]>;
}

/** The only persisted onboarding state; every checklist step is recomputed on read. */
export interface OnboardingStateRepository {
  findDismissedAt(tenantId: string): Promise<string | null>;
  dismiss(tenantId: string, dismissedAt: string): Promise<void>;
}

/** @public */
export type TenantLookup = { tenantId: string } | { tenantSlug: string };

export interface TenantRepository {
  findById(tenantId: string): Promise<Tenant | null>;
  findBySlug(slug: string): Promise<Tenant | null>;
  findSole(): Promise<Tenant | null>;
  findSettings(tenantId: string): Promise<TenantSettings | null>;
  updateSettings(tenantId: string, settings: TenantSettings): Promise<TenantSettings>;
  createTenantWithOwnerGrant(
    input: {
      tenant: { id: string; slug: string; name: string; createdAt: string };
      ownerGrant: {
        id: string;
        userId: string;
        staffRole: Extract<StaffRole, 'owner'>;
      };
    },
    options?: { requireEmpty: boolean },
  ): Promise<Tenant | null>;
  hasAny(): Promise<boolean>;
}

/** Append-only: consent records are audit evidence and are never updated or deleted. */
export interface TermsConsentRepository {
  record(tenantId: string, consent: TermsConsent): Promise<void>;
  listByEmail(tenantId: string, email: string): Promise<TermsConsent[]>;
}

export interface MarketingConsentRepository {
  record(tenantId: string, consent: MarketingConsent): Promise<void>;
  listByEmail(tenantId: string, email: string, definitionId?: string): Promise<MarketingConsent[]>;
  latestByEmail(tenantId: string, email: string, definitionId: string): Promise<MarketingConsent | null>;
  findById(tenantId: string, consentId: string): Promise<MarketingConsent | null>;
  purgeStalePending(tenantId: string, olderThan: string, doubleOptInDefinitionIds: string[]): Promise<number>;
}

export interface ConsentEvidenceRetentionRepository {
  listExpiredTenantIds(retentionStartedBefore: string): Promise<string[]>;
  purgeExpired(
    tenantId: string,
    retentionStartedBefore: string,
    options: { batchSize: number; deadlineMs: number },
  ): Promise<number>;
}

export interface TenantDocumentRepository {
  create(tenantId: string, document: TenantDocument, draft: TenantDocumentVersion): Promise<void>;
  findById(tenantId: string, documentId: string): Promise<TenantDocument | null>;
  list(tenantId: string): Promise<TenantDocument[]>;
  listVersions(tenantId: string, documentId: string): Promise<TenantDocumentVersion[]>;
  saveDraft(tenantId: string, document: TenantDocument, draft: TenantDocumentVersion): Promise<TenantDocumentVersion | null>;
  publishDraft(tenantId: string, documentId: string, publishedAt: string): Promise<{ document: TenantDocument; version: TenantDocumentVersion } | null>;
  findPublishedVersionById(tenantId: string, versionId: string): Promise<{ document: TenantDocument; version: TenantDocumentVersion } | null>;
  findLatestPublished(tenantId: string, slug: string): Promise<{ document: TenantDocument; version: TenantDocumentVersion } | null>;
  findPublishedVersion(tenantId: string, slug: string, version: number): Promise<{ document: TenantDocument; version: TenantDocumentVersion } | null>;
}

export interface ConsentConfirmationTokenRepository {
  create(tenantId: string, token: ConsentConfirmationToken): Promise<void>;
  findByToken(tenantId: string, token: string): Promise<ConsentConfirmationToken | null>;
  consume(tenantId: string, token: string, usedAt: string): Promise<ConsentConfirmationToken | null>;
}

export interface MarketingAudienceMember {
  memberId: string;
  email: string;
  displayName: string | null;
  productIds: string[];
}

export interface MarketingAudienceRepository {
  snapshot(tenantId: string, input: {
    definitionId: string;
    productIds: string[];
  }): Promise<{ maxMemberId: string | null; count: number }>;
  fetchEligibleBatch(tenantId: string, input: {
    definitionId: string;
    productIds: string[];
    afterMemberId: string | null;
    maxMemberId: string;
    limit: number;
  }): Promise<MarketingAudienceMember[]>;
}

export interface ConsentDefinitionRepository {
  create(tenantId: string, definition: ConsentDefinition, version: ConsentDefinitionVersion): Promise<void>;
  findById(tenantId: string, definitionId: string): Promise<ConsentDefinition | null>;
  list(tenantId: string, status?: ConsentDefinition['status']): Promise<ConsentDefinition[]>;
  update(tenantId: string, definition: ConsentDefinition): Promise<ConsentDefinition | null>;
  appendVersion(tenantId: string, version: ConsentDefinitionVersion): Promise<void>;
  listVersions(tenantId: string, definitionId: string): Promise<ConsentDefinitionVersion[]>;
}

export interface CampaignRepository {
  create(tenantId: string, campaign: Campaign): Promise<void>;
  findById(tenantId: string, campaignId: string): Promise<Campaign | null>;
  list(tenantId: string): Promise<Campaign[]>;
  delete(tenantId: string, campaignId: string): Promise<boolean>;
  update(tenantId: string, campaign: Campaign): Promise<Campaign | null>;
  acquireLease(
    tenantId: string,
    campaignId: string,
    input: { workerId: string; now: string; lockedUntil: string },
  ): Promise<boolean>;
  advanceCursor(
    tenantId: string,
    campaignId: string,
    input: { cursorMemberId: string; sentDelta: number; failedDelta: number },
  ): Promise<Campaign | null>;
}

export interface MarketingJobRepository {
  listRunnableCampaigns(now: string): Promise<Array<{ tenantId: string; campaignId: string }>>;
  listRetentionTenantIds(): Promise<string[]>;
  listSesIdentityRefreshTenantIds(checkedBefore: string): Promise<string[]>;
  listSesTenantIds(checkedBefore: string): Promise<string[]>;
}

export interface EmailLayoutRepository {
  create(tenantId: string, layout: EmailLayout): Promise<void>;
  findById(tenantId: string, layoutId: string): Promise<EmailLayout | null>;
  list(tenantId: string): Promise<EmailLayout[]>;
  update(tenantId: string, layout: EmailLayout): Promise<EmailLayout | null>;
}

export interface CampaignSendRepository {
  claimRecipient(tenantId: string, send: CampaignSend, events?: EmailEvent[]): Promise<boolean>;
  findById(tenantId: string, sendId: string): Promise<CampaignSend | null>;
  update(tenantId: string, send: CampaignSend, events?: EmailEvent[]): Promise<CampaignSend | null>;
  correlateBySesMessageId(tenantId: string, sesMessageId: string): Promise<CampaignSend | null>;
  listByCampaign(tenantId: string, campaignId: string): Promise<CampaignSend[]>;
  listAll(tenantId: string): Promise<CampaignSend[]>;
  engagementStats(
    tenantId: string,
    campaignIds: string[],
  ): Promise<Map<string, CampaignEngagementStats>>;
  listPage(tenantId: string, query: {
    campaignId?: string;
    email?: string;
    status?: CampaignSend['status'];
    cursor?: string;
    limit: number;
  }): Promise<{ sends: CampaignSend[]; nextCursor: string | null }>;
  hasPendingByCampaign(tenantId: string, campaignId: string): Promise<boolean>;
  pseudonymizeMember(tenantId: string, input: { memberId: string; email: string; tombstoneEmail: string }): Promise<number>;
  ageOutRenderedBodies(tenantId: string, olderThan: string, purgedAt: string): Promise<number>;
}

export interface SuppressionRepository {
  record(tenantId: string, suppression: Suppression, event?: EmailEvent): Promise<boolean>;
  findActive(tenantId: string, emailHmac: string): Promise<Suppression | null>;
  isSuppressed(tenantId: string, emailHmac: string): Promise<boolean>;
  lift(tenantId: string, suppression: Suppression): Promise<Suppression | null>;
  findById(tenantId: string, suppressionId: string): Promise<Suppression | null>;
  list(tenantId: string, query: { emailHmac?: string; cursor?: string; limit: number }): Promise<{ suppressions: Suppression[]; nextCursor: string | null }>;
}

export interface UnsubscribeTokenRepository {
  create(tenantId: string, token: UnsubscribeToken): Promise<void>;
  findByToken(tenantId: string, token: string): Promise<UnsubscribeToken | null>;
  consume(
    tenantId: string,
    token: string,
    usedAt: string,
    event?: EmailEvent,
  ): Promise<{ token: UnsubscribeToken; newlyUsed: boolean } | null>;
}

export interface TenantSesSettingsRepository {
  findByTenant(tenantId: string): Promise<TenantSesSettings | null>;
  findByWebhookToken(webhookToken: string): Promise<TenantSesSettings | null>;
  upsert(tenantId: string, settings: TenantSesSettings): Promise<TenantSesSettings>;
}

export interface SesMarketingCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

export interface SesMarketingSender {
  send(input: {
    credentials: SesMarketingCredentials;
    from: { address: string; name: string };
    to: string;
    subject: string;
    html: string;
    text: string;
    headers: Record<string, string>;
    configurationSet: string | null;
  }): Promise<Result<{ messageId: string }, AppError>>;
}

export interface SesMarketingQuotaReader {
  read(credentials: SesMarketingCredentials): Promise<Result<{
    ratePerSecond: number;
    daily: number;
    sentLast24Hours: number;
    inSandbox: boolean;
  }, AppError>>;
}

export interface SesDkimRecord {
  name: string;
  type: 'CNAME';
  value: string;
}

export interface SesOnboardingControlPlane {
  startDomainIdentity(
    credentials: SesMarketingCredentials,
    identity: string,
  ): Promise<Result<{ records: SesDkimRecord[] }, AppError>>;
  startEmailIdentity(
    credentials: SesMarketingCredentials,
    identity: string,
  ): Promise<Result<{ records: SesDkimRecord[] }, AppError>>;
  readIdentity(
    credentials: SesMarketingCredentials,
    identity: string,
  ): Promise<Result<{ verified: boolean; dkimVerified: boolean; records: SesDkimRecord[] }, AppError>>;
  ensureConfigurationSet(
    credentials: SesMarketingCredentials,
    name: string,
  ): Promise<Result<{ name: string }, AppError>>;
  ensureTopic(
    credentials: SesMarketingCredentials,
    name: string,
  ): Promise<Result<{ arn: string }, AppError>>;
  ensureSubscription(
    credentials: SesMarketingCredentials,
    input: { topicArn: string; endpoint: string },
  ): Promise<Result<{ confirmed: boolean; arn: string | null }, AppError>>;
  readInfrastructure(
    credentials: SesMarketingCredentials,
    input: {
      configurationSet: string;
      transactionalConfigurationSet: string;
      topicArn: string;
      endpoint: string;
    },
  ): Promise<Result<{ configurationSetReady: boolean; eventDestinationReady: boolean; subscriptionConfirmed: boolean }, AppError>>;
  ensureEventDestination(
    credentials: SesMarketingCredentials,
    input: {
      configurationSet: string;
      topicArn: string;
      engagementTracking: boolean;
    },
  ): Promise<Result<{ ready: true }, AppError>>;
  disableFeedbackForwarding(
    credentials: SesMarketingCredentials,
    identity: string,
  ): Promise<Result<{ disabled: true }, AppError>>;
  readQuota(
    credentials: SesMarketingCredentials,
  ): Promise<Result<{
    ratePerSecond: number;
    daily: number;
    sentLast24Hours: number;
    inSandbox: boolean;
  }, AppError>>;
  sendSimulator(
    credentials: SesMarketingCredentials,
    input: {
      from: { address: string; name: string };
      to: string;
      configurationSet: string;
    },
  ): Promise<Result<{ messageId: string }, AppError>>;
}

export interface MarketingThrottleRepository {
  claim(tenantId: string, input: {
    requested: number;
    now: string;
    ratePerSecond: number;
    dailyQuota: number;
    sentLast24Hours: number;
    quotaSnapshotAt: string;
  }): Promise<boolean>;
}

export interface VerifiedSnsEnvelope {
  type: 'SubscriptionConfirmation' | 'Notification';
  topicArn: string;
  message: string;
  subscribeUrl: string | null;
}

export interface SnsVerifier {
  verify(input: {
    rawBody: string;
    headers: Record<string, string>;
    region: string;
  }): Promise<Result<VerifiedSnsEnvelope, AppError>>;
  confirmSubscription(input: { subscribeUrl: string; region: string }): Promise<Result<void, AppError>>;
}

export interface SchedulerPort {
  enqueueCampaignTick(tenantId: string, campaignId: string): Promise<Result<void, AppError>>;
  scheduleCampaignTick(tenantId: string, campaignId: string, runAt: string): Promise<Result<void, AppError>>;
  enqueueRetentionJobs(tenantId: string): Promise<Result<void, AppError>>;
}

export interface SchedulerRunRepository {
  start(run: SchedulerRun): Promise<void>;
  finalize(runId: string, input: {
    finishedAt: string;
    durationMs: number;
    status: 'completed' | 'failed';
    error: string | null;
    totals: SchedulerRunTotals;
    tenants: SchedulerRunTenant[];
  }): Promise<SchedulerRun | null>;
  listPage(input: SchedulerRunListQuery): Promise<{
    runs: SchedulerRun[];
    nextCursor: string | null;
  }>;
  getWithTenants(runId: string): Promise<{ run: SchedulerRun; tenants: SchedulerRunTenant[] } | null>;
  getForTenant(tenantId: string, runId: string): Promise<SchedulerRunTenantItem | null>;
  listForTenant(tenantId: string, input: SchedulerRunListQuery): Promise<{
    items: SchedulerRunTenantItem[];
    nextCursor: string | null;
  }>;
  summarizeForTenant(tenantId: string, since: string): Promise<SchedulerRunTenantSummary>;
  failStale(input: { startedBefore: string; finishedAt: string; error: string }): Promise<number>;
}

export interface EmailHmac {
  compute(tenantId: string, normalizedEmail: string): string;
}

export interface MarketingSesCredentialResolver {
  resolve(tenantId: string): Promise<Result<SesMarketingCredentials, AppError>>;
}

export interface TokenGenerator {
  nextToken(): string;
}

export interface AutomationIdempotencyRepository {
  claim(tenantId: string, record: AutomationIdempotencyKey): Promise<AutomationIdempotencyKey | null>;
  complete(tenantId: string, key: string, resourceId: string): Promise<void>;
  release(tenantId: string, key: string): Promise<void>;
  sweepExpired(now: string): Promise<number>;
}

export interface TenantAccessReader {
  listTenantsForStaff(userId: string): Promise<Membership[]>;
  listStaffForTenant(tenantId: string): Promise<Array<{ userId: string; email: string }>>;
  findStaffGrant(userId: string, lookup: TenantLookup): Promise<Membership | null>;
  findMember(tenantId: string, userId: string): Promise<Member | null>;
}

/** Established authenticated session, before tenant resolution. */
export interface AuthenticatedUser {
  userId: string;
  email: string;
  name: string;
  emailVerified: boolean;
  image: string | null;
}

export interface AuthPort {
  /** Returns the authenticated user for a request, or null when anonymous. */
  getAuthenticatedUser(requestHeaders: Headers): Promise<AuthenticatedUser | null>;
  /** Find-or-create a passwordless provider user for this email. Idempotent. */
  ensureUser(email: string): Promise<{ userId: string; created: boolean }>;
  /** Trigger a magic-link email through the configured EmailPort. */
  requestMagicLink(input: {
    email: string;
    callbackURL: string;
    tenantName?: string;
    language?: string;
    /** Host-derived base URL so the verify link lands on the requesting tenant domain. */
    baseUrl?: string;
    branding?: EmailBranding;
  }): Promise<void>;
  /**
   * Generate a magic-link URL for enrollment WITHOUT sending the default
   * magic-link email — the enroll use-case sends its own welcome email instead.
   * The dev link store is still populated when magic-link exposure is enabled.
   */
  createEnrollmentMagicLink(input: {
    email: string;
    callbackURL: string;
    baseUrl: string;
    tenantName: string;
    language: string;
  }): Promise<{ url: string }>;
}

export interface HealthPort {
  pingDatabase(): Promise<boolean>;
  schemaStatus(): Promise<{
    expectedMigrations: number;
    appliedMigrations: number | null;
    schemaCurrent: boolean;
    schemaFingerprint: string | null;
    schemaFingerprintMatch: boolean | null;
  }>;
}

export interface IdGenerator {
  nextId(): string;
}

export interface Clock {
  nowIso(): string;
}
