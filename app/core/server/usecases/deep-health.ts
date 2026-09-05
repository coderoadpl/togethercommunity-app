import {
  tenantSettingsParseFailure,
  type Course,
  type DeepHealthCheck,
  type DeepHealthReport,
  type Tenant,
} from '#core/domain/index.js';

import type {
  Clock,
  ConsentDefinitionRepository,
  CourseLessonRepository,
  CourseModuleRepository,
  CourseRepository,
  EmailIntegrationTransportResolver,
  ProductPriceRepository,
  ProductRepository,
  SchedulerRunRepository,
  SecretCrypto,
  StorageProvider,
  TenantDirectory,
  TenantDocumentRepository,
  TenantRepository,
  TenantSecretRepository,
  TenantSecretResolver,
} from '../ports.js';
import { resolveTenantTransactionalTransport } from './layered-transactional-email.js';
import { getPublicOffer } from './public-offer.js';
import { getPublicCourseStructure } from './public-surface.js';
import { resolveStorageConfiguration } from './storage-assets.js';

export interface DeepHealthDeps {
  tenantDirectory: TenantDirectory;
  tenants: TenantRepository;
  courses: CourseRepository;
  modules: CourseModuleRepository;
  lessons: CourseLessonRepository;
  products: ProductRepository;
  prices: ProductPriceRepository;
  tenantSecrets: TenantSecretRepository;
  secretCrypto: SecretCrypto;
  secretResolver: TenantSecretResolver;
  storage: StorageProvider;
  emailTransports: EmailIntegrationTransportResolver;
  clock: Clock;
  schedulerRuns?: Pick<SchedulerRunRepository, 'listPage'> | undefined;
  definitions?: ConsentDefinitionRepository | undefined;
  documents?: Pick<TenantDocumentRepository, 'findPublishedVersionById'> | undefined;
}

const DEEP_HEALTH_BUDGET_MS = 20_000;

const ERROR_MAX_LENGTH = 200;
const SCHEDULER_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const PRESIGN_TTL_SECONDS = 60;
const PRESIGN_PROBE_KEY = 'health/deep-probe';
const DEADLINE_CHECK = 'deadline';

/**
 * The endpoint is unauthenticated, so only a message a probe wrote itself may
 * reach the response: any other cause carries driver text, and a failed query
 * prints its SQL together with the values bound to it.
 */
class ProbeFailure extends Error {}

class DeadlineExceeded extends Error {}

const truncate = (message: string): string => {
  const collapsed = message.replaceAll(/\s+/g, ' ').trim();
  return collapsed.length > ERROR_MAX_LENGTH
    ? `${collapsed.slice(0, ERROR_MAX_LENGTH - 1)}…`
    : collapsed;
};

const describeFailure = (cause: unknown): string =>
  cause instanceof ProbeFailure
    ? truncate(cause.message)
    : `unexpected ${cause instanceof Error ? cause.constructor.name : typeof cause}`;

type ProbeOutcome = 'checked' | 'not-applicable';

type Probe = () => Promise<ProbeOutcome>;

