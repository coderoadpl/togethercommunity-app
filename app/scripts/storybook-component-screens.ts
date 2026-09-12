import { visible, type ScreenSpec } from './visual-screen-inventory.js';

const storyByScreen: ReadonlyMap<string, string> = new Map([
  ['markdown-editor-empty', 'forms-markdowneditor--empty'],
  ['markdown-editor-long-content', 'forms-markdowneditor--long-content'],
  ['markdown-editor-code', 'forms-markdowneditor--code'],
  ['markdown-editor-links', 'forms-markdowneditor--links'],
  ['markdown-editor-disabled', 'forms-markdowneditor--disabled'],
  ['markdown-editor-source', 'forms-markdowneditor--markdown-tab'],
]);

type ComponentScreenName = 'markdown-editor-empty' | 'markdown-editor-long-content' | 'markdown-editor-code' | 'markdown-editor-links' | 'markdown-editor-disabled' | 'markdown-editor-source';

const screen = (
  name: ComponentScreenName,
  viewport: 'desktop' | 'mobile',
  source = false,
): ScreenSpec => ({
  name,
  auth: 'creator',
  path: '',
  viewports: [viewport],
  minBytes: 4 * 1024,
  ready: async (page) => {
    await page.getByTestId(source ? 'story-markdown-editor-markdown' : 'story-markdown-editor-wysiwyg').waitFor(visible);
  },
});

export const componentScreens: readonly ScreenSpec[] = [
  screen('markdown-editor-empty', 'desktop'),
  screen('markdown-editor-long-content', 'mobile'),
  screen('markdown-editor-code', 'desktop'),
  screen('markdown-editor-links', 'mobile'),
  screen('markdown-editor-disabled', 'desktop'),
  screen('markdown-editor-source', 'mobile', true),
];

export const componentScreenNames = new Set(componentScreens.map((entry) => entry.name));

export const componentStoryId = (name: string): string | null =>
  storyByScreen.get(name) ?? null;
