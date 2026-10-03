import { z } from 'zod';

import type { TelemetryStoreView } from '#core/domain/telemetry.js';

export const createTelemetryEgressProbe = (input: {
  declaredIp?: string | undefined; endpoint?: string | undefined;
  fetcher?: typeof fetch; now?: () => number;
}): (() => Promise<TelemetryStoreView['egress']>) => {
  let cached: { at: number; result: TelemetryStoreView['egress'] } | undefined;
  return async () => {
    if (input.declaredIp !== undefined) return { mode: 'stable', ip: z.string().ip().parse(input.declaredIp) };
    if (input.endpoint === undefined) return { mode: 'unknown', ip: null };
    const now = input.now ?? Date.now;
    if (cached !== undefined && now() - cached.at < 5 * 60 * 1000) return cached.result;
    try {
      const addresses = [];
      for (let sample = 0; sample < 3; sample += 1) {
        const response = await (input.fetcher ?? fetch)(input.endpoint, { signal: AbortSignal.timeout(2000), redirect: 'error' });
        if (!response.ok) throw new Error('Egress probe failed');
        addresses.push(z.string().ip().parse((await response.text()).trim()));
      }
      // Repeated observations cannot guarantee a static address across deployment instances.
      const result: TelemetryStoreView['egress'] = { mode: new Set(addresses).size > 1 ? 'dynamic' : 'unknown', ip: null };
      cached = { at: now(), result };
      return result;
    } catch { return { mode: 'unknown', ip: null }; }
  };
};
