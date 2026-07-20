import type {
  AppError,
  Course,
  CourseLesson,
  CourseModule,
  EntityHistoryEntry,
  EntityKind,
  EmailMessage,
  Member,
  MemberGrant,
  MemberCourseProgress,
  MemberSubscription,
  MemberWithProductIds,
  Membership,
  Order,
  OrderListItem,
  OrderStatus,
  PriceKind,
  Product,
  ProductGrant,
  ProductPrice,
  ProcessedPaymentEvent,
  Result,
  StaffRole,
  StreamVideo,
  Notification,
  Post,
  Tenant,
  TenantApiKey,
  TenantDomain,
  TenantSecret,
  TenantSecretKey,
  TenantSettings,
} from '@core/domain/index.js';

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
  findDisplayNames(userIds: string[]): Promise<Map<string, string>>;
}

export interface ProductRepository {
  listByTenant(tenantId: string): Promise<Product[]>;
  listPublishedByTenant(tenantId: string): Promise<Product[]>;
  findById(tenantId: string, id: string): Promise<Product | null>;
  create(tenantId: string, product: Product): Promise<void>;
  updateAccessItems(
    tenantId: string,
    id: string,
    accessItems: Product['accessItems'],
    version?: EntityVersionRecord,
  ): Promise<Product | null>;
  setPublished(tenantId: string, id: string, published: boolean): Promise<void>;
  bumpContentVersion(tenantId: string): Promise<void>;
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
  findById(tenantId: string, id: string): Promise<CourseLesson | null>;
  findByIds(tenantId: string, ids: string[]): Promise<CourseLesson[]>;
  create(tenantId: string, lesson: CourseLesson): Promise<void>;
  update(tenantId: string, lesson: CourseLesson, version?: EntityVersionRecord): Promise<CourseLesson | null>;
  delete(tenantId: string, id: string): Promise<boolean>;
}

export interface PostSearchRow {
  post: Post;
  lessonId: string;
  snippet: string;
}

