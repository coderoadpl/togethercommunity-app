import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { EmailReputation } from '@core/domain/index.js';

import { renderWithProviders } from '../../../test/render.js';
import { ReputationSummary } from './ReputationSummary.js';

const report: EmailReputation = {
  windowStart: '2026-07-20T12:00:00.000Z',
  windowEnd: '2026-07-27T12:00:00.000Z',
  hardBounce: { count: 100, sends: 1_000, rate: 0.1, status: 'critical' },
  complaint: { count: 1, sends: 1_000, rate: null, status: 'insufficient_data' },
  overallStatus: 'critical',
};

describe('reputation summary', () => {
  it('renders rates, data floors, and semantic status chips', () => {
    renderWithProviders(<ReputationSummary reputation={report} />);

    expect(screen.getByText('10%')).toBeInTheDocument();
    expect(screen.getByText('Za mało danych')).toBeInTheDocument();
    expect(screen.getByText('krytyczny').closest('.MuiChip-root')).toHaveClass('MuiChip-colorError');
    expect(screen.getAllByText('za mało danych')[0]?.closest('.MuiChip-root')).toHaveClass('MuiChip-colorDefault');
  });
});
