import path from 'node:path';

import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { it } from 'vitest';

import rule from './query-descriptors-only.js';

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2023,
    sourceType: 'module',
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const webFile = path.join(process.cwd(), 'apps/web/src/App.tsx');
const boardFile = path.join(process.cwd(), 'apps/web/src/features/board/BoardPage.tsx');
const at = (file) => (code) => ({ code, filename: file });
const web = at(webFile);
const board = at(boardFile);

it('query-descriptors-only', () => {
  ruleTester.run('query-descriptors-only', rule, {
    valid: [
      web("import { actions } from './api.js'; useQuery(actions.me);"),
      web("import { actions } from './api.js'; useQuery(actions.todos());"),
      web("import { meQuery } from '#core/client/index.js'; useQuery(meQuery);"),
      board("import { boardSelectors } from './core/index.js'; useQuery(boardSelectors.list);"),
      board("import { boardSelectors } from './index.web.js'; useQuery(boardSelectors.list);"),
      web("import { actions } from './api.js'; useMutation({ ...actions.addTodo, onSuccess() {} });"),
      web("import { actions } from './api.js'; useQueries({ queries: [actions.me, actions.todos()] });"),
      web("import { actions } from './api.js'; const q = actions.me; useQuery(q);"),
      web('foo({ queryKey: [] });'),
    ],
    invalid: [
      {
        ...web("useQuery({ queryKey: ['x'], queryFn: () => 1 });"),
        errors: [{ messageId: 'inlineObject' }],
      },
      {
        ...web('useMutation({ mutationFn: () => 1 });'),
        errors: [{ messageId: 'inlineObject' }],
      },
      {
        ...web('const local = { queryKey: [] }; useQuery(local);'),
        errors: [{ messageId: 'notImported' }],
      },
      {
        ...web("import { actions } from './api.js'; useQuery(somethingElse);"),
        errors: [{ messageId: 'notImported' }],
      },
      {
        ...web("useQueries({ queries: [{ queryKey: ['x'], queryFn() {} }] });"),
        errors: [{ messageId: 'inlineObject' }],
      },
      {
        ...web("import { meQuery } from './q.js'; useQuery(meQuery);"),
        errors: [{ messageId: 'foreignModule' }],
      },
      {
        ...web("import { fake } from './descriptors-reexport.js'; useMutation(fake);"),
        errors: [{ messageId: 'foreignModule' }],
      },
      {
        ...web("import { fake } from './helpers/api.js'; useQuery(fake);"),
        errors: [{ messageId: 'foreignModule' }],
      },
    ],
  });
});
