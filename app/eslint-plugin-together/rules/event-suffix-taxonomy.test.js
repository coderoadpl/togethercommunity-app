import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { it } from 'vitest';

import rule from './event-suffix-taxonomy.js';

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2023,
    sourceType: 'module',
    parser: tseslint.parser,
  },
});

it('event-suffix-taxonomy', () => {
  ruleTester.run('event-suffix-taxonomy', rule, {
    valid: [
      "export type EditorEvent = { type: 'bodySourceChanged' } | { type: 'bodyModeChanged' };",
      "export type DialogEvent = 'dialogOpened' | 'dialogClosed';",
      "type ItemRemoved = { type: 'itemRemoved' }; export type ItemEvent = ItemRemoved;",
      'export type DynamicEvent = { type: string };',
    ],
    invalid: [
      {
        code: "export type EditorEvent = { type: 'setBodySource' } | { type: 'bodyModeChanged' };",
        errors: [{ messageId: 'badSuffix' }],
      },
      {
        code: "type Inner = { type: 'deleteItem' } | { type: 'itemRemoved' }; export type Events = Inner;",
        errors: [{ messageId: 'badSuffix' }],
      },
    ],
  });
});
