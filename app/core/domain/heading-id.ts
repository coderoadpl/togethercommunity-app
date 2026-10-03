const MAX_HEADING_ID_LENGTH = 80;

const headingIdBase = (text: string): string => {
  const normalized = text
    .replace(/[\u0142\u0141]/g, (letter) => letter === '\u0141' ? 'L' : 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const truncated = normalized.slice(0, MAX_HEADING_ID_LENGTH).replace(/-+$/g, '');
  return truncated === '' ? 'section' : truncated;
};

export const headingIds = (headings: readonly string[]): string[] => {
  const nextSuffix = new Map<string, number>();
  const used = new Set<string>();
  return headings.map((heading) => {
    const base = headingIdBase(heading);
    if (!used.has(base)) {
      used.add(base);
      return base;
    }
    let suffixNumber = nextSuffix.get(base) ?? 2;
    let candidate = '';
    do {
      const suffix = `-${String(suffixNumber)}`;
      candidate = `${base.slice(0, MAX_HEADING_ID_LENGTH - suffix.length).replace(/-+$/g, '')}${suffix}`;
      suffixNumber += 1;
    } while (used.has(candidate));
    nextSuffix.set(base, suffixNumber);
    used.add(candidate);
    return candidate;
  });
};
