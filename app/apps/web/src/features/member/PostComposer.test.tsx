import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { POST_BODY_MAX_LENGTH } from '#core/domain/index.js';

import { en } from '../../i18n/en.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { PostComposer } from './ThreadDiscussion.js';

const okMe = () =>
  http.get('/api/me', () =>
    HttpResponse.json({
      ok: true,
      data: {
        userId: 'u1',
        email: 'member@example.com',
        emailVerified: true,
        name: 'Member',
        tenant: { id: 't1', slug: 'studio', name: 'Studio', staffRole: null, memberId: 'm1', banned: false },
      },
    }),
  );

const renderComposer = (
  overrides: {
    initialValue?: string;
    initialFormat?: 'plain' | 'markdown';
    withoutPlaceholder?: boolean;
  } = {},
) => {
  const { withoutPlaceholder = false, ...props } = overrides;
  server.use(okMe());
  const onSubmit = vi.fn();
  renderWithProviders(
    <PostComposer
      label="Post body"
      {...(withoutPlaceholder ? {} : { placeholder: 'Write a post' })}
      submitLabel="Post"
      pendingLabel="Posting"
      busy={false}
      onSubmit={onSubmit}
      testId="post-composer"
      {...props}
    />,
  );
  return onSubmit;
};

describe('PostComposer', () => {
  it('submits Markdown authored with the compact editor', async () => {
    const onSubmit = renderComposer();
    const input = await screen.findByTestId('post-composer-input');
    input.focus();
    await userEvent.keyboard('{Control>}b{/Control}Bold{Control>}b{/Control}');
    await userEvent.click(screen.getByTestId('post-composer-submit'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]?.[0]).toBe('**Bold**');
  });

  it('escapes a legacy plain post before saving it as Markdown', async () => {
    const onSubmit = renderComposer({
      initialValue: '# Heading\n*literal*\n> quote\n_underline_\n1) ordered',
      initialFormat: 'plain',
    });
    const input = await screen.findByTestId('post-composer-input');

    expect(input).toHaveTextContent('# Heading *literal* > quote _underline_ 1) ordered');
    expect(input.querySelector('h1')).toBeNull();
    await userEvent.click(screen.getByTestId('post-composer-submit'));

    expect(onSubmit.mock.calls[0]?.[0]).toBe('\\# Heading\n\\*literal\\*\n\\> quote\n\\_underline\\_\n1\\) ordered');
  });

  it('keeps legacy separators, indentation and urls literal in the editor', async () => {
    const initialValue = 'Para 2\n---\nUnder\n===\n\n    indented\nSee https://example.com/a_b_c';
    const onSubmit = renderComposer({ initialValue, initialFormat: 'plain' });
    const input = await screen.findByTestId('post-composer-input');

    expect(input.querySelector('h1, h2, pre')).toBeNull();
    expect(input).toHaveTextContent('Para 2 --- Under === indented See https://example.com/a_b_c');
    await userEvent.click(screen.getByTestId('post-composer-submit'));

    expect(onSubmit.mock.calls[0]?.[0]).toBe(
      'Para 2\n\\---\nUnder\n\\===\n\n\u00a0   indented\nSee https://example.com/a_b_c',
    );
  });

  it('labels the editor with a visible caption when it has no placeholder', async () => {
    renderComposer({ withoutPlaceholder: true });
    const input = await screen.findByTestId('post-composer-input');

    expect(screen.getByText('Post body')).toBeInTheDocument();
    expect(screen.getByLabelText('Post body')).toBe(input);
  });

  it('explains that a converted legacy body no longer fits the limit', async () => {
    renderComposer({ initialValue: '*'.repeat(POST_BODY_MAX_LENGTH), initialFormat: 'plain' });
    await screen.findByTestId('post-composer-input');

    expect(screen.getByTestId('post-composer-over-limit')).toHaveTextContent(en.markdownEditor.overLimit);
    expect(screen.getByTestId('post-composer-submit')).toBeDisabled();
  });

  it('counts and enforces the Markdown source limit', async () => {
    renderComposer();
    await screen.findByTestId('post-composer-input');
    await userEvent.click(screen.getByRole('button', { name: en.markdownEditor.markdownTab }));
    const source = screen.getByTestId('post-composer-input');
    fireEvent.change(source, { target: { value: 'x'.repeat(POST_BODY_MAX_LENGTH) } });

    expect(screen.getByTestId('post-composer-counter')).toHaveTextContent(`${POST_BODY_MAX_LENGTH} / ${POST_BODY_MAX_LENGTH}`);
    fireEvent.change(source, { target: { value: `${'x'.repeat(POST_BODY_MAX_LENGTH)}y` } });
    expect(source).toHaveValue('x'.repeat(POST_BODY_MAX_LENGTH));
  });
});
