export const neutralizeFormula = (value: string): string =>
  /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;

export const quoteCsv = (value: string): string => `"${value.replaceAll('"', '""')}"`;