export interface PostRepository {
  createPost(tenantId: string, post: Post): Promise<Post>;
  findById(tenantId: string, id: string): Promise<Post | null>;
  listThreadsForContext(
    tenantId: string,
    query: { contextKind: 'lesson'; contextId: string; cursor?: string; limit: number },
  ): Promise<{ threads: Array<{ post: Post; replyCount: number }>; nextCursor: string | null }>;
  listReplies(tenantId: string, rootPostId: string): Promise<Post[]>;
  updateBody(tenantId: string, input: { id: string; body: string; editedAt: string }): Promise<Post | null>;
  softDelete(tenantId: string, input: { id: string; deletedAt: string }): Promise<Post | null>;
  search(
    tenantId: string,
    query: { query: string; lessonIds: string[]; limit: number },
  ): Promise<PostSearchRow[]>;
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

export interface NotificationRepository {
  insert(tenantId: string, notification: Notification): Promise<Notification>;
  listForRecipient(
    tenantId: string,
    query: { recipientUserId: string; cursor?: string; limit: number },
  ): Promise<{ notifications: Notification[]; nextCursor: string | null }>;
  markRead(tenantId: string, input: { id: string; recipientUserId: string; readAt: string }): Promise<Notification | null>;
  markAllRead(tenantId: string, input: { recipientUserId: string; readAt: string }): Promise<number>;
  unreadCount(tenantId: string, recipientUserId: string): Promise<number>;
}

export interface NotificationDeliveryContext {
  recipientEmail: string | null;
  tenantName: string;
  lessonName: string;
  lessonUrl: string;
  language: string;
}

export interface NotificationChannelPort {
  deliver(notification: Notification, context: NotificationDeliveryContext): Promise<Result<void, AppError>>;
}

export interface RealtimeNotificationEvent {
  tenantId: string;
  recipientUserId: string;
  notification: Notification;
}

export interface RealtimeBusPort {
  publish(event: RealtimeNotificationEvent): void;
  subscribe(listener: (event: RealtimeNotificationEvent) => void): () => void;
}

export interface DiscussionLinkPort {
  lessonDiscussionUrl(input: {
    tenantSlug: string | null;
    courseId: string | null;
    lessonId: string;
  }): string;
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
  delete(tenantId: string, memberId: string): Promise<boolean>;
}

export interface ProductGrantRepository {
  findById(tenantId: string, grantId: string): Promise<ProductGrant | null>;
  findGrant(tenantId: string, memberId: string, productId: string): Promise<ProductGrant | null>;
  createGrant(tenantId: string, grant: ProductGrant): Promise<boolean>;
  setGrantWindow(
    tenantId: string,
    grantId: string,
    window: { startsAt: string; expiresAt: string | null },
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
  checkoutSession: {
    email: string | null;
    subscriptionId: string | null;
    metadata: {
      tenantId: string | null;
      productId: string | null;
      priceId: string | null;
      memberEmail: string | null;
      language: string | null;
    };
  } | null;
  invoice?: {
    subscriptionId: string | null;
    amountCents: number | null;
    currency: string | null;
    periodEnd: string | null;
  } | null;
  subscription?: {
    id: string;
    status: string | null;
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: string | null;
  } | null;
}

export interface PaymentProvider {
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
  }): Promise<Result<{ url: string; sessionId: string }, AppError>>;
  expireCheckoutSession(input: {
    tenantId: string;
    sessionId: string;
  }): Promise<Result<{ expired: true }, AppError>>;
  verifyWebhookEvent(input: {
    payloadRaw: string;
    signatureHeader: string;
    webhookSecret: string;
  }): Promise<Result<PaymentWebhookEvent, AppError>>;
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

/**
 * Signs object-storage GET URLs (SigV4 presign in production) so imported
 * media on private buckets stays reachable. Credentials arrive per call so
 * the adapter stays stateless and the use-case controls which tenant secret
 * is decrypted.
 */
export interface FileUrlSigner {
  presignGet(input: {
    url: string;
    accessKeyId: string;
    secretAccessKey: string;
    expiresInSeconds: number;
  }): Result<string, AppError>;
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
  search?: string;
  page: number;
  pageSize: number;
}

export interface OrderRepository {
  create(tenantId: string, order: Order): Promise<void>;
  list(tenantId: string, query: OrderListQuery): Promise<{ orders: OrderListItem[]; total: number }>;
  revenueSince(tenantId: string, sinceIso: string): Promise<Array<{ currency: string; amountCents: number }>>;
  countSince(tenantId: string, sinceIso: string): Promise<number>;
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

export interface ProcessedPaymentEventRepository {
  /**
   * Records the event before its effects run and returns whether this call won the insert.
   * The event-id primary key and the object+type unique index make the write atomic, so a
   * duplicate delivery racing the original loses here instead of double-applying the effects.
   */
  claim(tenantId: string, event: ProcessedPaymentEvent): Promise<boolean>;
  /** Undoes a claim whose effects did not apply, so a later redelivery can reprocess it. */
  release(tenantId: string, eventId: string): Promise<void>;
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
  send(message: { to: string } & EmailMessage): Promise<Result<{ messageId: string | null }, AppError>>;
}

/** Dev-only sink so tests and the CLI can read magic links without a mailer. */
export interface DevMagicLink {
  email: string;
  url: string;
  token: string;
}

export interface DevMagicLinkReader {
  findByEmail(email: string): Promise<DevMagicLink | null>;
}

export interface DevEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  createdAt: string;
}

export interface DevEmailReader {
  findByRecipient(to: string): Promise<DevEmail | null>;
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

export type TenantLookup = { tenantId: string } | { tenantSlug: string };

export interface TenantRepository {
  findById(tenantId: string): Promise<Tenant | null>;
  findBySlug(slug: string): Promise<Tenant | null>;
  findSettings(tenantId: string): Promise<TenantSettings | null>;
  updateSettings(tenantId: string, settings: TenantSettings): Promise<TenantSettings>;
  createTenantWithOwnerGrant(input: {
    tenant: { id: string; slug: string; name: string; createdAt: string };
    ownerGrant: {
      id: string;
      userId: string;
      staffRole: Extract<StaffRole, 'owner'>;
    };
  }): Promise<Tenant>;
}

export interface TenantAccessReader {
  listTenantsForStaff(userId: string): Promise<Membership[]>;
  findStaffGrant(userId: string, lookup: TenantLookup): Promise<Membership | null>;
  findMember(userId: string, tenantId: string): Promise<Member | null>;
}

/** Established authenticated session, before tenant resolution. */
export interface AuthenticatedUser {
  userId: string;
  email: string;
  name: string;
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
  }): Promise<void>;
  /**
   * Generate a magic-link URL for enrollment WITHOUT sending the default
   * magic-link email — the enroll use-case sends its own welcome email instead.
   * The dev link store is still populated when magic-link exposure is enabled.
   */
  createEnrollmentMagicLink(input: {
    email: string;
    callbackURL: string;
    tenantName: string;
    language: string;
  }): Promise<{ url: string }>;
}

export interface HealthPort {
  pingDatabase(): Promise<boolean>;
}

export interface IdGenerator {
  nextId(): string;
}

export interface Clock {
  nowIso(): string;
}
