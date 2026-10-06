import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { en } from '../../../i18n/en.js';
import { SurveyForm } from './SurveyForm.js';
import { sampleSurvey } from './survey-test-data.js';

describe('Survey form', () => {
  it('requires a score and submits an optional plain-text comment with the honeypot', async () => {
    const onSubmit = vi.fn();
    render(<SurveyForm survey={sampleSurvey} onSubmit={onSubmit} />);
    expect(screen.getByRole('button', { name: en.surveys.submit })).toBeDisabled();
    expect(screen.getAllByRole('button', { name: /^Score \d+$/ })).toHaveLength(11);
    await userEvent.click(screen.getByRole('button', { name: 'Score 0' }));
    fireEvent.change(screen.getByRole('textbox', { name: sampleSurvey.commentPrompt }), { target: { value: '<b>Plain text</b>' } });
    expect(screen.getByRole('textbox', { name: sampleSurvey.commentPrompt })).toHaveAttribute('maxlength', '2000');
    await userEvent.click(screen.getByRole('button', { name: en.surveys.submit }));
    expect(onSubmit).toHaveBeenCalledWith(0, '<b>Plain text</b>', '');
  });
  it('shows five stars and hides the disabled comment', () => {
    render(<SurveyForm survey={{ ...sampleSurvey, type: 'stars', commentEnabled: false }} onSubmit={() => undefined} />);
    expect(screen.getAllByRole('button', { name: /^Score \d+$/ })).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'Score 1' })).toHaveTextContent('☆');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
  it('replaces the form with the rendered ending and prevents another answer', () => {
    const { rerender } = render(<SurveyForm survey={sampleSurvey} onSubmit={() => undefined} />);
    rerender(<SurveyForm survey={sampleSurvey} onSubmit={() => undefined} endingHtml="<p>Thank you, <strong>reader</strong>.</p>" />);
    expect(screen.getByRole('status')).toHaveTextContent('Thank you, reader.');
    expect(screen.queryByRole('button', { name: en.surveys.submit })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
  it('disables submission while saving and displays request errors', () => {
    render(<SurveyForm survey={sampleSurvey} onSubmit={() => undefined} pending error="Please try again." />);
    expect(screen.getByRole('button', { name: en.surveys.submitting })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Please try again.');
  });
});
