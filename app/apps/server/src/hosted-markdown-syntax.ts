export const headingPattern = /^(#{1,6})\s+(\S.*|[^\S\n\r\u2028\u2029])$/;

export const listItemPattern = /^(\s*)(?:[-*+]|(\d{1,9})[.)])\s+(\S.*|)$/;

export interface InlineLink {
  index: number;
  length: number;
  image: boolean;
  label: string;
  target: string;
}

const WHITESPACE = /\s/;

export const inlineLinks = (source: string): InlineLink[] => {
  const links: InlineLink[] = [];
  let close = -1;
  let targetEnd = -1;
  const linkFrom = (open: number): { label: string; target: string; end: number } | null => {
    if (close <= open) {
      const found = source.indexOf(']', open + 1);
      close = found === -1 ? source.length : found;
    }
    if (close === source.length || close === open + 1 || source.charAt(close + 1) !== '(') return null;
    const targetStart = close + 2;
    if (targetEnd < targetStart) {
      targetEnd = targetStart;
      while (targetEnd < source.length && source.charAt(targetEnd) !== ')' && !WHITESPACE.test(source.charAt(targetEnd))) targetEnd += 1;
    }
    if (targetEnd === targetStart || source.charAt(targetEnd) !== ')') return null;
    return { label: source.slice(open + 1, close), target: source.slice(targetStart, targetEnd), end: targetEnd + 1 };
  };
  let position = 0;
  while (position < source.length) {
    const image = source.charAt(position) === '!' && source.charAt(position + 1) === '[';
    const link = image ? linkFrom(position + 1) : source.charAt(position) === '[' ? linkFrom(position) : null;
    if (link === null) {
      position += 1;
      continue;
    }
    links.push({ index: position, length: link.end - position, image, label: link.label, target: link.target });
    position = link.end;
  }
  return links;
};
