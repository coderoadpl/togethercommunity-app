import type {
  Course,
  CourseLesson,
  CourseModule,
  Member,
  MemberCourseProgress,
  MemberWithProductIds,
  Membership,
  Product,
  ProductGrant,
  StaffRole,
  Tenant,
  TenantDomain,
} from '@core/domain/index.js';

/**
 * Ports: interfaces the core depends on, implemented in `adapters/`.
 * The core never knows which database, auth provider or platform sits behind them.
 */

export interface ProductRepository {
  listByTenant(tenantId: string): Promise<Product[]>;
  listPublishedByTenant(tenantId: string): Promise<Product[]>;
  findById(tenantId: string, id: string): Promise<Product | null>;
  create(tenantId: string, product: Product): Promise<void>;
  updateAccessItems(tenantId: string, id: string, accessItems: Product['accessItems']): Promise<Product | null>;
  setPublished(tenantId: string, id: string, published: boolean): Promise<void>;
  bumpContentVersion(tenantId: string): Promise<void>;
}

export interface CourseRepository {
  list(tenantId: string): Promise<Course[]>;
  findById(tenantId: string, id: string): Promise<Course | null>;
  findByIds(tenantId: string, ids: string[]): Promise<Course[]>;
  create(tenantId: string, course: Course): Promise<void>;
  update(tenantId: string, course: Course): Promise<Course | null>;
  delete(tenantId: string, id: string): Promise<boolean>;
}

export interface CourseModuleRepository {
  list(tenantId: string): Promise<CourseModule[]>;
  findById(tenantId: string, id: string): Promise<CourseModule | null>;
  findByIds(tenantId: string, ids: string[]): Promise<CourseModule[]>;
  create(tenantId: string, module: CourseModule): Promise<void>;
  update(tenantId: string, module: CourseModule): Promise<CourseModule | null>;
  delete(tenantId: string, id: string): Promise<boolean>;
}

export interface CourseLessonRepository {
  list(tenantId: string): Promise<CourseLesson[]>;
  findById(tenantId: string, id: string): Promise<CourseLesson | null>;
  findByIds(tenantId: string, ids: string[]): Promise<CourseLesson[]>;
  create(tenantId: string, lesson: CourseLesson): Promise<void>;
  update(tenantId: string, lesson: CourseLesson): Promise<CourseLesson | null>;
  delete(tenantId: string, id: string): Promise<boolean>;
}

export interface MemberCourseProgressRepository {
  findByMemberAndCourse(
    tenantId: string,
    input: { memberId: string; courseId: string },
  ): Promise<MemberCourseProgress | null>;
  findOrCreate(
    tenantId: string,
    input: { id: string; memberId: string; courseId: string; now: string },
  ): Promise<MemberCourseProgress>;
  update(tenantId: string, progress: MemberCourseProgress): Promise<MemberCourseProgress | null>;
}

export interface MemberRepository {
  findByEmail(tenantId: string, email: string): Promise<Member | null>;
  listWithProductIds(tenantId: string): Promise<MemberWithProductIds[]>;
  create(tenantId: string, member: Member): Promise<void>;
  updateEmail(tenantId: string, memberId: string, email: string): Promise<Member | null>;
  delete(tenantId: string, memberId: string): Promise<boolean>;
}

export interface ProductGrantRepository {
  findGrant(tenantId: string, memberId: string, productId: string): Promise<ProductGrant | null>;
  createGrant(tenantId: string, grant: ProductGrant): Promise<boolean>;
  listActiveForMember(tenantId: string, memberId: string, now: string): Promise<ProductGrant[]>;
  listGrantedProducts(tenantId: string, memberId: string): Promise<Product[]>;
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

/** Dev-only sink so tests and the CLI can read magic links without a mailer. */
export interface DevMagicLink {
  email: string;
  url: string;
  token: string;
}

export interface DevMagicLinkReader {
  findByEmail(email: string): Promise<DevMagicLink | null>;
}

export interface TenantDomainRepository {
  findByDomain(domain: string): Promise<TenantDomain | null>;
  listVerifiedDomains(): Promise<TenantDomain[]>;
}

export type TenantLookup = { tenantId: string } | { tenantSlug: string };

export interface TenantRepository {
  findById(tenantId: string): Promise<Tenant | null>;
  findBySlug(slug: string): Promise<Tenant | null>;
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
  /** Trigger a magic-link email (dev: routed to the DevMagicLink sink). */
  requestMagicLink(input: { email: string; callbackURL: string }): Promise<void>;
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
