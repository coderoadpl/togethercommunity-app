import { useRef, useState } from 'react';
import {
  Button,
  FormControl,
  FormLabel,
  OutlinedInput,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';

import { useTranslations } from '../../i18n/index.js';
import { RichTextContent } from './RichTextContent.js';

export const HtmlEditor = ({
  id,
  value,
  onChange,
  fieldLabel,
  size,
  minRows = 4,
}: {
  id: string;
  value: string;
  onChange: (html: string) => void;
  fieldLabel: string;
  size?: 'small' | 'medium';
  minRows?: number;
}) => {
  const t = useTranslations();
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const surround = (before: string, after: string, placeholder: string) => {
    const element = inputRef.current;
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? value.length;
    const selected = value.slice(start, end) || placeholder;
    onChange(`${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`);
    requestAnimationFrame(() => {
      if (element === null) return;
      element.focus();
      const caret = start + before.length;
      element.setSelectionRange(caret, caret + selected.length);
    });
  };

  const tools = [
    {
      key: 'bold',
      label: t.htmlEditor.toolbarBold,
      apply: () => surround('<strong>', '</strong>', t.htmlEditor.placeholderBold),
    },
    {
      key: 'italic',
      label: t.htmlEditor.toolbarItalic,
      apply: () => surround('<em>', '</em>', t.htmlEditor.placeholderItalic),
    },
    {
      key: 'heading',
      label: t.htmlEditor.toolbarHeading,
      apply: () => surround('<h3>', '</h3>', t.htmlEditor.placeholderHeading),
    },
    {
      key: 'list',
      label: t.htmlEditor.toolbarList,
      apply: () => surround('<ul>\n  <li>', '</li>\n</ul>', t.htmlEditor.placeholderList),
    },
    {
      key: 'code',
      label: t.htmlEditor.toolbarCode,
      apply: () => surround('<code>', '</code>', t.htmlEditor.placeholderCode),
    },
  ];

  return (
    <Stack useFlexGap spacing="0.6rem">
      <Tabs
        value={tab}
        onChange={(_event, next: 'edit' | 'preview') => setTab(next)}
        aria-label={t.htmlEditor.tabsAria}
      >
        <Tab value="edit" label={t.htmlEditor.editTab} />
        <Tab value="preview" label={t.htmlEditor.previewTab} />
      </Tabs>
      {tab === 'edit' ? (
        <>
          <Stack
            direction="row"
            useFlexGap
            spacing="0.35rem"
            sx={{ flexWrap: 'wrap' }}
            data-testid="html-toolbar"
          >
            {tools.map((tool) => (
              <Button key={tool.key} size="small" variant="outlined" onClick={tool.apply}>
                {tool.label}
              </Button>
            ))}
          </Stack>
          <FormControl fullWidth size={size}>
            <FormLabel htmlFor={id}>{fieldLabel}</FormLabel>
            <OutlinedInput
              id={id}
              size={size}
              value={value}
              multiline
              minRows={minRows}
              inputRef={inputRef}
              onChange={(event) => onChange(event.target.value)}
            />
          </FormControl>
        </>
      ) : value.trim().length === 0 ? (
        <Typography variant="caption" data-testid="html-preview-empty">
          {t.htmlEditor.previewEmpty}
        </Typography>
      ) : (
        <RichTextContent html={value} data-testid="html-preview" />
      )}
    </Stack>
  );
};
