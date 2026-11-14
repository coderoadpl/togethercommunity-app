import { safeLogMessage } from '#core/server/log-safety.js';
import { dispatchMetaCapi, type MetaCapiDispatchDeps } from '#core/server/usecases/meta-capi.js';

const running = new WeakSet<MetaCapiDispatchDeps>();

export const runMetaCapiDispatch = async (
  deps: MetaCapiDispatchDeps | undefined,
  logger: { warn(message: string): void },
  source: 'cron' | 'node ticker',
): Promise<void> => {
  if (deps === undefined || running.has(deps)) return;
  running.add(deps);
  try {
    await dispatchMetaCapi(deps);
  } catch {
    logger.warn(safeLogMessage(`[meta-capi] ${source} dispatch_failed`));
  } finally {
    running.delete(deps);
  }
};
