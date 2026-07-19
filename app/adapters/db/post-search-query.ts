/**
 * Prefix-matches the final term (`:*`) so a stem like `zmienn` reaches inflected forms
 * (`zmiennych`, `zmienna`); each term is stripped to letters/digits so a member's input can
 * never inject `to_tsquery` operators. Null means nothing searchable remained.
 */
export const buildPrefixTsquery = (raw: string): string | null => {
  const terms = raw
    .toLowerCase()
    .split(/\s+/u)
    .map((term) => term.replace(/[^\p{L}\p{N}]+/gu, ''))
    .filter((term) => term.length > 0);
  if (terms.length === 0) return null;
  return terms.map((term, index) => (index === terms.length - 1 ? `${term}:*` : term)).join(' & ');
};
