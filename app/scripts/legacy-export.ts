import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MongoClient, ObjectId } from 'mongodb';
import { z } from 'zod';

import {
  collectOrphanContentAnomalies,
  dedupeProgress,
  legacyAccessItemSchema,
  legacyChapterSchema,
  legacyLessonContentSchema,
  legacyProgressSchema,
  legacyUserSchema,
  transformAccessItems,
  transformChapters,
  transformLessonContents,
  transformUser,
  type AccessItemLookups,
  type Anomaly,
  type PdfPointer,
  type VideoPointer,
} from './legacy-transform.js';
import { BackupArgError, resolveBackupsDir } from './legacy-export-args.js';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTAINER = 'together-import-mongo';
const MONGO_IMAGE = 'mongo:6';
const DUMP_DB = 'test';

const TENANT_SLUGS = ['coderoad', 'akademia-samouka'] as const;

const configSchema = z.object({
  streamLibraryId: z.string().min(1),
  pdfUrlPrefix: z.string().url(),
  tenantByCourseId: z.record(z.string().min(1), z.enum(TENANT_SLUGS)),
});

class ExportFailure extends Error {}

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

const run = (cmd: string, args: string[]): Promise<Run> =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: rootDir });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += String(chunk);
    });
    child.on('error', (cause) => resolve({ code: 1, stdout, stderr: `${stderr}${String(cause)}` }));
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });

const runOrFail = async (cmd: string, args: string[], what: string): Promise<Run> => {
  const result = await run(cmd, args);
  if (result.code !== 0) {
    throw new ExportFailure(`${what} failed (exit ${String(result.code)}):\n${result.stdout}${result.stderr}`);
  }
  return result;
};

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const newestBackup = (backupsDir: string): string => {
  const candidates = readdirSync(backupsDir)
    .filter((name) => name.endsWith('.tar.gz'))
    .sort();
  const newest = candidates.at(-1);
  if (newest === undefined) throw new ExportFailure(`No .tar.gz backups found in ${backupsDir}`);
  return join(backupsDir, newest);
};

const normalizeBson = (value: unknown): unknown => {
  if (value instanceof ObjectId) return value.toHexString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeBson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizeBson(entry)]),
    );
  }
  return value;
};

const objectIdString = z.string().min(1);

const legacyCourseSchema = z.object({
  _id: objectIdString,
  name: z.string().min(1),
  description: z.string().nullish(),
  modules: z.array(objectIdString).default([]),
  image: objectIdString.nullish(),
});

const legacyModuleSchema = z.object({
  _id: objectIdString,
  title: z.string().min(1),
  prefix: z.string().nullish(),
  name: z.string().nullish(),
  courses: z.array(objectIdString).default([]),
  chapters: z.array(legacyChapterSchema).default([]),
});

const legacyLessonSchema = z.object({
  _id: objectIdString,
  name: z.string().min(1),
  courseModules: z.array(objectIdString).default([]),
  contents: z.array(legacyLessonContentSchema).default([]),
});

const legacyVideoFileSchema = z.object({
  _id: objectIdString,
  key: z.string().nullish(),
  bunnyStreamVideoId: z.string().nullish(),
  bunnyStreamCollectionId: z.string().nullish(),
});

const legacyPdfFileSchema = z.object({
  _id: objectIdString,
  url: z.string().nullish(),
  name: z.string().nullish(),
  filename: z.string().nullish(),
  prefix: z.string().nullish(),
});

const legacyImageSchema = z.object({
  _id: objectIdString,
  url: z.string().nullish(),
});

const legacyAccessSchema = z.object({
  _id: objectIdString,
  name: z.string().min(1),
  items: z.array(legacyAccessItemSchema).default([]),
});

const legacyEnrollmentSchema = z.object({
  _id: objectIdString,
  user: objectIdString.nullish(),
  access: objectIdString.nullish(),
  startsAt: z.string().nullish(),
  expiresAt: z.string().nullish(),
});

type TenantSlug = (typeof TENANT_SLUGS)[number];

