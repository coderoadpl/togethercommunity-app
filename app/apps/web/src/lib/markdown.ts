const bareUrls = /\b(?:https?:\/\/|mailto:|www\.)[^\s<>"']+/giu;
const leadingWhitespace = /^[ \t]+/u;

const escapeInline = (value: string): string =>
  value
    .replaceAll('\\', '\\\\')
    .replaceAll('&', '&amp;')
    .replace(/([`*_[\]<>~|])/gu, '\\$1');

// A bare URL is autolinked verbatim, so a backslash inside it would land in the destination; a
// scheme-less one additionally needs the explicit https destination the plain renderer gives it.
const escapeAroundUrls = (line: string): string => {
  const chunks: string[] = [];
  let cursor = 0;
  for (const match of line.matchAll(bareUrls)) {
    const url = match[0];
    chunks.push(escapeInline(line.slice(cursor, match.index)));
    if (url.toLowerCase().startsWith('www.')) {
      const visible = url.replace(/[.,!?;:]+$/u, '');
      chunks.push(`[${escapeInline(visible)}](https://${visible})`, escapeInline(url.slice(visible.length)));
    } else chunks.push(url);
    cursor = match.index + url.length;
  }
  chunks.push(escapeInline(line.slice(cursor)));
  return chunks.join('');
};

const indentWidth = (run: string): number =>
  [...run].reduce((width, char) => width + (char === '\t' ? 4 : 1), 0);

// Four columns of leading whitespace would open an indented code block, and no backslash escape
// exists for a space, so the first one becomes a non-breaking space of the same width.
const escapeIndent = (line: string): string => {
  const run = leadingWhitespace.exec(line)?.[0] ?? '';
  if (run === line || indentWidth(run) < 4) return line;
  return `\u00a0${line.slice(1)}`;
};

export const escapePlainTextForMarkdown = (value: string): string =>
  value
    .split('\n')
    .map((line) =>
      escapeIndent(escapeAroundUrls(line))
        .replace(/^(\s{0,3})(#{1,6}|>|[-+])(?=\s|$)/u, '$1\\$2')
        .replace(/^(\s{0,3}\d+)([.)])(?=\s|$)/u, '$1\\$2')
        .replace(/^(\s{0,3})(?=(?:-{1,}|={1,}|_{3,})\s*$)/u, '$1\\'),
    )
    .join('\n');
