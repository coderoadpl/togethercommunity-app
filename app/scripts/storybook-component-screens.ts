import { visible, type ScreenSpec } from './visual-screen-inventory.js';

const storyByScreen: ReadonlyMap<string, string> = new Map([
  ['survey-nps-form-light-desktop', 'surveys-nativesurvey--nps-form-light-desktop'],
  ['survey-nps-form-light-mobile', 'surveys-nativesurvey--nps-form-light-mobile'],
  ['survey-nps-form-dark-desktop', 'surveys-nativesurvey--nps-form-dark-desktop'],
  ['survey-nps-form-dark-mobile', 'surveys-nativesurvey--nps-form-dark-mobile'],
  ['survey-stars-form-light-desktop', 'surveys-nativesurvey--stars-form-light-desktop'],
  ['survey-stars-form-light-mobile', 'surveys-nativesurvey--stars-form-light-mobile'],
  ['survey-stars-form-dark-desktop', 'surveys-nativesurvey--stars-form-dark-desktop'],
  ['survey-stars-form-dark-mobile', 'surveys-nativesurvey--stars-form-dark-mobile'],
  ['survey-nps-ending-1-light-desktop', 'surveys-nativesurvey--nps-ending-1-light-desktop'],
  ['survey-nps-ending-1-light-mobile', 'surveys-nativesurvey--nps-ending-1-light-mobile'],
  ['survey-nps-ending-1-dark-desktop', 'surveys-nativesurvey--nps-ending-1-dark-desktop'],
  ['survey-nps-ending-1-dark-mobile', 'surveys-nativesurvey--nps-ending-1-dark-mobile'],
  ['survey-nps-ending-2-light-desktop', 'surveys-nativesurvey--nps-ending-2-light-desktop'],
  ['survey-nps-ending-2-light-mobile', 'surveys-nativesurvey--nps-ending-2-light-mobile'],
  ['survey-nps-ending-2-dark-desktop', 'surveys-nativesurvey--nps-ending-2-dark-desktop'],
  ['survey-nps-ending-2-dark-mobile', 'surveys-nativesurvey--nps-ending-2-dark-mobile'],
  ['survey-nps-ending-3-light-desktop', 'surveys-nativesurvey--nps-ending-3-light-desktop'],
  ['survey-nps-ending-3-light-mobile', 'surveys-nativesurvey--nps-ending-3-light-mobile'],
  ['survey-nps-ending-3-dark-desktop', 'surveys-nativesurvey--nps-ending-3-dark-desktop'],
  ['survey-nps-ending-3-dark-mobile', 'surveys-nativesurvey--nps-ending-3-dark-mobile'],
  ['survey-stars-ending-1-light-desktop', 'surveys-nativesurvey--stars-ending-1-light-desktop'],
  ['survey-stars-ending-1-light-mobile', 'surveys-nativesurvey--stars-ending-1-light-mobile'],
  ['survey-stars-ending-1-dark-desktop', 'surveys-nativesurvey--stars-ending-1-dark-desktop'],
  ['survey-stars-ending-1-dark-mobile', 'surveys-nativesurvey--stars-ending-1-dark-mobile'],
  ['survey-stars-ending-2-light-desktop', 'surveys-nativesurvey--stars-ending-2-light-desktop'],
  ['survey-stars-ending-2-light-mobile', 'surveys-nativesurvey--stars-ending-2-light-mobile'],
  ['survey-stars-ending-2-dark-desktop', 'surveys-nativesurvey--stars-ending-2-dark-desktop'],
  ['survey-stars-ending-2-dark-mobile', 'surveys-nativesurvey--stars-ending-2-dark-mobile'],
  ['survey-stars-ending-3-light-desktop', 'surveys-nativesurvey--stars-ending-3-light-desktop'],
  ['survey-stars-ending-3-light-mobile', 'surveys-nativesurvey--stars-ending-3-light-mobile'],
  ['survey-stars-ending-3-dark-desktop', 'surveys-nativesurvey--stars-ending-3-dark-desktop'],
  ['survey-stars-ending-3-dark-mobile', 'surveys-nativesurvey--stars-ending-3-dark-mobile'],
  ['survey-list-light-desktop', 'surveys-nativesurvey--list-light-desktop'],
  ['survey-list-light-mobile', 'surveys-nativesurvey--list-light-mobile'],
  ['survey-list-dark-desktop', 'surveys-nativesurvey--list-dark-desktop'],
  ['survey-list-dark-mobile', 'surveys-nativesurvey--list-dark-mobile'],
  ['survey-editor-light-desktop', 'surveys-nativesurvey--editor-light-desktop'],
  ['survey-editor-light-mobile', 'surveys-nativesurvey--editor-light-mobile'],
  ['survey-editor-dark-desktop', 'surveys-nativesurvey--editor-dark-desktop'],
  ['survey-editor-dark-mobile', 'surveys-nativesurvey--editor-dark-mobile'],
  ['survey-results-light-desktop', 'surveys-nativesurvey--results-light-desktop'],
  ['survey-results-light-mobile', 'surveys-nativesurvey--results-light-mobile'],
  ['survey-results-dark-desktop', 'surveys-nativesurvey--results-dark-desktop'],
  ['survey-results-dark-mobile', 'surveys-nativesurvey--results-dark-mobile'],

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
  { name: 'survey-nps-form-light-desktop', auth: 'public', path: '', viewports: ['desktop'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); } },
  { name: 'survey-nps-form-light-mobile', auth: 'public', path: '', viewports: ['mobile'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); } },
  { name: 'survey-nps-form-dark-desktop', auth: 'public', path: '', viewports: ['desktop'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); } },
  { name: 'survey-nps-form-dark-mobile', auth: 'public', path: '', viewports: ['mobile'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); } },
  { name: 'survey-stars-form-light-desktop', auth: 'public', path: '', viewports: ['desktop'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); await page.getByRole('button', { name: 'Score 3', pressed: true }).waitFor(visible); } },
  { name: 'survey-stars-form-light-mobile', auth: 'public', path: '', viewports: ['mobile'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); await page.getByRole('button', { name: 'Score 3', pressed: true }).waitFor(visible); } },
  { name: 'survey-stars-form-dark-desktop', auth: 'public', path: '', viewports: ['desktop'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); await page.getByRole('button', { name: 'Score 3', pressed: true }).waitFor(visible); } },
  { name: 'survey-stars-form-dark-mobile', auth: 'public', path: '', viewports: ['mobile'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); await page.getByRole('button', { name: 'Score 3', pressed: true }).waitFor(visible); } },
  { name: 'survey-nps-ending-1-light-desktop', auth: 'public', path: '', viewports: ['desktop'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); } },
  { name: 'survey-nps-ending-1-light-mobile', auth: 'public', path: '', viewports: ['mobile'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); } },
  { name: 'survey-nps-ending-1-dark-desktop', auth: 'public', path: '', viewports: ['desktop'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); } },
  { name: 'survey-nps-ending-1-dark-mobile', auth: 'public', path: '', viewports: ['mobile'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); } },
  { name: 'survey-nps-ending-2-light-desktop', auth: 'public', path: '', viewports: ['desktop'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); } },
  { name: 'survey-nps-ending-2-light-mobile', auth: 'public', path: '', viewports: ['mobile'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); } },
  { name: 'survey-nps-ending-2-dark-desktop', auth: 'public', path: '', viewports: ['desktop'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); } },
  { name: 'survey-nps-ending-2-dark-mobile', auth: 'public', path: '', viewports: ['mobile'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); } },
  { name: 'survey-nps-ending-3-light-desktop', auth: 'public', path: '', viewports: ['desktop'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); } },
  { name: 'survey-nps-ending-3-light-mobile', auth: 'public', path: '', viewports: ['mobile'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); } },
  { name: 'survey-nps-ending-3-dark-desktop', auth: 'public', path: '', viewports: ['desktop'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); } },
  { name: 'survey-nps-ending-3-dark-mobile', auth: 'public', path: '', viewports: ['mobile'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); } },
  { name: 'survey-stars-ending-1-light-desktop', auth: 'public', path: '', viewports: ['desktop'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); } },
  { name: 'survey-stars-ending-1-light-mobile', auth: 'public', path: '', viewports: ['mobile'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); } },
  { name: 'survey-stars-ending-1-dark-desktop', auth: 'public', path: '', viewports: ['desktop'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); } },
  { name: 'survey-stars-ending-1-dark-mobile', auth: 'public', path: '', viewports: ['mobile'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); } },
  { name: 'survey-stars-ending-2-light-desktop', auth: 'public', path: '', viewports: ['desktop'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); } },
  { name: 'survey-stars-ending-2-light-mobile', auth: 'public', path: '', viewports: ['mobile'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); } },
  { name: 'survey-stars-ending-2-dark-desktop', auth: 'public', path: '', viewports: ['desktop'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); } },
  { name: 'survey-stars-ending-2-dark-mobile', auth: 'public', path: '', viewports: ['mobile'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); } },
  { name: 'survey-stars-ending-3-light-desktop', auth: 'public', path: '', viewports: ['desktop'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); } },
  { name: 'survey-stars-ending-3-light-mobile', auth: 'public', path: '', viewports: ['mobile'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); } },
  { name: 'survey-stars-ending-3-dark-desktop', auth: 'public', path: '', viewports: ['desktop'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); } },
  { name: 'survey-stars-ending-3-dark-mobile', auth: 'public', path: '', viewports: ['mobile'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); } },
  { name: 'survey-list-light-desktop', auth: 'public', path: '', viewports: ['desktop'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); } },
  { name: 'survey-list-light-mobile', auth: 'public', path: '', viewports: ['mobile'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); } },
  { name: 'survey-list-dark-desktop', auth: 'public', path: '', viewports: ['desktop'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); } },
  { name: 'survey-list-dark-mobile', auth: 'public', path: '', viewports: ['mobile'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); } },
  { name: 'survey-editor-light-desktop', auth: 'public', path: '', viewports: ['desktop'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); } },
  { name: 'survey-editor-light-mobile', auth: 'public', path: '', viewports: ['mobile'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); } },
  { name: 'survey-editor-dark-desktop', auth: 'public', path: '', viewports: ['desktop'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); } },
  { name: 'survey-editor-dark-mobile', auth: 'public', path: '', viewports: ['mobile'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); } },
  { name: 'survey-results-light-desktop', auth: 'public', path: '', viewports: ['desktop'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); } },
  { name: 'survey-results-light-mobile', auth: 'public', path: '', viewports: ['mobile'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); } },
  { name: 'survey-results-dark-desktop', auth: 'public', path: '', viewports: ['desktop'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); } },
  { name: 'survey-results-dark-mobile', auth: 'public', path: '', viewports: ['mobile'], minBytes: 4 * 1024, fullPage: true, ready: async (page) => { await page.getByTestId('story-survey').waitFor(visible); } },

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
