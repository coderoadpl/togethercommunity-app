import { screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { renderWithProviders } from '../../test/render.js';
import { sampleBundleLines } from '../../test/sales-link-fixtures.js';
import { BundleOfferSummary } from './BundleOfferSummary.js';

it('shows every immutable line, mixed VAT rates and the gross total', () => {
  renderWithProviders(<BundleOfferSummary heading="Complete bundle" descriptionHtml="<p>All products in one purchase.</p>" lines={sampleBundleLines} currency="PLN" totalCents={18660} />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Complete bundle');
  for (const line of sampleBundleLines) expect(screen.getByText(line.name)).toBeVisible();
  for (const rate of ['5%', '8%', '23%']) expect(screen.getByText(rate)).toBeVisible();
  expect(within(screen.getByTestId('offer-lines')).queryByRole('button')).toBeNull();
  expect(screen.getByText(/Total:/)).toHaveTextContent('186.60');
});