const startContainer = async (port: number): Promise<void> => {
  await run('docker', ['rm', '-f', CONTAINER]);
  await runOrFail(
    'docker',
    ['run', '--rm', '-d', '--name', CONTAINER, '-p', `${String(port)}:27017`, MONGO_IMAGE],
    'starting the throwaway mongo container',
  );
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const ping = await run('docker', [
      'exec',
      CONTAINER,
      'mongosh',
      '--quiet',
      '--eval',
      'db.runCommand({ ping: 1 }).ok',
    ]);
    if (ping.code === 0 && ping.stdout.includes('1')) return;
    await delay(500);
  }
  throw new ExportFailure('Throwaway mongo container did not become ready within 60s');
};

const restoreBackup = async (backupFile: string): Promise<void> => {
  await runOrFail('docker', ['cp', backupFile, `${CONTAINER}:/backup.tar.gz`], 'copying the backup');
  await runOrFail(
    'docker',
    ['exec', CONTAINER, 'bash', '-c', 'mkdir -p /restore && tar -xzf /backup.tar.gz -C /restore'],
    'extracting the backup',
  );
  const listing = await runOrFail(
    'docker',
    ['exec', CONTAINER, 'bash', '-c', 'ls /restore'],
    'listing the extracted backup',
  );
  const dumpRoot = listing.stdout.trim().split('\n')[0];
  if (dumpRoot === undefined || dumpRoot.length === 0) {
    throw new ExportFailure('Extracted backup is empty');
  }
  await runOrFail(
    'docker',
    ['exec', CONTAINER, 'mongorestore', '--quiet', `--nsInclude=${DUMP_DB}.*`, `/restore/${dumpRoot}`],
    'mongorestore',
  );
};

const stopContainer = async (): Promise<void> => {
  await run('docker', ['rm', '-f', CONTAINER]);
};

interface FileReport {
  count: number;
  sha256: string;
}

const writeJsonFile = (path: string, rows: unknown[]): FileReport => {
  const body = `${JSON.stringify(rows, null, 2)}\n`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  return { count: rows.length, sha256: createHash('sha256').update(body).digest('hex') };
};

const parseAll = <S extends z.ZodTypeAny>(
  schema: S,
  docs: unknown[],
  collection: string,
): z.output<S>[] =>
  docs.map((doc, index) => {
    const parsed = schema.safeParse(doc);
    if (!parsed.success) {
      throw new ExportFailure(
        `Could not parse ${collection}[${String(index)}]: ${parsed.error.message}\n${JSON.stringify(doc).slice(0, 500)}`,
      );
    }
    return parsed.data;
  });

