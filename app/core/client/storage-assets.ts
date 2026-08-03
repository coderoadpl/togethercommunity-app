import {
  err,
  internal,
  type AppError,
  type Result,
} from '#core/domain/index.js';

interface StorageAssetUploadInput {
  fileName: string;
  body: BodyInit;
}

interface PresignedUpload {
  url: string;
  headers: Record<string, string>;
}

export const uploadPresignedStorageAsset = async <Started, Completed>(
  input: StorageAssetUploadInput,
  fetchImpl: typeof fetch,
  start: () => Promise<Result<Started, AppError>>,
  uploadFrom: (started: Started) => PresignedUpload,
  complete: (started: Started) => Promise<Result<Completed, AppError>>,
  signal?: AbortSignal,
): Promise<Result<Completed, AppError>> => {
  const started = await start();
  if (!started.ok) return started;
  const upload = uploadFrom(started.value);
  let uploaded: Response;
  try {
    uploaded = await fetchImpl(upload.url, {
      method: 'PUT',
      headers: upload.headers,
      body: input.body,
      signal: signal ?? null,
    });
  } catch (cause) {
    return err(internal(`Network error uploading ${input.fileName}: ${String(cause)}`));
  }
  if (!uploaded.ok) {
    return err(internal(`Storage rejected ${input.fileName} with HTTP ${String(uploaded.status)}`));
  }
  return complete(started.value);
};
