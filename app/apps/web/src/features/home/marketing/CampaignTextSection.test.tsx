import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../../test/render.js';
import { CampaignTextSection } from './CampaignTextSection.js';

describe('campaign plaintext and reply address', () => {
  it('edits both fields and shows the automatic plaintext behavior', () => {
    const onBodyTextChange = vi.fn();
    const onReplyToChange = vi.fn();
    renderWithProviders(<CampaignTextSection bodyText="Authored text" replyTo="reply@example.test" disabled={false} onBodyTextChange={onBodyTextChange} onReplyToChange={onReplyToChange} />);
    fireEvent.change(screen.getByDisplayValue('Authored text'), { target: { value: 'New plaintext' } });
    fireEvent.change(screen.getByDisplayValue('reply@example.test'), { target: { value: 'help@example.test' } });
    expect(onBodyTextChange).toHaveBeenCalledWith('New plaintext');
    expect(onReplyToChange).toHaveBeenCalledWith('help@example.test');
    expect(screen.getByText(/HTML/)).toBeInTheDocument();
  });
  it('locks both fields when campaign content is frozen', () => {
    renderWithProviders(<CampaignTextSection bodyText="Frozen" replyTo="reply@example.test" disabled onBodyTextChange={vi.fn()} onReplyToChange={vi.fn()} />);
    expect(screen.getByDisplayValue('Frozen')).toBeDisabled();
    expect(screen.getByDisplayValue('reply@example.test')).toBeDisabled();
  });
});
