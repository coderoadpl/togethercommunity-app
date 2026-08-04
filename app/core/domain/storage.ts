import { z } from 'zod';

export const storageProviderKindSchema = z.enum([
  'aws_s3',
  'cloudflare_r2',
  'backblaze_b2',
  'minio',
]);

export type StorageProviderKind = z.infer<typeof storageProviderKindSchema>;

const storageEndpointSchema = z.string().url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === 'http:' || protocol === 'https:';
});

export const storageConfigurationSchema = z.object({
  provider: storageProviderKindSchema,
  endpoint: storageEndpointSchema,
  region: z.string().trim().min(1).max(64),
  bucket: z.string().trim().min(1).max(255).regex(/^[A-Za-z0-9][A-Za-z0-9.-]*$/),
  accessKeyId: z.string().trim().min(1).max(512),
  secretAccessKey: z.string().min(1).max(2048),
});

export type StorageConfiguration = z.infer<typeof storageConfigurationSchema>;

export const STORAGE_PROBE_ERROR_CODES = [
  'storage.wrong_region',
  'storage.credentials',
  'storage.bucket',
  'storage.cors',
  'storage.unavailable',
] as const;

export type StorageProbeErrorCode = (typeof STORAGE_PROBE_ERROR_CODES)[number];
