import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RichTextContent } from './RichTextContent.js';

describe('RichTextContent', () => {
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

    expect(screen.getByTestId('content').innerHTML).toBe(html);
  });

  it('continues removing scripts, event handlers, and unsafe URLs', () => {
    render(<RichTextContent data-testid="content" html={'<script>alert(1)</script><p onclick="alert(1)">Text</p><a href="javascript:alert(1)">Link</a><img src="https://example.test/image.png" onerror="alert(1)">'} />);

    expect(screen.getByTestId('content').querySelector('script, [onclick], [onerror], a[href]')).toBeNull();
  });
});
