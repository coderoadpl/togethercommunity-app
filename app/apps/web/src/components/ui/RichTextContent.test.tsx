import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { en } from '../../i18n/en.js';
import { RichTextContent } from './RichTextContent.js';
import { stylesAt } from '../../lib/stylesheet.js';

describe('RichTextContent', () => {
  it('keeps shared previews left aligned unless centring is requested', () => {
    const view = render(<RichTextContent data-testid="content" html="<p>Product description.</p>" />);
    expect(stylesAt(screen.getByTestId('content'), 1440)['margin-inline']).toBe('0px');
    view.rerender(<RichTextContent centered data-testid="content" html="<p>Lesson reading.</p>" />);
    expect(stylesAt(screen.getByTestId('content'), 1440)['margin-inline']).toBe('auto');
  });

  it('removes forms, associated controls, and submission attributes', () => {
    render(<RichTextContent data-testid="content" html={`
      <form id="mutation" action="/api/tenant-secrets" method="post">
        <fieldset><legend>Settings</legend><label>Secret<input name="value"></label></fieldset>
        <button formaction="https://external.example.test/submit">Save</button>
        <select><optgroup label="Choices"><option>Choice</option></optgroup></select>
        <textarea>Value</textarea><datalist><option>Suggestion</option></datalist><output>Result</output>
        <p><strong>Lesson text</strong></p>
      </form>
      <input form="mutation" type="image" src="https://example.test/submit.png">
      <button form="mutation" formaction="/api/tenant-secrets">Submit</button>
      <object data="https://external.example.test/form"></object><embed src="https://external.example.test/form">
      <p form="mutation" action="/api/tenant-secrets" method="post" enctype="text/plain"
        formaction="/api/tenant-secrets" formmethod="post" formenctype="text/plain"
        formtarget="_self" formnovalidate>Safe paragraph</p>
    `} />);

    const content = screen.getByTestId('content');
    expect(content.querySelector('form, input, button, select, textarea, option, optgroup, label, fieldset, legend, datalist, output, object, embed')).toBeNull();
    expect(content.querySelector('[form], [action], [method], [enctype], [formaction], [formmethod], [formenctype], [formtarget], [formnovalidate]')).toBeNull();
    expect(content.querySelector('strong')).toHaveTextContent('Lesson text');
    expect(content).toHaveTextContent('Safe paragraph');
  });

  it('preserves safe formatting, links, images, lists, and tables', () => {
    const html = '<h2>Title</h2><p><strong>Bold</strong> <em>Emphasis</em><br><a href="https://example.test/lesson">Link</a></p><blockquote>Quote</blockquote><ul><li>Item</li></ul><pre><code>code</code></pre><img src="https://example.test/image.png" alt="Diagram"><table><tbody><tr><td>Cell</td></tr></tbody></table>';
    render(<RichTextContent data-testid="content" html={html} />);

    const content = screen.getByTestId('content');
    expect(content.querySelector('h2')).toHaveTextContent('Title');
    expect(content.querySelector('strong')).toHaveTextContent('Bold');
    expect(content.querySelector('em')).toHaveTextContent('Emphasis');
    expect(content.querySelector('a')).toHaveAttribute('href', 'https://example.test/lesson');
    expect(content.querySelector('blockquote')).toHaveTextContent('Quote');
    expect(content.querySelector('li')).toHaveTextContent('Item');
    expect(content.querySelector('pre code')).toHaveTextContent('code');
    expect(content.querySelector('img')).toHaveAttribute('src', 'https://example.test/image.png');
    expect(content.querySelector('td')).toHaveTextContent('Cell');
  });

  it('continues removing scripts, event handlers, and unsafe URLs', () => {
    render(<RichTextContent data-testid="content" html={'<script>alert(1)</script><p onclick="alert(1)">Text</p><a href="javascript:alert(1)">Link</a><img src="https://example.test/image.png" onerror="alert(1)">'} />);

    expect(screen.getByTestId('content').querySelector('script, [onclick], [onerror], a[href]')).toBeNull();
  });

  it.each(['svg', 'png'])('opens a %s image with its figure caption and closes with Escape, restoring focus', async (extension) => {
    const user = userEvent.setup();
    render(<RichTextContent html={`<figure><img src="/diagram.${extension}" alt="Diagram"><figcaption>Layout <strong>overview</strong></figcaption></figure>`} />);
    const trigger = screen.getByRole('button', { name: en.lesson.enlargeImage });
    expect(trigger).toHaveAttribute('tabindex', '0');
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');

    await user.click(trigger);

    const dialog = screen.getByRole('dialog', { name: en.lesson.enlargeImage });
    expect(dialog).toHaveAccessibleDescription('Layout overview');
    expect(within(dialog).getByText('Layout overview')).toBeVisible();
    expect(within(dialog).getByRole('img', { name: 'Diagram' })).toHaveAttribute('src', new URL(`/diagram.${extension}`, document.baseURI).href);
    expect(document.body.style.overflow).toBe('hidden');
    expect(within(dialog).getByRole('button', { name: en.common.close })).toHaveFocus();

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it.each(['{Enter}', ' '])('opens a bare image using %s and uses alt as its caption', async (key) => {
    const user = userEvent.setup();
    render(<RichTextContent html={'<img src="/diagram.svg" alt="Floor plan">'} />);
    const trigger = screen.getByRole('button', { name: en.lesson.enlargeImage });
    await user.tab();
    expect(trigger).toHaveFocus();

    await user.keyboard(key);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Floor plan')).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: en.common.close }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('keeps linked images as links without lightbox activation', async () => {
    const user = userEvent.setup();
    render(<RichTextContent html={'<a href="#details"><img src="/diagram.svg" alt="Read details"></a>'} />);
    const link = screen.getByRole('link', { name: 'Read details' });
    const image = within(link).getByRole('img');
    expect(link).toHaveAttribute('href', '#details');
    expect(image).not.toHaveAttribute('tabindex');
    expect(image).not.toHaveAttribute('aria-haspopup');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    await user.click(image);
    fireEvent.keyDown(image, { key: 'Enter' });
    fireEvent.keyDown(image, { key: ' ' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    link.focus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on backdrop click and restores focus', async () => {
    const user = userEvent.setup();
    const { baseElement } = render(<RichTextContent html={'<img src="/diagram.svg" alt="Diagram">'} />);
    const trigger = screen.getByRole('button', { name: en.lesson.enlargeImage });
    await user.click(trigger);
    const backdrop = baseElement.querySelector('.MuiBackdrop-root');
    expect(backdrop).not.toBeNull();
    if (backdrop === null) throw new Error('Missing lightbox backdrop');
    fireEvent.click(backdrop);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('clears the selection when lesson HTML changes and keeps it closed on returning', async () => {
    const user = userEvent.setup();
    const html = '<img src="/diagram.svg" alt="Diagram">';
    const { rerender } = render(<RichTextContent html={html} />);
    await user.click(screen.getByRole('button', { name: en.lesson.enlargeImage }));
    rerender(<RichTextContent html="<p>Next lesson</p>" />);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Next lesson')).toBeVisible();
    expect(document.body.style.overflow).not.toBe('hidden');

    rerender(<RichTextContent html={html} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).not.toBe('hidden');
    await user.click(screen.getByRole('button', { name: en.lesson.enlargeImage }));
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(document.body.style.overflow).toBe('hidden');
  });
});
