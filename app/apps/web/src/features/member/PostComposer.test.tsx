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
    expect(onSubmit).toHaveBeenCalledWith('**Bold**', 'markdown', expect.any(Function));
  });

  it('saves a Markdown post edit as Markdown', async () => {
    const onSubmit = renderComposer({ initialValue: 'Before', initialFormat: 'markdown' });
    await screen.findByTestId('post-composer-input');
    await userEvent.click(screen.getByRole('button', { name: en.markdownEditor.markdownTab }));
    const input = screen.getByTestId('post-composer-input');
    fireEvent.change(input, { target: { value: '**After**' } });
    await userEvent.click(screen.getByTestId('post-composer-submit'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith('**After**', 'markdown', expect.any(Function));
  });

  it('submits an unchanged legacy plain body byte-for-byte as plain text', async () => {
    const initialValue = [
      '# Welcome',
      'Notes',
      '---',
      'more',
      '2024. was a great year',
      'before',
      '===',
      'See (www.example.com/docs) and [www.example.com/a]',
    ].join('\n');
    const onSubmit = renderComposer({ initialValue, initialFormat: 'plain' });
    const input = await screen.findByTestId('post-composer-input');

    expect(input).toHaveValue(initialValue);
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('post-composer-submit'));

    expect(onSubmit).toHaveBeenCalledWith(initialValue, 'plain', expect.any(Function));
  });

  it.each([
    ['a 5,000-character body', 'x'.repeat(POST_BODY_MAX_LENGTH)],
    ['an ampersand near the limit', `${'x'.repeat(POST_BODY_MAX_LENGTH - 3)}&`],
  ])('keeps %s saveable as plain text', async (_name, initialValue) => {
    const onSubmit = renderComposer({ initialValue, initialFormat: 'plain' });
    const input = await screen.findByTestId('post-composer-input');

    expect(input).toHaveValue(initialValue);
    expect(screen.getByTestId('post-composer-submit')).toBeEnabled();
    await userEvent.click(screen.getByTestId('post-composer-submit'));

    expect(onSubmit).toHaveBeenCalledWith(initialValue, 'plain', expect.any(Function));
  });

  it('saves changes to a legacy plain body as plain text', async () => {
    const onSubmit = renderComposer({ initialValue: '# Original', initialFormat: 'plain' });
    const input = await screen.findByTestId('post-composer-input');
    fireEvent.change(input, { target: { value: '# Changed\nStill literal' } });
    await userEvent.click(screen.getByTestId('post-composer-submit'));

    expect(onSubmit).toHaveBeenCalledWith('# Changed\nStill literal', 'plain', expect.any(Function));
  });

  it('labels the editor with a visible caption when it has no placeholder', async () => {
    renderComposer({ withoutPlaceholder: true });
    const input = await screen.findByTestId('post-composer-input');

    expect(screen.getByText('Post body')).toBeInTheDocument();
    expect(screen.getByLabelText('Post body')).toBe(input);
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