const main = async (): Promise<void> => {
  const config = configSchema.parse(
    JSON.parse(readFileSync(join(rootDir, 'scripts/legacy-export.config.json'), 'utf8')),
  );
  const backupFile = newestBackup(resolveBackupsDir(process.argv.slice(2)));
  const port = 49100 + Math.floor(Math.random() * 800);
  const anomalies: Anomaly[] = [];

  console.log(`legacy-export: backup ${backupFile}`);
  console.log(`legacy-export: starting ${MONGO_IMAGE} on port ${String(port)}...`);
  await startContainer(port);
  const client = new MongoClient(`mongodb://127.0.0.1:${String(port)}`, {
    directConnection: true,
  });
  try {
    await restoreBackup(backupFile);
    await client.connect();
    const db = client.db(DUMP_DB);

    const collectionCounts: Record<string, number> = {};
    const collections = (await db.listCollections().toArray())
      .map((info) => info.name)
      .sort();
    for (const name of collections) {
      collectionCounts[name] = await db.collection(name).countDocuments();
    }

    const readAll = async (name: string): Promise<unknown[]> => {
      const docs = await db.collection(name).find({}).toArray();
      return docs.map(normalizeBson);
    };

    const courses = parseAll(legacyCourseSchema, await readAll('courses'), 'courses');
    const modules = parseAll(legacyModuleSchema, await readAll('course-modules'), 'course-modules');
    const lessons = parseAll(legacyLessonSchema, await readAll('course-lessons'), 'course-lessons');
    const videoFiles = parseAll(legacyVideoFileSchema, await readAll('video-files'), 'video-files');
    const pdfFiles = parseAll(legacyPdfFileSchema, await readAll('pdf-files'), 'pdf-files');
    const images = parseAll(legacyImageSchema, await readAll('course-images'), 'course-images');
    const accesses = parseAll(legacyAccessSchema, await readAll('accesses'), 'accesses');
    const enrollments = parseAll(
      legacyEnrollmentSchema,
      await readAll('enrollments'),
      'enrollments',
    );
    const users = parseAll(legacyUserSchema, await readAll('users'), 'users');
    const progressDocs = parseAll(
      legacyProgressSchema,
      await readAll('user-progresses'),
      'user-progresses',
    );

    const tenantByCourseId = new Map(Object.entries(config.tenantByCourseId));
    const courseIds = new Set(courses.map((course) => course._id));
    const unmapped = courses.filter((course) => !tenantByCourseId.has(course._id));
    if (unmapped.length > 0) {
      const listing = unmapped
        .map((course) => `  ${course._id}  ${course.name}`)
        .join('\n');
      throw new ExportFailure(
        `Unmapped courses in the dump; add them to scripts/legacy-export.config.json tenantByCourseId:\n${listing}`,
      );
    }
    for (const configuredId of tenantByCourseId.keys()) {
      if (!courseIds.has(configuredId)) {
        anomalies.push({
          kind: 'config-course-not-in-dump',
          subject: `courses/${configuredId}`,
          detail: 'configured course id does not exist in the dump',
        });
      }
    }

    const courseIdsByModuleId = new Map<string, Set<string>>();
    const addModuleCourse = (moduleId: string, courseId: string): void => {
      const set = courseIdsByModuleId.get(moduleId) ?? new Set<string>();
      set.add(courseId);
      courseIdsByModuleId.set(moduleId, set);
    };
    const moduleIds = new Set(modules.map((module) => module._id));
    for (const module of modules) {
      for (const courseId of module.courses) {
        if (!courseIds.has(courseId)) {
          anomalies.push({
            kind: 'dangling-course-ref',
            subject: `course-modules/${module._id}`,
            detail: `module references missing course ${courseId}`,
          });
          continue;
        }
        addModuleCourse(module._id, courseId);
      }
    }
    for (const course of courses) {
      for (const moduleId of course.modules) {
        if (!moduleIds.has(moduleId)) {
          anomalies.push({
            kind: 'dangling-module-ref',
            subject: `courses/${course._id}`,
            detail: `course lists missing module ${moduleId}`,
          });
          continue;
        }
        addModuleCourse(moduleId, course._id);
      }
    }

    const lessonIds = new Set(lessons.map((lesson) => lesson._id));
    const moduleIdsByLessonId = new Map<string, Set<string>>();
    const addLessonModule = (lessonId: string, moduleId: string): void => {
      const set = moduleIdsByLessonId.get(lessonId) ?? new Set<string>();
      set.add(moduleId);
      moduleIdsByLessonId.set(lessonId, set);
    };
    for (const lesson of lessons) {
      for (const moduleId of lesson.courseModules) {
        if (moduleIds.has(moduleId)) addLessonModule(lesson._id, moduleId);
      }
    }
    for (const module of modules) {
      for (const chapter of module.chapters) {
        for (const content of chapter.contents) {
          if (content.courseLesson === undefined || content.courseLesson === null) continue;
          if (!lessonIds.has(content.courseLesson)) {
            anomalies.push({
              kind: 'dangling-lesson-ref',
              subject: `course-modules/${module._id}`,
              detail: `chapter ${chapter.id} content ${content.id} references missing lesson ${content.courseLesson}`,
            });
            continue;
          }
          addLessonModule(content.courseLesson, module._id);
        }
      }
    }

    const tenantsOfCourse = (courseId: string): Set<TenantSlug> => {
      const slug = tenantByCourseId.get(courseId);
      return slug === undefined ? new Set<TenantSlug>() : new Set([slug]);
    };
    const tenantsOfModule = (moduleId: string): Set<TenantSlug> => {
      const slugs = new Set<TenantSlug>();
      for (const courseId of courseIdsByModuleId.get(moduleId) ?? []) {
        for (const slug of tenantsOfCourse(courseId)) slugs.add(slug);
      }
      return slugs;
    };
    const tenantsOfLesson = (lessonId: string): Set<TenantSlug> => {
      const slugs = new Set<TenantSlug>();
      for (const moduleId of moduleIdsByLessonId.get(lessonId) ?? []) {
        for (const slug of tenantsOfModule(moduleId)) slugs.add(slug);
      }
      return slugs;
    };

    anomalies.push(
      ...collectOrphanContentAnomalies({
        modules: modules.map((module) => ({ id: module._id, title: module.title })),
        lessons: lessons.map((lesson) => ({ id: lesson._id, title: lesson.name })),
        courseIdsByModuleId,
        moduleIdsByLessonId,
        mappedCourseIds: new Set(tenantByCourseId.keys()),
      }),
    );

    const videoById = new Map<string, VideoPointer>();
    for (const video of videoFiles) {
      const key = video.key ?? '';
      if (key.length === 0) {
        anomalies.push({
          kind: 'video-without-key',
          subject: `video-files/${video._id}`,
          detail: 'video file has no storage key; lesson blocks referencing it are dropped',
        });
        continue;
      }
      videoById.set(video._id, {
        key,
        bunnyStreamVideoId: video.bunnyStreamVideoId,
        bunnyStreamCollectionId: video.bunnyStreamCollectionId,
      });
    }
    const pdfById = new Map<string, PdfPointer>();
    for (const pdf of pdfFiles) {
      // Payload never persists the pdf url (it is a virtual field computed from
      // staticURL + filename), so the S3 object URL is reconstructed here.
      const filename = pdf.filename ?? '';
      const url =
        pdf.url ??
        (filename.length > 0
          ? `${config.pdfUrlPrefix}/${encodeURIComponent(filename)}`
          : null);
      if (url === null) {
        anomalies.push({
          kind: 'pdf-without-url',
          subject: `pdf-files/${pdf._id}`,
          detail: 'pdf file has neither a stored url nor a filename',
        });
      }
      pdfById.set(pdf._id, { url, name: pdf.name ?? pdf.filename });
    }
    const imageById = new Map(images.map((image) => [image._id, image.url ?? null]));

    const accessLookups: AccessItemLookups = { courseIdsByModuleId, moduleIdsByLessonId };

    const usersById = new Map(users.map((user) => [user._id, user]));
    const accessById = new Map(accesses.map((access) => [access._id, access]));

    const accessItemsByAccessId = new Map<string, ReturnType<typeof transformAccessItems>>();
    for (const access of accesses) {
      accessItemsByAccessId.set(
        access._id,
        transformAccessItems(access._id, access.items, accessLookups),
      );
    }
    const tenantsOfAccess = (accessId: string): Set<TenantSlug> => {
      const slugs = new Set<TenantSlug>();
      const transformed = accessItemsByAccessId.get(accessId);
      for (const item of transformed?.items ?? []) {
        for (const slug of tenantsOfCourse(item.courseId)) slugs.add(slug);
      }
      return slugs;
    };

    const { kept: dedupedProgress, anomalies: progressAnomalies } = dedupeProgress(progressDocs);
    anomalies.push(...progressAnomalies);

    const tenantUserIds = new Map<TenantSlug, Set<string>>(
      TENANT_SLUGS.map((slug) => [slug, new Set<string>()]),
    );
    interface GrantRow {
      legacyId: string;
      memberLegacyId: string;
      productLegacyId: string;
      startsAt: string | null;
      expiresAt: string | null;
    }
    const tenantGrants = new Map<TenantSlug, GrantRow[]>(TENANT_SLUGS.map((slug) => [slug, []]));
    const grantPairSeen = new Map<TenantSlug, Set<string>>(
      TENANT_SLUGS.map((slug) => [slug, new Set<string>()]),
    );
    for (const enrollment of enrollments) {
      const subject = `enrollments/${enrollment._id}`;
      const userId = enrollment.user ?? '';
      const accessId = enrollment.access ?? '';
      if (userId.length === 0 || accessId.length === 0) {
        anomalies.push({
          kind: 'enrollment-missing-refs',
          subject,
          detail: 'enrollment lacks a user or access reference and was dropped',
        });
        continue;
      }
      if (!usersById.has(userId)) {
        anomalies.push({
          kind: 'dangling-user-ref',
          subject,
          detail: `enrollment references missing user ${userId} and was dropped`,
        });
        continue;
      }
      if (!accessById.has(accessId)) {
        anomalies.push({
          kind: 'dangling-access-ref',
          subject,
          detail: `enrollment references missing access ${accessId} and was dropped`,
        });
        continue;
      }
      const slugs = tenantsOfAccess(accessId);
      if (slugs.size === 0) {
        anomalies.push({
          kind: 'enrollment-without-tenant',
          subject,
          detail: `access ${accessId} touches no mapped course; enrollment was dropped`,
        });
        continue;
      }
      if (enrollment.startsAt === undefined || enrollment.startsAt === null ||
          enrollment.expiresAt === undefined || enrollment.expiresAt === null) {
        anomalies.push({
          kind: 'enrollment-missing-dates',
          subject,
          detail: 'enrollment lacks startsAt or expiresAt; exported verbatim as null',
        });
      }
      for (const slug of slugs) {
        tenantUserIds.get(slug)?.add(userId);
        const pairKey = `${userId}::${accessId}`;
        const seen = grantPairSeen.get(slug);
        if (seen?.has(pairKey) === true) {
          anomalies.push({
            kind: 'duplicate-grant-pair',
            subject,
            detail: `another enrollment already grants access ${accessId} to user ${userId} in ${slug}`,
          });
        }
        seen?.add(pairKey);
        tenantGrants.get(slug)?.push({
          legacyId: enrollment._id,
          memberLegacyId: userId,
          productLegacyId: accessId,
          startsAt: enrollment.startsAt ?? null,
          expiresAt: enrollment.expiresAt ?? null,
        });
      }
    }

    const assignedUserIds = new Set(
      [...tenantUserIds.values()].flatMap((ids) => [...ids]),
    );
    for (const user of users) {
      if (!assignedUserIds.has(user._id)) {
        anomalies.push({
          kind: 'user-without-tenant',
          subject: `users/${user._id}`,
          detail: `user ${user.email} holds no enrollment touching a mapped course and was not exported`,
        });
      }
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outDir = join(rootDir, 'out/legacy-export', timestamp);
    const files: Record<string, Record<string, FileReport>> = {};

    for (const slug of TENANT_SLUGS) {
      const tenantDir = join(outDir, 'tenants', slug);
      const tenantCourses = courses
        .filter((course) => tenantByCourseId.get(course._id) === slug)
        .sort((a, b) => a._id.localeCompare(b._id));
      const courseRows = tenantCourses.map((course) => {
        const imageUrl = course.image === undefined || course.image === null
          ? null
          : imageById.get(course.image) ?? null;
        if (course.image !== undefined && course.image !== null && !imageById.has(course.image)) {
          anomalies.push({
            kind: 'dangling-image-ref',
            subject: `courses/${course._id}`,
            detail: `course references missing image ${course.image}`,
          });
        }
        return {
          legacyId: course._id,
          name: course.name,
          description: course.description ?? '',
          imageUrl,
          moduleOrder: course.modules,
        };
      });

      const tenantModules = modules
        .filter((module) => tenantsOfModule(module._id).has(slug))
        .sort((a, b) => a._id.localeCompare(b._id));
      const moduleRows = tenantModules.map((module) => {
        const { chapters, anomalies: chapterAnomalies } = transformChapters(
          module._id,
          module.chapters,
        );
        anomalies.push(...chapterAnomalies);
        return {
          legacyId: module._id,
          courseLegacyIds: [...(courseIdsByModuleId.get(module._id) ?? [])]
            .filter((courseId) => tenantByCourseId.get(courseId) === slug)
            .sort(),
          title: module.title,
          prefix: module.prefix ?? null,
          name: module.name ?? module.title,
          chapters,
        };
      });

      const tenantLessons = lessons
        .filter((lesson) => tenantsOfLesson(lesson._id).has(slug))
        .sort((a, b) => a._id.localeCompare(b._id));
      const lessonRows = tenantLessons.map((lesson) => {
        const { blocks, anomalies: blockAnomalies } = transformLessonContents(
          lesson._id,
          lesson.contents,
          { videoById, pdfById, streamLibraryId: config.streamLibraryId },
        );
        anomalies.push(...blockAnomalies);
        return { legacyId: lesson._id, name: lesson.name, contents: blocks };
      });

      const tenantAccesses = accesses
        .filter((access) => tenantsOfAccess(access._id).has(slug))
        .sort((a, b) => a._id.localeCompare(b._id));
      const productRows = tenantAccesses.map((access) => {
        const transformed = accessItemsByAccessId.get(access._id);
        const slugsTouched = tenantsOfAccess(access._id);
        if (slugsTouched.size > 1) {
          anomalies.push({
            kind: 'cross-tenant-access',
            subject: `accesses/${access._id}`,
            detail: `access "${access.name}" touches ${[...slugsTouched].sort().join(' and ')}; items were split per tenant`,
          });
        }
        return {
          legacyId: access._id,
          title: access.name,
          accessItems: (transformed?.items ?? []).filter(
            (item) => tenantByCourseId.get(item.courseId) === slug,
          ),
        };
      });

      const memberIds = [...(tenantUserIds.get(slug) ?? [])].sort();
      const userRows: unknown[] = [];
      const memberRows: unknown[] = [];
      for (const userId of memberIds) {
        const legacyUser = usersById.get(userId);
        if (legacyUser === undefined) continue;
        const { user, anomalies: userAnomalies } = transformUser(legacyUser);
        anomalies.push(...userAnomalies);
        userRows.push(user);
        memberRows.push({ legacyId: user.legacyId, email: user.email, displayName: user.name });
      }

      const grantRows = (tenantGrants.get(slug) ?? []).sort((a, b) =>
        a.legacyId.localeCompare(b.legacyId),
      );

      const tenantMemberIds = tenantUserIds.get(slug) ?? new Set<string>();
      const progressRows = dedupedProgress
        .flatMap((progress) => {
          const courseId = progress.course ?? '';
          const userId = progress.user ?? '';
          if (tenantByCourseId.get(courseId) !== slug) return [];
          if (!courseIds.has(courseId)) return [];
          if (!tenantMemberIds.has(userId)) {
            anomalies.push({
              kind: 'progress-without-membership',
              subject: `user-progresses/${progress._id}`,
              detail: `user ${userId} has progress in course ${courseId} but no enrollment in ${slug}; dropped`,
            });
            return [];
          }
          return [
            {
              legacyId: progress._id,
              userLegacyId: userId,
              courseLegacyId: courseId,
              lastViewedLessonId: progress.lastViewedLesson ?? null,
              lastViewedModuleId: progress.lastViewedModule ?? null,
              lastViewedChapterId: progress.lastViewedChapter ?? null,
              completedLessonIds: [...new Set(progress.completedLessons)],
              updatedAt: progress.updatedAt ?? null,
            },
          ];
        })
        .sort((a, b) => a.legacyId.localeCompare(b.legacyId));

      files[slug] = {
        'courses.json': writeJsonFile(join(tenantDir, 'courses.json'), courseRows),
        'modules.json': writeJsonFile(join(tenantDir, 'modules.json'), moduleRows),
        'lessons.json': writeJsonFile(join(tenantDir, 'lessons.json'), lessonRows),
        'products.json': writeJsonFile(join(tenantDir, 'products.json'), productRows),
        'users.json': writeJsonFile(join(tenantDir, 'users.json'), userRows),
        'members.json': writeJsonFile(join(tenantDir, 'members.json'), memberRows),
        'grants.json': writeJsonFile(join(tenantDir, 'grants.json'), grantRows),
        'progress.json': writeJsonFile(join(tenantDir, 'progress.json'), progressRows),
      };
    }

    const exportedCollections = [
      'courses',
      'course-modules',
      'course-lessons',
      'video-files',
      'pdf-files',
      'course-images',
      'accesses',
      'enrollments',
      'users',
      'user-progresses',
    ];
    const manifest = {
      generatedAt: new Date().toISOString(),
      backupFile,
      mongoImage: MONGO_IMAGE,
      database: DUMP_DB,
      streamLibraryId: config.streamLibraryId,
      collectionCounts,
      skippedCollections: Object.keys(collectionCounts).filter(
        (name) => !exportedCollections.includes(name),
      ),
      tenants: files,
      anomalies,
    };
    const manifestPath = join(outDir, 'manifest.json');
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    console.log(`legacy-export: bundle written to ${outDir}`);
    console.log(`legacy-export: ${String(anomalies.length)} anomalies recorded in the manifest`);
    for (const slug of TENANT_SLUGS) {
      const reports = files[slug];
      if (reports === undefined) continue;
      const summary = Object.entries(reports)
        .map(([file, report]) => `${file.replace('.json', '')}=${String(report.count)}`)
        .join(' ');
      console.log(`legacy-export: ${slug}: ${summary}`);
    }
  } finally {
    await client.close().catch(() => undefined);
    await stopContainer();
  }
};

try {
  await main();
} catch (error) {
  if (error instanceof ExportFailure || error instanceof BackupArgError) {
    console.error(`legacy-export: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
