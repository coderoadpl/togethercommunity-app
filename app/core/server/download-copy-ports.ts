import type { AppError, DownloadCopy, DownloadCopyQuery, Result } from '../domain/index.js';

export interface DownloadCopyRepository {
  create(tenantId: string, copy: DownloadCopy): Promise<boolean>;
  list(tenantId: string, query: DownloadCopyQuery): Promise<DownloadCopy[]>;
}

export interface DownloadCopyOrderReader {
  findLatestPaidOrderId(tenantId: string, memberId: string, productId: string): Promise<string | null>;
}

export interface DownloadPersonaliser {
  personalise(input: {
    contentType: string;
    bytes: Uint8Array;
    copyIdentifier: string;
    context: { maxBytes: number };
  }): Promise<Result<{ bytes: Uint8Array; contentType: string }, AppError>>;
}

export interface DownloadCopyCrypto {
  identifier(): string;
  hash(bytes: Uint8Array): string;
}

export interface PersonalisationSlots {
  acquire(): (() => void) | null;
}
