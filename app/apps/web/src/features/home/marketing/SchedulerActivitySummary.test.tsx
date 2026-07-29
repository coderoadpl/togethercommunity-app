import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SchedulerActivitySummary, SchedulerRunStatusChip } from './SchedulerActivitySummary.js';

describe('scheduler activity summary', () => {
  it('renders all tenant summary values and the last run status', () => {
    render(
      <SchedulerActivitySummary
        runs={{ label: 'Runs', value: '4' }}
        sent={{ label: 'Sent', value: '18' }}
        failed={{ label: 'Failed', value: '2' }}
        lastRun={{ label: 'Last run', value: '26 Jul, 10:00', status: 'failed', statusLabel: 'failed' }}
      />,
    );

    expect(screen.getByText('Runs')).toBeInTheDocument();
    expect(screen.getByText('18')).toBeInTheDocument();
    expect(screen.getByText('26 Jul, 10:00')).toBeInTheDocument();
    expect(screen.getByText('failed')).toHaveClass('MuiChip-label');
  });

  it('uses semantic colors for scheduler statuses', () => {
    const { rerender } = render(<SchedulerRunStatusChip status="completed" label="completed" />);
    expect(screen.getByText('completed').closest('.MuiChip-root')).toHaveClass('MuiChip-colorSuccess');

    rerender(<SchedulerRunStatusChip status="failed" label="failed" />);
    expect(screen.getByText('failed').closest('.MuiChip-root')).toHaveClass('MuiChip-colorError');
  });
});
