import { visible, type ScreenSpec } from './visual-screen-inventory.js';

const storyByScreen: ReadonlyMap<string, string> = new Map([
  ['lesson-editions-light-desktop', 'member-lessoneditions--light-desktop'],
  ['lesson-editions-light-mobile', 'member-lessoneditions--light-mobile'],
  ['lesson-editions-dark-desktop', 'member-lessoneditions--dark-desktop'],
  ['lesson-editions-dark-mobile', 'member-lessoneditions--dark-mobile'],
  ['lesson-editions-menu-light-desktop', 'member-lessoneditions--menu-light-desktop'],
  ['lesson-editions-menu-light-mobile', 'member-lessoneditions--menu-light-mobile'],
  ['lesson-editions-menu-dark-desktop', 'member-lessoneditions--menu-dark-desktop'],
  ['lesson-editions-menu-dark-mobile', 'member-lessoneditions--menu-dark-mobile'],
  ['telemetry-overview', 'integrations-telemetrystore--overview'],
  ['markdown-editor-empty', 'forms-markdowneditor--empty'],
  ['markdown-editor-long-content', 'forms-markdowneditor--long-content'],
  ['markdown-editor-code', 'forms-markdowneditor--code'],
  ['markdown-editor-links', 'forms-markdowneditor--links'],
  ['markdown-editor-disabled', 'forms-markdowneditor--disabled'],
  ['markdown-editor-source', 'forms-markdowneditor--markdown-tab'],
  ['markdown-editor-compact-empty-light', 'forms-markdowneditor--compact-empty-light-mobile-390'],
  ['markdown-editor-compact-content-light', 'forms-markdowneditor--compact-content-light-mobile-390'],
  ['markdown-editor-compact-empty-dark', 'forms-markdowneditor--compact-empty-dark-mobile-390'],
  ['markdown-editor-compact-content-dark', 'forms-markdowneditor--compact-content-dark-mobile-390'],
]);

type ComponentScreenName =
  | 'markdown-editor-empty'
  | 'markdown-editor-long-content'
  | 'markdown-editor-code'
  | 'markdown-editor-links'
  | 'markdown-editor-disabled'
  | 'markdown-editor-source'
  | 'markdown-editor-compact-empty-light'
  | 'markdown-editor-compact-content-light'
  | 'markdown-editor-compact-empty-dark'
  | 'markdown-editor-compact-content-dark';

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

const telemetryScreens: ScreenSpec[] = [{
  name: 'telemetry-overview', auth: 'creator', path: '', viewports: ['desktop', 'mobile'], minBytes: 4 * 1024, fullPage: true,
  ready: async (page) => { await page.getByTestId('telemetry-overview').waitFor(visible); },
}];

export const componentScreens: readonly ScreenSpec[] = [
  { name: 'lesson-editions-light-desktop', auth: 'member', path: '', viewports: ['desktop'], minBytes: 4 * 1024, ready: async (page) => { await page.getByTestId('story-lesson-editions').waitFor(visible); } },
  { name: 'lesson-editions-light-mobile', auth: 'member', path: '', viewports: ['mobile'], minBytes: 4 * 1024, ready: async (page) => { await page.getByTestId('story-lesson-editions').waitFor(visible); } },
  { name: 'lesson-editions-dark-desktop', auth: 'member', path: '', viewports: ['desktop'], minBytes: 4 * 1024, ready: async (page) => { await page.getByTestId('story-lesson-editions').waitFor(visible); } },
  { name: 'lesson-editions-dark-mobile', auth: 'member', path: '', viewports: ['mobile'], minBytes: 4 * 1024, ready: async (page) => { await page.getByTestId('story-lesson-editions').waitFor(visible); } },
  { name: 'lesson-editions-menu-light-desktop', auth: 'member', path: '', viewports: ['desktop'], minBytes: 4 * 1024, ready: async (page) => { await page.getByRole('menuitem', { name: 'Previous editions' }).waitFor(visible); } },
  { name: 'lesson-editions-menu-light-mobile', auth: 'member', path: '', viewports: ['mobile'], minBytes: 4 * 1024, ready: async (page) => { await page.getByRole('menuitem', { name: 'Previous editions' }).waitFor(visible); } },
  { name: 'lesson-editions-menu-dark-desktop', auth: 'member', path: '', viewports: ['desktop'], minBytes: 4 * 1024, ready: async (page) => { await page.getByRole('menuitem', { name: 'Previous editions' }).waitFor(visible); } },
  { name: 'lesson-editions-menu-dark-mobile', auth: 'member', path: '', viewports: ['mobile'], minBytes: 4 * 1024, ready: async (page) => { await page.getByRole('menuitem', { name: 'Previous editions' }).waitFor(visible); } },
  ...telemetryScreens,
  screen('markdown-editor-empty', 'desktop'),
  screen('markdown-editor-long-content', 'mobile'),
  screen('markdown-editor-code', 'desktop'),
  screen('markdown-editor-links', 'mobile'),
  screen('markdown-editor-disabled', 'desktop'),
  screen('markdown-editor-source', 'mobile', true),
  screen('markdown-editor-compact-empty-light', 'mobile'),
  screen('markdown-editor-compact-content-light', 'mobile'),
  screen('markdown-editor-compact-empty-dark', 'mobile'),
  screen('markdown-editor-compact-content-dark', 'mobile'),
];

export const componentScreenNames = new Set(componentScreens.map((entry) => entry.name));

export const componentStoryId = (name: string): string | null =>
  storyByScreen.get(name) ?? null;
