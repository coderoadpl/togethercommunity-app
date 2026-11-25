import { err, notFound, ok, unavailable, type AppError, type Result } from '#core/domain/index.js';

// The link is a bearer capability, so no message below may carry it or a fetch error that could quote it.
export const fetchProposedFile = async (
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Result<ReadableStream<Uint8Array>, AppError>> => {
  let response: Response;
  try {
    response = await fetchImpl(url, { redirect: 'error', credentials: 'omit' });
  } catch {
    return err(unavailable('The proposed file could not be downloaded from the storage; nothing was written'));
  }
  if (response.status === 404) return err(notFound('The proposed file is no longer available; approving the proposal changes nothing'));
  if (!response.ok || response.body === null) {
    return err(unavailable(`The storage answered ${String(response.status)} for the proposed file; nothing was written`));
  }
  return ok(response.body);
};
