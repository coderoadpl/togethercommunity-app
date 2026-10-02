import { sanitizeRichText } from './rich-text-sanitizer.js';

const headingNodes = (html: string): { root: HTMLTemplateElement; nodes: HTMLElement[] } => {
  const root = document.createElement('template');
  root.innerHTML = html;
  return { root, nodes: [...root.content.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')] };
};

interface LessonHeadingAnchor {
  id: string;
  text: string;
}

interface LessonHeadingDocument {
  htmlBlocks: string[];
  headings: LessonHeadingAnchor[];
}

const safeHeadingIds = (ids: readonly string[]): string[] => {
  const used = new Set<string>();
  return ids.map((id) => {
    let attempt = 0;
    let candidate = id;
    while (used.has(candidate) || !sanitizeRichText(`<h1 id="${candidate}">x</h1>`).includes(`id="${candidate}"`)) {
      attempt += 1;
      const suffix = attempt === 1 ? '-section' : `-section-${String(attempt)}`;
      candidate = `${id.slice(0, 80 - suffix.length).replace(/-+$/g, '')}${suffix}`;
    }
    used.add(candidate);
    return candidate;
  });
};

export const lessonHeadingDocument = (
  htmlBlocks: readonly string[],
  createIds: (headings: readonly string[]) => string[],
): LessonHeadingDocument => {
  const documents = htmlBlocks.map((html) => headingNodes(sanitizeRichText(html)));
  const texts = documents.flatMap(({ nodes }) => nodes.map((node) => node.textContent?.trim() ?? ''));
  const ids = safeHeadingIds(createIds(texts));
  let index = 0;
  const headings: LessonHeadingAnchor[] = [];
  for (const { nodes } of documents) {
    for (const node of nodes) {
      const id = ids[index] ?? 'section';
      node.id = id;
      headings.push({ id, text: texts[index] ?? '' });
      index += 1;
    }
  }
  return {
    htmlBlocks: documents.map(({ root }) => sanitizeRichText(root.innerHTML)),
    headings,
  };
};
