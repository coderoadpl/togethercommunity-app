import { access, link, open, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { appError, err, notFound, ok, unavailable, type AppError, type Result } from '#core/domain/index.js';

export interface ProposedFileLink {
  url: string;
  fileName: string;
  sizeBytes: number;
}

export interface SavedProposedFile {
  fileName: string;
  sizeBytes: number;
  out: string;
}

interface ProposedFileHandle {
  write(buffer: Uint8Array, offset: number, length: number): Promise<{ bytesWritten: number }>;
  close(): Promise<void>;
}

/** The file system calls the download makes, so a test can make a write fall short. */
export interface ProposedFileSystem {
  exists(path: string): Promise<boolean>;
  openExclusive(path: string): Promise<ProposedFileHandle>;
  /** Fails with `EEXIST` when `to` exists, and never changes it then. */
  linkNew(from: string, to: string): Promise<void>;
  replace(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
}

const nodeFileSystem: ProposedFileSystem = {
  exists: (path) => access(path).then(() => true, () => false),
  openExclusive: (path) => open(path, 'wx', 0o600),
  linkNew: (from, to) => link(from, to),
  replace: (from, to) => rename(from, to),
  remove: (path) => rm(path, { force: true }),
};

const refusedOverwrite = (out: string): AppError =>
  appError('conflict', `${out} already exists; nothing was downloaded. Pass --force to overwrite it`);

const errorCode = (cause: unknown): unknown => cause instanceof Error && 'code' in cause ? cause.code : undefined;

// The link is a bearer capability, so no message below may carry it or a fetch error that could quote it.
const fetchLink = async (url: string, fetchImpl: typeof fetch): Promise<Result<Response, AppError>> => {
  try {
    return ok(await fetchImpl(url, { redirect: 'error' }));
  } catch {
    return err(unavailable('The proposed file could not be downloaded from the storage; nothing was written'));
  }
};

const interrupted = (out: string): AppError =>
  unavailable(`The download of the proposed file was interrupted; ${out} was not changed`);

const writeFully = async (handle: ProposedFileHandle, chunk: Uint8Array): Promise<number> => {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset);
    if (bytesWritten <= 0) throw new Error('The file system wrote no bytes');
    offset += bytesWritten;
  }
  return offset;
};

const copyBody = async (body: ReadableStream<Uint8Array>, handle: ProposedFileHandle, out: string): Promise<Result<number, AppError>> => {
  let written = 0;
  try {
    const reader = body.getReader();
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return ok(written);
      written += await writeFully(handle, chunk.value);
    }
  } catch {
    return err(interrupted(out));
  } finally {
    await handle.close();
  }
};

const settle = async (temporary: string, out: string, force: boolean, files: ProposedFileSystem): Promise<Result<void, AppError>> => {
  try {
    if (force) {
      await files.replace(temporary, out);
      return ok(undefined);
    }
    await files.linkNew(temporary, out);
    return ok(undefined);
  } catch (cause) {
    return err(errorCode(cause) === 'EEXIST' ? refusedOverwrite(out) : unavailable(`Could not move the download onto ${out}; it was not changed`));
  }
};

/**
 * Writes to a new sibling file and moves it onto `out` only once every byte was written and the count is the announced
 * size, so a failure never truncates or removes an existing `out` and an interrupted run never leaves a short file
 * under its name.
 */
export const saveProposedFile = async (
  proposedLink: ProposedFileLink,
  out: string,
  force: boolean,
  fetchImpl: typeof fetch = fetch,
  files: ProposedFileSystem = nodeFileSystem,
): Promise<Result<SavedProposedFile, AppError>> => {
  if (!force && await files.exists(out)) return err(refusedOverwrite(out));
  const response = await fetchLink(proposedLink.url, fetchImpl);
  if (!response.ok) return response;
  if (response.value.status === 404) return err(notFound('The proposed file is no longer available; approving the proposal changes nothing'));
  if (!response.value.ok || response.value.body === null) {
    return err(unavailable(`The storage answered ${String(response.value.status)} for the proposed file; nothing was written`));
  }
  const temporary = join(dirname(out), `.${basename(out)}.partial-${crypto.randomUUID()}`);
  let handle: ProposedFileHandle;
  try {
    handle = await files.openExclusive(temporary);
  } catch {
    return err(unavailable(`Could not open a file next to ${out} for writing; nothing was downloaded`));
  }
  try {
    const written = await copyBody(response.value.body, handle, out);
    if (!written.ok) return written;
    if (written.value !== proposedLink.sizeBytes) {
      return err(unavailable(`The storage sent ${String(written.value)} bytes instead of ${String(proposedLink.sizeBytes)}; ${out} was not changed`));
    }
    const settled = await settle(temporary, out, force, files);
    return settled.ok ? ok({ fileName: proposedLink.fileName, sizeBytes: written.value, out }) : settled;
  } finally {
    await files.remove(temporary);
  }
};
