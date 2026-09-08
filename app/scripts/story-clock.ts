import { visualSeedTime } from './visual-request-policy.js';

export const installStoryClock = (): (() => void) => {
  const OriginalDate = globalThis.Date;
  const frozenNow = OriginalDate.parse(visualSeedTime);
  const StoryDate = new Proxy(OriginalDate, {
    construct: (target, args: unknown[]) => Reflect.construct(target, args.length === 0 ? [frozenNow] : args),
    apply: () => new OriginalDate(frozenNow).toString(),
    get: (target, property, receiver) => property === 'now' ? () => frozenNow : Reflect.get(target, property, receiver),
  });
  globalThis.Date = StoryDate;
  return () => { globalThis.Date = OriginalDate; };
};
