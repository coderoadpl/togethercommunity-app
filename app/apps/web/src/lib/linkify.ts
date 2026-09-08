interface TextSegment {
  text: string;
  href: string | null;
}

const trimUrl = (text: string): string => {
  let url = text.replace(/[.,!?;:]+$/u, '');
  for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']] as const) {
    while (url.endsWith(close) && url.split(close).length > url.split(open).length) {
      url = url.slice(0, -1).replace(/[.,!?;:]+$/u, '');
    }
  }
  return url;
};

export const linkify = (text: string): TextSegment[] => {
  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(/\b(?:https?:\/\/|www\.)[^\s<>"']+/giu)) {
    const url = trimUrl(match[0]);
    const href = /^www\./iu.test(url) ? `https://${url}` : url;
    try {
      new URL(href);
    } catch {
      continue;
    }
    if (match.index > cursor) segments.push({ text: text.slice(cursor, match.index), href: null });
    segments.push({ text: url, href });
    cursor = match.index + url.length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), href: null });
  return segments;
};
