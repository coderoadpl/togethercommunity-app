import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { en } from '../../i18n/en.js';
import { LanguageProvider } from '../../i18n/index.js';
import { MarkdownEditor } from './MarkdownEditor.js';

const ControlledEditor = ({ initialValue = '' }: { initialValue?: string }) => {
  const [value, setValue] = useState(initialValue);
  return (
    <LanguageProvider>
      <MarkdownEditor
        value={value}
        onChange={setValue}
        placeholder="Write something"
        minRows={5}
        testId="markdown-editor"
        aria-label="Article body"
      />
      <output data-testid="markdown-value">{value}</output>
    </LanguageProvider>
  );
};

beforeAll(() => {
  document.elementFromPoint = () => document.activeElement;
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() });
});

describe('MarkdownEditor', () => {
  it('round-trips supported Markdown structures through the visual editor', async () => {
    const value = [
      '# Document title',
      '',
      '## Heading',
      '',
      'Text with **bold**, _italic_, `inline code`, and a [safe link](https://example.com/docs).',
      '',
      '- First bullet',
      '- Second bullet',
      '',
      '1. First step',
      '2. Second step',
      '',
      '> A useful quote',
      '',
      '```ts',
      'const answer = 42;',
      '```',
    ].join('\n');
    const user = userEvent.setup();
    render(<ControlledEditor initialValue={value} />);

    const visualEditor = await screen.findByTestId('markdown-editor-wysiwyg');
    visualEditor.focus();
    await user.keyboard('x{Backspace}');
    await user.click(screen.getByRole('tab', { name: en.markdownEditor.markdownTab }));

    await waitFor(() => expect(screen.getByTestId('markdown-editor-markdown')).toHaveValue(value));
  });

  it('keeps rules, strike-through, and HTTPS images through the visual editor', async () => {
    const value = [
      'An ![illustration](https://example.com/picture.png).',
      '',
      '---',
      '',
      '~~Withdrawn clause~~',
    ].join('\n');
    const user = userEvent.setup();
    render(<ControlledEditor initialValue={value} />);

    const visualEditor = await screen.findByTestId('markdown-editor-wysiwyg');
    expect(visualEditor.querySelector('img')).toHaveAttribute('src', 'https://example.com/picture.png');
    visualEditor.focus();
    await user.keyboard('x{Backspace}');

    await waitFor(() => expect(screen.getByTestId('markdown-value')).toHaveTextContent('Withdrawn clause'));
    expect(screen.getByTestId('markdown-value').textContent).toBe(value);
  });

  it('keeps tables and raw HTML on the Markdown tab instead of dropping them', async () => {
    const value = [
      '| Plan | Price |',
      '| --- | --- |',
      '| Basic | 10 |',
      '',
      '<div class="callout">Legacy block</div>',
    ].join('\n');
    render(<ControlledEditor initialValue={value} />);

    expect(await screen.findByText(en.markdownEditor.sourceOnlyHint)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: en.markdownEditor.editorTab })).toBeDisabled();
    expect(screen.getByTestId('markdown-editor-markdown')).toHaveValue(value);
    expect(screen.queryByTestId('markdown-editor-wysiwyg')).not.toBeInTheDocument();
  });

  it('keeps task lists on the Markdown tab instead of dropping the checkboxes', () => {
    render(<ControlledEditor initialValue={'- [ ] todo item\n- [x] done item'} />);

    expect(screen.getByText(en.markdownEditor.sourceOnlyHint)).toBeInTheDocument();
    expect(screen.getByTestId('markdown-editor-markdown')).toHaveValue('- [ ] todo item\n- [x] done item');
    expect(screen.queryByTestId('markdown-editor-wysiwyg')).not.toBeInTheDocument();
  });

  it('keeps the visual editor available for autolinks', async () => {
    render(<ControlledEditor initialValue={'See <https://example.com> or write to <hello@example.com>.'} />);

    expect(await screen.findByTestId('markdown-editor-wysiwyg')).toBeInTheDocument();
    expect(screen.queryByText(en.markdownEditor.sourceOnlyHint)).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: en.markdownEditor.editorTab })).toBeEnabled();
  });

  it('lets a read-only editor be inspected as raw Markdown', async () => {
    const user = userEvent.setup();
    render(
      <LanguageProvider>
        <MarkdownEditor
          value="## Sent message"
          onChange={() => undefined}
          disabled
          testId="locked-editor"
          aria-label="Sent content"
        />
      </LanguageProvider>,
    );

    await user.click(screen.getByRole('tab', { name: en.markdownEditor.markdownTab }));
    const source = screen.getByTestId('locked-editor-markdown');
    expect(source).toHaveValue('## Sent message');
    expect(source).toHaveAttribute('readonly');
    expect(source).toBeEnabled();
  });

  it('applies bold and italic keyboard shortcuts', async () => {
    const user = userEvent.setup();
    render(<ControlledEditor />);

    const visualEditor = await screen.findByTestId('markdown-editor-wysiwyg');
    visualEditor.focus();
    await user.keyboard('{Control>}b{/Control}strong{Control>}b{/Control} and {Control>}i{/Control}slanted{Control>}i{/Control}');

    await waitFor(() => expect(screen.getByTestId('markdown-value').textContent).toBe('**strong** and _slanted_'));
  });

  it('turns a URL pasted onto a selection into a link', async () => {
    const user = userEvent.setup();
    render(<ControlledEditor initialValue="Read the guide" />);

    const visualEditor = await screen.findByTestId('markdown-editor-wysiwyg');
    visualEditor.focus();
    await user.keyboard('{Control>}a{/Control}');
    fireEvent.paste(visualEditor, {
      clipboardData: {
        getData: (type: string) => type === 'text/plain' ? 'https://example.com/guide' : '',
        types: ['text/plain'],
      },
    });

    await waitFor(() => expect(screen.getByTestId('markdown-value').textContent).toBe('[Read the guide](https://example.com/guide)'));
  });

  it('keeps one Markdown value while switching between tabs', async () => {
    const user = userEvent.setup();
    render(<ControlledEditor />);

    await user.click(screen.getByRole('tab', { name: en.markdownEditor.markdownTab }));
    const source = '## Release notes\n\n- **Fast** editing\n- [Safe links](https://example.com)';
    fireEvent.change(screen.getByTestId('markdown-editor-markdown'), { target: { value: source } });
    await user.click(screen.getByRole('tab', { name: en.markdownEditor.editorTab }));

    expect(await screen.findByRole('heading', { level: 2, name: 'Release notes' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Safe links' })).toHaveAttribute('href', 'https://example.com/');

    await user.click(screen.getByRole('tab', { name: en.markdownEditor.markdownTab }));
    expect(screen.getByTestId('markdown-editor-markdown')).toHaveValue(source);
  });

  it('validates link protocols in the link dialog', async () => {
    const user = userEvent.setup();
    render(<ControlledEditor initialValue="Selected words" />);

    const visualEditor = await screen.findByTestId('markdown-editor-wysiwyg');
    fireEvent.keyDown(visualEditor, { key: 'k', ctrlKey: true });
    const input = screen.getByRole('textbox', { name: en.markdownEditor.linkUrlLabel });
    await user.clear(input);
    await user.type(input, 'javascript:alert(1)');
    await user.click(screen.getByRole('button', { name: en.markdownEditor.linkApply }));
    expect(screen.getByText(en.markdownEditor.linkInvalid)).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, 'https://example.com/guide');
    await user.click(screen.getByRole('button', { name: en.markdownEditor.linkApply }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('keeps documents with unrepresentable link or image destinations on the Markdown tab instead of dropping them', () => {
    const value = '[Unsafe](javascript:alert(1)) [HTTP](http://example.com) [Safe](https://example.com) ![Unsafe image](http://example.com/image.png)';
    render(<ControlledEditor initialValue={value} />);

    expect(screen.getByText(en.markdownEditor.sourceOnlyHint)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: en.markdownEditor.editorTab })).toBeDisabled();
    expect(screen.getByTestId('markdown-editor-markdown')).toHaveValue(value);
    expect(screen.queryByTestId('markdown-editor-wysiwyg')).not.toBeInTheDocument();
  });

  it('keeps documents with root-relative or template-variable link destinations on the Markdown tab', () => {
    const value = '[Privacy](/privacy) and [Unsubscribe]({{unsubscribeUrl}})';
    render(<ControlledEditor initialValue={value} />);

    expect(screen.getByText(en.markdownEditor.sourceOnlyHint)).toBeInTheDocument();
    expect(screen.getByTestId('markdown-editor-markdown')).toHaveValue(value);
    expect(screen.queryByTestId('markdown-editor-wysiwyg')).not.toBeInTheDocument();
  });

  it('sanitizes unsafe HTML paste attributes in the visual editor', async () => {
    const onChange = vi.fn();
    render(
      <LanguageProvider>
        <MarkdownEditor
          value="[Safe](https://example.com)"
          onChange={onChange}
          testId="secure-editor"
          aria-label="Secure content"
        />
      </LanguageProvider>,
    );

    const visualEditor = await screen.findByTestId('secure-editor-wysiwyg');
    expect(screen.getByRole('link', { name: 'Safe' })).toHaveAttribute('href', 'https://example.com/');

    const previousCalls = onChange.mock.calls.length;
    visualEditor.focus();
    fireEvent.paste(visualEditor, {
      clipboardData: {
        getData: (type: string) => {
          if (type === 'text/html') return '<p><strong>Pasted</strong> <a href="javascript:alert(1)">unsafe</a><img src="http://example.com/unsafe.png" alt="unsafe image"></p><script>alert(1)</script>';
          if (type === 'text/plain') return 'Pasted unsafe';
          return '';
        },
        types: ['text/html', 'text/plain'],
      },
    });

    await waitFor(() => expect(onChange.mock.calls.length).toBeGreaterThan(previousCalls));
    const latest = onChange.mock.lastCall?.[0];
    expect(latest).toContain('**Pasted**');
    expect(latest).not.toContain('javascript:');
    expect(latest).not.toContain('http://example.com/unsafe.png');
    expect(latest).not.toContain('<script');
  });
});
