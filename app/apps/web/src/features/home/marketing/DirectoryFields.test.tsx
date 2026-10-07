import { useState } from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { LanguageProvider } from '../../../i18n/index.js';
import { en } from '../../../i18n/en.js';
import { renderWithProviders } from '../../../test/render.js';
import { languagePreference } from '../../../theme-mode.js';
import { DirectoryField } from './DirectoryFields.js';

const Harness = () => { const [value, setValue] = useState(''); return <form><DirectoryField label="Name" value={value} onChange={setValue} required /><button type="submit">Send</button></form>; };

describe('DirectoryField native validation', () => {
  it('localizes an empty required field and clears the message on input', async () => {
    const user = userEvent.setup();
    languagePreference.save('en');
    renderWithProviders(<LanguageProvider><Harness /></LanguageProvider>);
    const input = screen.getByRole('textbox', { name: 'Name' });
    if (!(input instanceof HTMLInputElement)) throw new Error('Expected an input');

    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(input.validationMessage).toBe(en.common.requiredField);

    await user.type(input, 'a');
    expect(input.validationMessage).toBe('');
  });
});
