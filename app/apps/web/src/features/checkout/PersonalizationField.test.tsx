import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { PublicProductPersonalization } from '#core/domain/index.js';

import { en } from '../../i18n/en.js';
import { renderWithProviders } from '../../test/render.js';
import { PersonalizationField, personalizationState, usePersonalizations, type PersonalizableLine } from './PersonalizationField.js';

const engraving: PublicProductPersonalization = {
  label: 'Add an engraving',
  description: 'We engrave the text by hand.\nAllow two extra days.',
  inputLabel: 'Engraving text',
  maxLength: 12,
  condition: null,
};

const condition = 'I understand a personalised item is made to my order.';

const lines = (overrides: Partial<PublicProductPersonalization> = {}): PersonalizableLine[] => [
  { productId: 'stand', name: 'Printed stand', personalization: { ...engraving, ...overrides } },
];

const Harness = ({ offer }: { offer: PersonalizableLine[] }) => {
  const state = usePersonalizations(offer);
  return (
    <>
      <PersonalizationField state={state} />
      <output data-testid="request">{JSON.stringify(state.request)}</output>
      <output data-testid="blocked">{String(state.blocked)}</output>
    </>
  );
};

const request = () => JSON.parse(screen.getByTestId('request').textContent ?? '');
const blocked = () => screen.getByTestId('blocked').textContent;

describe('PersonalizationField', () => {
  it('shows the seller label and plain-text description and sends nothing while unticked', () => {
    renderWithProviders(<Harness offer={lines({ description: '<b>Hand engraved</b>' })} />);
    expect(screen.getByRole('checkbox', { name: /Add an engraving/u })).not.toBeChecked();
    expect(screen.getByText('<b>Hand engraved</b>')).toBeInTheDocument();
    expect(document.querySelector('b')).toBeNull();
    expect(screen.queryByLabelText('Engraving text')).not.toBeInTheDocument();
    expect(request()).toStrictEqual({});
    expect(blocked()).toBe('false');
  });

  it('renders nothing for an offer without a personalisation', () => {
    renderWithProviders(<Harness offer={[{ productId: 'stand', name: 'Printed stand', personalization: null }]} />);
    expect(screen.queryByTestId('checkout-personalization')).not.toBeInTheDocument();
    expect(request()).toStrictEqual({});
  });

  it('blocks payment with a visible reason while the ticked text is empty, then sends the trimmed text', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness offer={lines()} />);
    await user.click(screen.getByRole('checkbox', { name: /Add an engraving/u }));
    const input = screen.getByLabelText('Engraving text');
    expect(screen.queryByText(en.personalization.textRequired)).not.toBeInTheDocument();
    await user.click(input);
    await user.tab();
    expect(screen.getByText(en.personalization.textRequired)).toBeVisible();
    expect(screen.getByText('0 / 12')).toBeVisible();
    expect(blocked()).toBe('true');
    await user.type(input, '   ');
    expect(blocked()).toBe('true');
    await user.type(input, 'For Alex  ');
    expect(screen.queryByText(en.personalization.textRequired)).not.toBeInTheDocument();
    expect(screen.getByText('12 / 12')).toBeVisible();
    expect(input).toHaveAttribute('maxlength', '12');
    expect(blocked()).toBe('false');
    expect(request()).toStrictEqual({ personalizations: [{ productId: 'stand', text: 'For Alex', conditionAccepted: false }] });
  });

  it('requires the seller condition before payment when one is set', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness offer={lines({ condition })} />);
    expect(screen.queryByRole('checkbox', { name: condition })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /Add an engraving/u }));
    await user.type(screen.getByLabelText('Engraving text'), 'For Alex');
    const accept = screen.getByRole('checkbox', { name: condition });
    expect(accept).not.toBeChecked();
    expect(screen.queryByText(en.personalization.conditionRequired)).not.toBeInTheDocument();
    await user.tab();
    await user.tab();
    expect(screen.getByText(en.personalization.conditionRequired)).toBeVisible();
    expect(blocked()).toBe('true');
    await user.click(accept);
    expect(screen.queryByText(en.personalization.conditionRequired)).not.toBeInTheDocument();
    expect(blocked()).toBe('false');
    expect(request()).toStrictEqual({ personalizations: [{ productId: 'stand', text: 'For Alex', conditionAccepted: true }] });
  });

  it('sends nothing again once the buyer unticks the option', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness offer={lines({ condition })} />);
    const option = screen.getByRole('checkbox', { name: /Add an engraving/u });
    await user.click(option);
    await user.type(screen.getByLabelText('Engraving text'), 'For Alex');
    await user.click(option);
    expect(screen.queryByLabelText('Engraving text')).not.toBeInTheDocument();
    expect(blocked()).toBe('false');
    expect(request()).toStrictEqual({});
  });

  it('names the line of each personalisable product in a multi-line offer and keeps entries apart', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness offer={[
      { productId: 'stand', name: 'Printed stand', personalization: engraving },
      { productId: 'workbook', name: 'Printed workbook', personalization: { ...engraving, inputLabel: 'Dedication' } },
      { productId: 'course', name: 'Practice course', personalization: null },
    ]} />);
    expect(screen.getByText(en.personalization.forLine({ name: 'Printed stand' }))).toBeVisible();
    expect(screen.getByText(en.personalization.forLine({ name: 'Printed workbook' }))).toBeVisible();
    expect(screen.queryByText(en.personalization.forLine({ name: 'Practice course' }))).not.toBeInTheDocument();
    await user.click(within(screen.getByTestId('checkout-personalization-workbook')).getByRole('checkbox'));
    await user.type(screen.getByLabelText('Dedication'), 'For Sam');
    expect(request()).toStrictEqual({ personalizations: [{ productId: 'workbook', text: 'For Sam', conditionAccepted: false }] });
  });

  it('never marks a condition accepted for a setting without one', () => {
    const state = personalizationState(lines(), { stand: { ticked: true, text: 'For Alex', conditionAccepted: true } }, () => undefined);
    expect(state.request).toStrictEqual({ personalizations: [{ productId: 'stand', text: 'For Alex', conditionAccepted: false }] });
  });
});
