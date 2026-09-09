const NON_DECOMPOSING_LETTERS: Record<string, string> = {
  ł: 'l',
  ø: 'o',
  đ: 'd',
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  þ: 'th',
};

const transliterate = (value: string): string =>
  Object.entries(NON_DECOMPOSING_LETTERS).reduce(
    (transliterated, [letter, replacement]) => transliterated.replaceAll(letter, replacement),
    value,
  );

export interface SlugifyOptions {
  maxLength?: number;
}

export const slugify = (value: string, { maxLength }: SlugifyOptions = {}): string => {
  const slug = transliterate(value.toLowerCase())
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');

  return maxLength === undefined ? slug : slug.slice(0, maxLength).replace(/-+$/u, '');
};
