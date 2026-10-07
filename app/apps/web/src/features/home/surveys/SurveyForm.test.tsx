import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { contrastRatio } from '#core/domain/index.js';
import { en } from '../../../i18n/en.js';
import { createThemeForMode } from '../../../theme.js';
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
  it.each(['light', 'dark'] as const)('fills stars up to the score with accessible warning colour in %s mode', async (scheme) => {
    const theme = createThemeForMode('shadcn', undefined, scheme, 'member');
    render(<ThemeProvider theme={theme}><SurveyForm survey={{ ...sampleSurvey, type: 'stars' }} onSubmit={() => undefined} /></ThemeProvider>);
    await userEvent.click(screen.getByRole('button', { name: 'Score 3' }));
    await userEvent.unhover(screen.getByRole('button', { name: 'Score 3' }));
    const buttons = screen.getAllByRole('button', { name: /^Score \d+$/ });
    buttons.forEach((button, index) => {
      expect(button).toHaveClass('MuiButton-outlined');
      expect(button).toHaveAttribute('aria-pressed', String(index === 2));
      expect(button).toHaveTextContent(index < 3 ? '★' : '☆');
      if (index < 3) expect(button.querySelector('span[aria-hidden]')).toHaveStyle({ color: theme.palette.warning.main });
      else expect(button.querySelector('span[aria-hidden]')).not.toHaveStyle({ color: theme.palette.warning.main });
    });
    expect(contrastRatio(theme.palette.warning.main, theme.palette.background.paper)).toBeGreaterThanOrEqual(3);
    const hoverBackground = scheme === 'light' ? theme.palette.background.paper : theme.palette.action.hover;
    expect(contrastRatio(theme.palette.warning.main, hoverBackground)).toBeGreaterThanOrEqual(3);
    if (scheme === 'light') {
      const wrapperClass = buttons[0]?.className.split(' ').find((name) => name.startsWith('css-'));
      const paper = theme.palette.background.paper;
      const paperRgb = `rgb(${[1, 3, 5].map((offset) => parseInt(paper.slice(offset, offset + 2), 16)).join(', ')})`;
      const paperRules = Array.from(document.styleSheets)
        .flatMap((sheet) => Array.from(sheet.cssRules))
        .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.style.backgroundColor === paperRgb)
        .map((rule) => rule.selectorText);
      expect(paperRules).toContain(`.${wrapperClass}.MuiButton-outlined:hover,.${wrapperClass}.MuiButton-outlined:active`);
    }
  });
  it('previews hovered stars without changing the score and restores it on leaving the group', async () => {
    const theme = createThemeForMode('shadcn');
    const onSubmit = vi.fn();
    render(<ThemeProvider theme={theme}><SurveyForm survey={{ ...sampleSurvey, type: 'stars' }} onSubmit={onSubmit} /></ThemeProvider>);
    const selected = screen.getByRole('button', { name: 'Score 2' });
    await userEvent.click(selected);
    await userEvent.hover(screen.getByRole('button', { name: 'Score 4' }));
    screen.getAllByRole('button', { name: /^Score \d+$/ }).forEach((button, index) => {
      expect(button).toHaveTextContent(index < 4 ? '★' : '☆');
      expect(button).toHaveAttribute('aria-pressed', String(index === 1));
      if (index < 4) expect(button.querySelector('span[aria-hidden]')).toHaveStyle({ color: theme.palette.warning.main });
      else expect(button.querySelector('span[aria-hidden]')).not.toHaveStyle({ color: theme.palette.warning.main });
    });
    await userEvent.hover(screen.getByRole('button', { name: 'Score 1' }));
    expect(selected).toHaveTextContent('☆');
    await userEvent.unhover(screen.getByRole('button', { name: 'Score 1' }));
    expect(selected).toHaveTextContent('★');
    expect(screen.getByRole('button', { name: 'Score 3' })).toHaveTextContent('☆');
    fireEvent.focus(screen.getByRole('button', { name: 'Score 5' }));
    expect(screen.getByRole('button', { name: 'Score 5' })).toHaveTextContent('☆');
    await userEvent.click(screen.getByRole('button', { name: en.surveys.submit }));
    expect(onSubmit).toHaveBeenCalledWith(2, '', '');
  });
  it('suppresses hover preview while a pointer is pressed or the form is pending', async () => {
    const user = userEvent.setup();
    const survey = { ...sampleSurvey, type: 'stars' as const };
    const theme = createThemeForMode('shadcn');
    const { rerender } = render(<ThemeProvider theme={theme}><SurveyForm survey={survey} onSubmit={() => undefined} /></ThemeProvider>);
    const first = screen.getByRole('button', { name: 'Score 1' });
    const fourth = screen.getByRole('button', { name: 'Score 4' });
    await user.click(first);
    await user.hover(fourth);
    expect(fourth).toHaveTextContent('★');
    await user.pointer({ target: fourth, keys: '[MouseLeft>]' });
    expect(fourth).toHaveTextContent('☆');
    await user.pointer({ target: screen.getByRole('button', { name: 'Score 5' }) });
    expect(screen.getByRole('button', { name: 'Score 5' })).toHaveTextContent('☆');
    await user.pointer({ target: fourth, keys: '[/MouseLeft]' });
    rerender(<ThemeProvider theme={theme}><SurveyForm survey={survey} onSubmit={() => undefined} pending /></ThemeProvider>);
    await user.hover(screen.getByRole('button', { name: 'Score 5' }));
    expect(screen.getByRole('button', { name: 'Score 5' })).toHaveTextContent('☆');
    screen.getAllByRole('button', { name: /^Score \d+$/ }).forEach((button) => expect(button).toBeDisabled());
  });
  it('keeps NPS tiles numeric with only the selected tile contained during hover', async () => {
    render(<SurveyForm survey={sampleSurvey} onSubmit={() => undefined} />);
    await userEvent.click(screen.getByRole('button', { name: 'Score 7' }));
    await userEvent.hover(screen.getByRole('button', { name: 'Score 9' }));
    screen.getAllByRole('button', { name: /^Score \d+$/ }).forEach((button, index) => {
      expect(button).toHaveTextContent(String(index));
      expect(button).toHaveClass(index === 7 ? 'MuiButton-contained' : 'MuiButton-outlined');
      expect(button).toHaveAttribute('aria-pressed', String(index === 7));
      expect(button).not.toHaveTextContent(/[★☆]/);
    });
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
