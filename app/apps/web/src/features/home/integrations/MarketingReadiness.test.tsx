import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MarketingReadiness } from './MarketingReadiness.js';

const renderReadiness = ({
  items,
}: {
  items: Parameters<typeof MarketingReadiness>[0]['items'];
}) => render(
  <MarketingReadiness
    title="Sending readiness"
    items={items}
    readyLabel="Ready"
    blockedLabel="Action needed"
    optionalLabel="Optional"
    attentionItemsMessage={({ items: attentionItems }) => `Review these readiness checks: ${attentionItems}`}
    readyMessage="All required readiness checks are complete."
  />,
);

describe('MarketingReadiness', () => {
  it('renders an unready non-blocking item with a neutral optional chip', () => {
    renderReadiness({ items: [{ label: 'SNS subscription', ready: false, required: false }] });

    const row = screen.getByText('SNS subscription').closest('li') ?? document.body;
    expect(within(row).getByText('Optional')).toBeInTheDocument();
    expect(within(row).queryByText('Action needed')).not.toBeInTheDocument();
  });

  it('keeps the success color for a ready non-blocking item', () => {
    renderReadiness({ items: [{ label: 'SES credentials', ready: true, required: false }] });

    const row = screen.getByText('SES credentials').closest('li') ?? document.body;
    expect(within(row).getByText('Ready').closest('.MuiChip-root')).toHaveClass('MuiChip-colorSuccess');
  });

  it('names required items that need attention', () => {
    renderReadiness({
      items: [
        { label: 'Identity and DKIM', ready: false },
        { label: 'SNS subscription', ready: false, required: false },
      ],
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Review these readiness checks: Identity and DKIM');
    expect(screen.queryByText('All required readiness checks are complete.')).not.toBeInTheDocument();
  });

  it('shows success when every required item is ready', () => {
    renderReadiness({
      items: [
        { label: 'Identity and DKIM', ready: true },
        { label: 'SNS subscription', ready: false, required: false },
      ],
    });

    expect(screen.getByRole('alert')).toHaveTextContent('All required readiness checks are complete.');
  });
});