const withDeadline = async (probe: Probe, remainingMs: number): Promise<ProbeOutcome> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      probe(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { reject(new DeadlineExceeded()); }, remainingMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const createRecorder = (budgetMs: number) => {
  const accumulated = new Map<string, DeepHealthCheck>();
  const unfinished = new Set<string>();
  const startedAt = Date.now();
  return {
    record: async (name: string, probe: Probe): Promise<void> => {
      const remainingMs = startedAt + budgetMs - Date.now();
      if (remainingMs <= 0) {
        unfinished.add(name);
        return;
      }
      const current = accumulated.get(name)
        ?? { name, ok: true, ms: 0, subjects: 0, error: null };
      const probeStartedAt = Date.now();
      let outcome: ProbeOutcome = 'not-applicable';
      let failure: string | null = null;
      try {
        outcome = await withDeadline(probe, remainingMs);
      } catch (cause) {
        if (cause instanceof DeadlineExceeded) unfinished.add(name);
        else failure = describeFailure(cause);
      }
      accumulated.set(name, {
        name,
        ok: current.ok && failure === null,
        ms: current.ms + (Date.now() - probeStartedAt),
        subjects: current.subjects + (outcome === 'checked' ? 1 : 0),
        error: current.error ?? failure,
      });
    },
    checks: (): DeepHealthCheck[] => {
      const checks = [...accumulated.values()];
      if (unfinished.size === 0) return checks;
      return [...checks, {
        name: DEADLINE_CHECK,
        ok: false,
        ms: Date.now() - startedAt,
        subjects: 0,
        error: truncate(
          `the ${String(budgetMs)} ms probe budget expired at ${[...unfinished].join(', ')}`,
        ),
      }];
    },
  };
};

const publicStructureLessonId = async (
  tenant: Tenant,
  course: Course,
  deps: DeepHealthDeps,
): Promise<string | null> => {
  const structure = await getPublicCourseStructure(tenant, course.id, deps);
  if (!structure.ok) {
    throw new ProbeFailure(`the public course structure failed with ${structure.error.code}`);
  }
  return structure.value.modules
    .flatMap((module) => module.chapters)
    .flatMap((chapter) => chapter.lessons)
    .map((lesson) => lesson.lessonId)
    .at(0) ?? null;
};

const authoredLessonId = async (
  tenant: Tenant,
  course: Course,
  deps: DeepHealthDeps,
): Promise<string | null> => {
  const modules = await deps.modules.list(tenant.id);
  const ordered = course.moduleOrder
    .map((moduleId) => modules.find((module) => module.id === moduleId))
    .filter((module) => module !== undefined);
  const belonging = ordered.length > 0
    ? ordered
    : modules.filter((module) => module.courseIds.includes(course.id));
  return belonging
    .flatMap((module) => module.chapters)
    .flatMap((chapter) => chapter.contents)
    .map((content) => content.lessonId)
    .at(0) ?? null;
};

const probeTenantSettings = (tenant: Tenant, deps: DeepHealthDeps): Probe => async () => {
  const settings = await deps.tenants.findSettings(tenant.id);
  if (settings === null) throw new ProbeFailure('the tenant settings row is missing');
  const failedPaths = tenantSettingsParseFailure(settings);
  if (failedPaths !== null) {
    throw new ProbeFailure(`tenant settings no longer parse at ${failedPaths}`);
  }
  return 'checked';
};

const probePublicOffer = (tenant: Tenant, deps: DeepHealthDeps): Probe => async () => {
  const offer = await getPublicOffer(tenant, deps);
  if (!offer.ok) throw new ProbeFailure(`the public offer failed with ${offer.error.code}`);
  return 'checked';
};

const probeCourseContent = (tenant: Tenant, deps: DeepHealthDeps): Probe => async () => {
  const courses = await deps.courses.list(tenant.id);
  const course = courses.find((candidate) => candidate.publiclyVisible) ?? courses[0];
  if (course === undefined) return 'not-applicable';
  const lessonId = course.publiclyVisible
    ? await publicStructureLessonId(tenant, course, deps)
    : await authoredLessonId(tenant, course, deps);
  if (lessonId === null) return 'checked';
  const lesson = await deps.lessons.findById(tenant.id, lessonId);
  if (lesson === null) {
    throw new ProbeFailure('a lesson referenced by a course structure is missing');
  }
  return 'checked';
};

const probeSecretDecryption = (tenant: Tenant, deps: DeepHealthDeps): Probe => async () => {
  const stored = await deps.tenantSecrets.listByTenant(tenant.id);
  const secret = stored[0];
  if (secret === undefined) return 'not-applicable';
  const decrypted = deps.secretCrypto.decrypt(secret);
  if (!decrypted.ok) {
    throw new ProbeFailure(`secret decryption failed with ${decrypted.error.code}`);
  }
  if (decrypted.value.length === 0) {
    throw new ProbeFailure('secret decryption produced an empty value');
  }
  return 'checked';
};

const probeEmailTransport = (tenant: Tenant, deps: DeepHealthDeps): Probe => async () =>
  (await resolveTenantTransactionalTransport(tenant.id, deps.emailTransports)) === null
    ? 'not-applicable'
    : 'checked';

const probeStoragePresign = (tenant: Tenant, deps: DeepHealthDeps): Probe => async () => {
  const configuration = await resolveStorageConfiguration(tenant.id, deps.secretResolver);
  if (!configuration.ok) {
    if (configuration.error.code === 'integration_not_configured') return 'not-applicable';
    throw new ProbeFailure(`storage configuration failed with ${configuration.error.code}`);
  }
  const signed = deps.storage.presignGet({
    url: deps.storage.objectUrl(configuration.value, PRESIGN_PROBE_KEY).toString(),
    accessKeyId: configuration.value.accessKeyId,
    secretAccessKey: configuration.value.secretAccessKey,
    region: configuration.value.region,
    expiresInSeconds: PRESIGN_TTL_SECONDS,
  });
  if (!signed.ok) throw new ProbeFailure(`storage presign failed with ${signed.error.code}`);
  return 'checked';
};

const probeSchedulerFreshness = (deps: DeepHealthDeps): Probe => async () => {
  const runs = deps.schedulerRuns;
  if (runs === undefined) return 'not-applicable';
  const page = await runs.listPage({ limit: 1 });
  const last = page.runs[0];
  // A never-scheduled deployment (fresh database, self-host without cron) has
  // no age to compare; only a scheduler that ran and then stopped is a fault.
  if (last === undefined) return 'not-applicable';
  const ageMs = Date.parse(deps.clock.nowIso()) - Date.parse(last.startedAt);
  if (ageMs > SCHEDULER_MAX_AGE_MS) {
    throw new ProbeFailure(
      `the last scheduler run started ${String(Math.round(ageMs / 60_000))} minutes ago`,
    );
  }
  return 'checked';
};

export const checkDeepHealth = async (
  deps: DeepHealthDeps,
  budgetMs: number = DEEP_HEALTH_BUDGET_MS,
): Promise<DeepHealthReport> => {
  const recorder = createRecorder(budgetMs);
  let tenants: Tenant[] = [];
  await recorder.record('tenant-directory', async () => {
    tenants = await deps.tenantDirectory.listAll();
    return 'checked';
  });
  await recorder.record('scheduler-freshness', probeSchedulerFreshness(deps));
  for (const tenant of tenants) {
    await recorder.record('tenant-settings', probeTenantSettings(tenant, deps));
    await recorder.record('public-offer', probePublicOffer(tenant, deps));
    await recorder.record('course-content', probeCourseContent(tenant, deps));
    await recorder.record('tenant-secret-decryption', probeSecretDecryption(tenant, deps));
    await recorder.record('email-transport', probeEmailTransport(tenant, deps));
    await recorder.record('storage-presign', probeStoragePresign(tenant, deps));
  }
  const checks = recorder.checks();
  const failing = checks.filter((check) => !check.ok).map((check) => check.name);
  return {
    ok: failing.length === 0,
    checkedAt: deps.clock.nowIso(),
    tenants: tenants.length,
    failing,
    checks,
  };
};
