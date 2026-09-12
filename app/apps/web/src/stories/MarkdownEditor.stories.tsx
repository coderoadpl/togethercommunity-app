import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box } from '@mui/material';
import { userEvent, within } from 'storybook/test';

import { MarkdownEditor, type MarkdownEditorProps } from '../components/ui/MarkdownEditor.js';
import { useTranslations } from '../i18n/index.js';
import { pl } from '../i18n/pl.js';
import { withAccountPreview } from './page-decorators.js';

const StatefulEditor = ({ value: initialValue, ...props }: MarkdownEditorProps) => {
  const t = useTranslations();
  const [value, setValue] = useState(initialValue);
  return (
    <Box sx={{ maxWidth: '52rem', mx: 'auto' }}>
      <MarkdownEditor
        {...props}
        value={value}
        onChange={setValue}
        placeholder={t.marketing.bodyPlaceholder}
        aria-label={t.marketing.bodyLabel}
      />
    </Box>
  );
};

const meta = {
  title: 'Forms/MarkdownEditor',
  component: MarkdownEditor,
  decorators: [withAccountPreview],
  render: (args) => <StatefulEditor {...args} />,
  args: {
    value: '',
    onChange: () => undefined,
    minRows: 8,
    testId: 'story-markdown-editor',
    'aria-label': 'Message content',
  },
  parameters: {
    docs: { description: { component: 'A visual editor and raw Markdown source view backed by one canonical Markdown string.' } },
  },
} satisfies Meta<typeof MarkdownEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  parameters: { locale: 'en', colorScheme: 'light' },
};

export const LongContent: Story = {
  args: {
    value: [
      '## Monthly update',
      '',
      'This edition brings **faster publishing**, a calmer writing flow, and a short checklist for the week ahead.',
      '',
      '> Write for the reader who has only two minutes.',
      '',
      '- Review the draft',
      '- Check every link',
      '- Send a test message',
      '',
      '### What changed',
      '',
      'The editor keeps Markdown as the source while presenting familiar formatting controls.',
    ].join('\n'),
  },
  parameters: { locale: 'pl', colorScheme: 'light' },
  globals: { viewport: { value: 'mobile' } },
};

export const Code: Story = {
  args: {
    value: '## Integration example\n\nUse `pnpm run check` before publishing.\n\n```ts\nconst ready = true;\n```',
  },
  parameters: { locale: 'en', colorScheme: 'dark' },
};

export const Links: Story = {
  args: {
    value: '## Further reading\n\nOpen the [authoring guide](https://example.com/authoring) or email [support](mailto:support@example.com).',
  },
  parameters: { locale: 'pl', colorScheme: 'dark' },
  globals: { viewport: { value: 'mobile' } },
};

export const Disabled: Story = {
  args: {
    value: '## Published message\n\nThis content is now read-only.',
    disabled: true,
  },
  parameters: { locale: 'en', colorScheme: 'light' },
};

export const MarkdownTab: Story = {
  args: {
    value: '## Source view\n\nThe **canonical value** remains readable Markdown.',
  },
  parameters: { locale: 'pl', colorScheme: 'dark' },
  globals: { viewport: { value: 'mobile' } },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('tab', { name: pl.markdownEditor.markdownTab }));
  },
};
