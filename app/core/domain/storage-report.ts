import { z } from 'zod';

import { storageConfigurationSchema } from './storage.js';

export const storageListInputSchema = z.object({
  configuration: storageConfigurationSchema,
  prefix: z.string().min(1),
  continuationToken: z.string().min(1).nullable(),
  limit: z.number().int().min(1).max(1000),
});

const storageListedObjectSchema = z.object({
  key: z.string().min(1),
  sizeBytes: z.number().int().nonnegative().safe(),
  lastModified: z.string().datetime({ offset: true }),
});

export const storageListPageSchema = z.object({
  objects: z.array(storageListedObjectSchema).max(1000),
  continuationToken: z.string().min(1).nullable(),
});

export type StorageListInput = z.infer<typeof storageListInputSchema>;
export type StorageListPage = z.infer<typeof storageListPageSchema>;
export type StorageListedObject = z.infer<typeof storageListedObjectSchema>;

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(jsonValueSchema),
]));

export const storageReferenceInventorySchema = z.object({
  lessonIds: z.array(z.string().min(1)),
  productIds: z.array(z.string().min(1)),
  attachments: z.array(z.object({
    storageKey: z.string().min(1),
    status: z.enum(['pending', 'ready']),
  })),
  downloads: z.array(z.object({
    storageKey: z.string().min(1),
    status: z.enum(['pending', 'ready']),
    supersededAt: z.string().nullable(),
  })),
  currentDocuments: z.array(jsonValueSchema),
  historyDocuments: z.array(jsonValueSchema),
});

export type StorageReferenceInventory = z.infer<typeof storageReferenceInventorySchema>;

export const storageOrphanReportInputSchema = z.object({
  tenantId: z.string().min(1).max(255).regex(/^[A-Za-z0-9_-]+$/),
  graceHours: z.number().finite().nonnegative().max(876000).default(24),
  maxPages: z.number().int().min(1).max(10000).default(1000),
});

export type StorageObjectClassification =
  | 'referenced'
  | 'referenced-by-history'
  | 'pending'
  | 'within-grace-period'
  | 'unreferenced-candidate'
  | 'unknown-owner';

export interface StorageOrphanReport {
  tenantId: string;
  generatedAt: string;
  graceHours: number;
  complete: boolean;
  pagesScanned: number;
  summary: Record<StorageObjectClassification, number>;
  objects: Array<StorageListedObject & { classification: StorageObjectClassification }>;
  limitations: string[];
}
