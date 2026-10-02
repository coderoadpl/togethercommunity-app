import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DM_BODY_MAX_LENGTH } from '#core/domain/index.js';

import { en } from '../../../i18n/en.js';
import { renderWithProviders } from '../../../test/render.js';
import { MessageComposer } from './MessageComposer.js';

describe('MessageComposer', () => {
  it('submits Markdown with Enter and keeps Shift+Enter for a newline', async () => {
    const onSend = vi.fn();
    renderWithProviders(<MessageComposer busy={false} onSend={onSend} />);
    const input = await screen.findByTestId('message-composer-input');
    input.focus();
    await userEvent.keyboard('{Control>}b{/Control}Bold{Control>}b{/Control}');

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(onSend.mock.calls[0]?.[0]).toBe('**Bold**');
  });

  it('counts the Markdown source and stops at the limit', async () => {
    renderWithProviders(<MessageComposer busy={false} onSend={vi.fn()} />);
    await screen.findByTestId('message-composer-input');
    await userEvent.click(screen.getByRole('button', { name: en.markdownEditor.markdownTab }));
    const source = screen.getByTestId('message-composer-input');
    const counter = screen.getByTestId('message-composer-counter');

    expect(counter).toHaveTextContent(`0 / ${DM_BODY_MAX_LENGTH}`);
    expect(counter).toHaveAccessibleName(en.markdownEditor.characterCount({ used: 0, limit: DM_BODY_MAX_LENGTH }));

    fireEvent.change(source, { target: { value: 'x'.repeat(DM_BODY_MAX_LENGTH) } });
    expect(counter).toHaveTextContent(`${DM_BODY_MAX_LENGTH} / ${DM_BODY_MAX_LENGTH}`);

    fireEvent.change(source, { target: { value: `${'x'.repeat(DM_BODY_MAX_LENGTH)}y` } });
    expect(source).toHaveValue('x'.repeat(DM_BODY_MAX_LENGTH));
  });
});
