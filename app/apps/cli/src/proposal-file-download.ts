import { access, open, rm, type FileHandle } from 'node:fs/promises';

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

const exists = (path: string): Promise<boolean> => access(path).then(() => true, () => false);

const refusedOverwrite = (out: string): AppError =>
  appError('conflict', `${out} already exists; nothing was downloaded. Pass --force to overwrite it`);

// The link is a bearer capability, so no message below may carry it or a fetch error that could quote it.
const fetchLink = async (url: string, fetchImpl: typeof fetch): Promise<Result<Response, AppError>> => {
  try {
    return ok(await fetchImpl(url, { redirect: 'error' }));
  } catch {
    return err(unavailable('The proposed file could not be downloaded from the storage; nothing was written'));
  }
};

const openTarget = async (out: string, force: boolean): Promise<Result<FileHandle, AppError>> => {
  try {
    return ok(await open(out, force ? 'w' : 'wx'));
  } catch (cause) {
    return err(cause instanceof Error && 'code' in cause && cause.code === 'EEXIST'
      ? refusedOverwrite(out)
      : unavailable(`Could not open ${out} for writing; nothing was downloaded`));
  }
};

const copyBody = async (body: ReadableStream<Uint8Array>, handle: FileHandle): Promise<Result<number, AppError>> => {
  let written = 0;
  try {
    const reader = body.getReader();
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return ok(written);
      await handle.write(chunk.value);
      written += chunk.value.byteLength;
    }
  } catch {
    return err(unavailable('The download of the proposed file was interrupted; nothing was kept'));
  } finally {
    await handle.close();
  }
};

export const saveProposedFile = async (
  link: ProposedFileLink,
  out: string,
  force: boolean,
  fetchImpl: typeof fetch = fetch,
): Promise<Result<SavedProposedFile, AppError>> => {
  if (!force && await exists(out)) return err(refusedOverwrite(out));
  const response = await fetchLink(link.url, fetchImpl);
  if (!response.ok) return response;
  if (response.value.status === 404) return err(notFound('The proposed file is no longer available; approving the proposal changes nothing'));
  if (!response.value.ok || response.value.body === null) {
    return err(unavailable(`The storage answered ${String(response.value.status)} for the proposed file; nothing was written`));
  }
  const handle = await openTarget(out, force);
  if (!handle.ok) return handle;
  const written = await copyBody(response.value.body, handle.value);
  if (written.ok && written.value === link.sizeBytes) return ok({ fileName: link.fileName, sizeBytes: written.value, out });
  await rm(out, { force: true });
  return written.ok
    ? err(unavailable(`The storage sent ${String(written.value)} bytes instead of ${String(link.sizeBytes)}; nothing was kept`))
    : written;
};
