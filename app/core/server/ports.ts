import type {
  Member,
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
  setPublished(tenantId: string, id: string, published: boolean): Promise<void>;
  bumpContentVersion(tenantId: string): Promise<void>;
}

export interface MemberRepository {
  findByEmail(tenantId: string, email: string): Promise<Member | null>;
  create(tenantId: string, member: Member): Promise<void>;
}

export interface ProductGrantRepository {
  findGrant(tenantId: string, memberId: string, productId: string): Promise<ProductGrant | null>;
  createGrant(tenantId: string, grant: ProductGrant): Promise<void>;
  listGrantedProducts(tenantId: string, memberId: string): Promise<Product[]>;
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
  createTenant(input: { id: string; slug: string; name: string; createdAt: string }): Promise<Tenant>;
  createOwnerGrant(input: {
    id: string;
    tenantId: string;
    userId: string;
    staffRole: Extract<StaffRole, 'owner'>;
  }): Promise<void>;
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
