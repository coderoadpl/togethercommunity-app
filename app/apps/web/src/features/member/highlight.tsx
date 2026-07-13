import type { ReactNode } from 'react';

import { SearchHighlight } from '../../theme.js';

export const Highlighted = ({ text, query }: { text: string; query: string }): ReactNode => {
  if (query === '') return text;
  const needle = query.toLowerCase();
  const haystack = text.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const hit = haystack.indexOf(needle, cursor);
    if (hit === -1) {
      parts.push(text.slice(cursor));
      break;
    }
    if (hit > cursor) parts.push(text.slice(cursor, hit));
    const end = hit + needle.length;
    parts.push(<SearchHighlight key={hit}>{text.slice(hit, end)}</SearchHighlight>);
    cursor = end;
  }
  return parts.map((part, index) => <span key={index}>{part}</span>);
};
