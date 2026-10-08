import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../../i18n/index.js';
import { en } from '../../../i18n/en.js';
import { pl } from '../../../i18n/pl.js';
import { renderWithProviders } from '../../../test/render.js';
import { languagePreference } from '../../../theme-mode.js';
import { SurveyEditor } from './SurveyEditor.js';
import { sampleSurvey } from './survey-test-data.js';

describe('Survey editor native validation', () => {
  describe.each([{ language: 'en', t: en }, { language: 'pl', t: pl }] as const)('$language', ({ language, t }) => {
    it.each(['internalTitle', 'question', 'slug'] as const)('localizes an empty %s field and clears the message on input', async (field) => {
      const user = userEvent.setup();
      const onSave = vi.fn();
      languagePreference.save(language);
      renderWithProviders(<LanguageProvider><SurveyEditor survey={sampleSurvey} onSave={onSave} onCancel={vi.fn()} /></LanguageProvider>);
      const input = screen.getByRole('textbox', { name: t.surveys[field] });
      if (!(input instanceof HTMLInputElement)) throw new Error('Expected a survey input');

      await user.clear(input);
      await user.click(screen.getByRole('button', { name: t.common.save }));

      expect(input.validity.valueMissing).toBe(true);
      expect(input.validity.customError).toBe(true);
      expect(input.validationMessage).toBe(t.common.requiredField);
      expect(onSave).not.toHaveBeenCalled();

      await user.type(input, 'updated');

      expect(input.validationMessage).toBe('');
      expect(input.validity.customError).toBe(false);
      expect(input.validity.valid).toBe(true);
      await user.click(screen.getByRole('button', { name: t.common.save }));
      expect(onSave).toHaveBeenCalledOnce();
    });
  });
});
