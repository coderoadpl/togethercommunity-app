export const formatValidityTime = (instant: string | null, timeZone: string): string => {
  if (instant === null) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant));
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
};

export const parseValidityTime = (value: string, timeZone: string): string | null | undefined => {
  if (value === '') return null;
  const wallTime = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(wallTime)) return undefined;
  let instant = wallTime;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const displayed = Date.parse(`${formatValidityTime(new Date(instant).toISOString(), timeZone)}:00Z`);
    instant += wallTime - displayed;
  }
  const result = new Date(instant).toISOString();
  return formatValidityTime(result, timeZone) === value ? result : undefined;
};
