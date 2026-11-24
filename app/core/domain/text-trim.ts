export const trimTrailing = (value: string, characters: string): string => {
  let end = value.length;
  while (end > 0 && characters.includes(value.charAt(end - 1))) end -= 1;
  return value.slice(0, end);
};

export const trimSpacesBeforeLineBreaks = (value: string): string =>
  value.split('\n').map((line, index, lines) => (index === lines.length - 1 ? line : trimTrailing(line, ' \t'))).join('\n');
