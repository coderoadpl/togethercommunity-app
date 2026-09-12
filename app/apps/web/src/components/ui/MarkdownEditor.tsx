import CodeBlock from '@tiptap/extension-code-block';
import Image from '@tiptap/extension-image';
import Italic from '@tiptap/extension-italic';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from '@tiptap/markdown';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Tab,
  Tabs,
  TextField,
} from '@mui/material';
import { useEffect, useId, useImperativeHandle, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';

import { useTranslations } from '../../i18n/index.js';
import { MarkdownEditorContent, MarkdownEditorToolbar, MarkdownSourceInput } from '../../theme.js';

export interface MarkdownEditorHandle {
  focus: () => void;
}

export interface MarkdownEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  minRows?: number;
  disabled?: boolean;
  testId?: string;
  ref?: Ref<MarkdownEditorHandle>;
  'aria-label': string;
  'aria-describedby'?: string;
}

const linkWithProtocols = (value: string, protocols: readonly string[]): string | null => {
  try {
    const url = new URL(value.trim());
    if (!protocols.includes(url.protocol)) return null;
    if (url.protocol === 'mailto:') return url.pathname.includes('@') ? url.href : null;
    return url.hostname === '' ? null : url.href;
  } catch {
    return null;
  }
};

const authoredLink = (value: string): string | null => linkWithProtocols(value, ['https:', 'mailto:']);

const httpsImage = (value: unknown): string | null =>
  typeof value === 'string' ? linkWithProtocols(value, ['https:']) : null;

const SafeLink = Link.extend({
  parseMarkdown: (token, helpers) => {
    const content = helpers.parseInline(token.tokens ?? []);
    const href = authoredLink(typeof token.href === 'string' ? token.href : '');
    return href === null
      ? content
      : helpers.applyMark('link', content, { href, title: token.title ?? null });
  },
});

const SafeImage = Image.extend({
  parseHTML: () => [{ tag: 'img[src^="https://"]' }],
  parseMarkdown: (token, helpers) => {
    const src = httpsImage(token.href);
    return src === null
      ? helpers.createTextNode(typeof token.text === 'string' ? token.text : '')
      : helpers.createNode('image', {
        src,
        title: typeof token.title === 'string' ? token.title : null,
        alt: typeof token.text === 'string' ? token.text : null,
      });
  },
  addInputRules: () => [],
});

const UnderscoreItalic = Italic.extend({
  renderMarkdown: (node, helpers) => `_${helpers.renderChildren(node)}_`,
});

const codeSpans = /```[\s\S]*?(?:```|$)|`[^`\n]*`/gu;
const autolinks = /<[a-zA-Z][a-zA-Z0-9+.-]*:[^\s<>]*>|<[^\s<>@]+@[^\s<>@]+>/gu;
const tableDelimiterRow = /^ {0,3}\|?[ \t]*:?-{2,}:?[ \t]*(?:\|[ \t]*:?-{2,}:?[ \t]*)+\|?[ \t]*$/mu;
const taskListItem = /^ {0,7}[-*+] \[[ xX]\](?:\s|$)/mu;
const htmlTag = /<\/?[a-zA-Z][^>]*>/u;

const needsSourceOnlyEditing = (value: string): boolean => {
  const prose = value.replace(codeSpans, '').replace(autolinks, '');
  return tableDelimiterRow.test(prose) || taskListItem.test(prose) || htmlTag.test(prose);
};

const editorExtensions = (placeholder: string) => [
  StarterKit.configure({
    codeBlock: false,
    heading: { levels: [1, 2, 3] },
    italic: false,
    link: false,
    trailingNode: false,
    underline: false,
  }),
  CodeBlock,
  SafeImage.configure({ inline: true }),
  UnderscoreItalic,
  SafeLink.configure({
    autolink: true,
    defaultProtocol: 'https',
    enableClickSelection: true,
    isAllowedUri: (url) => authoredLink(url) !== null,
    linkOnPaste: true,
    markdownLinks: true,
    openOnClick: false,
    protocols: ['mailto'],
    shouldAutoLink: (url) => authoredLink(url) !== null,
  }),
  Placeholder.configure({ placeholder }),
  Markdown.configure({ markedOptions: { gfm: true } }),
];

const FormatButton = ({
  active,
  disabled,
  label,
  shortLabel,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  label: string;
  shortLabel: ReactNode;
  onClick: () => void;
}) => (
  <Button
    type="button"
    size="small"
    variant={active ? 'contained' : 'outlined'}
    aria-label={label}
    aria-pressed={active}
    title={label}
    disabled={disabled}
    onMouseDown={(event) => event.preventDefault()}
    onClick={onClick}
    sx={{ minWidth: '2.35rem', px: '0.6rem' }}
  >
    {shortLabel}
  </Button>
);

const ActionButton = ({
  disabled,
  label,
  shortLabel,
  onClick,
}: {
  disabled: boolean;
  label: string;
  shortLabel: ReactNode;
  onClick: () => void;
}) => (
  <Button
    type="button"
    size="small"
    variant="outlined"
    aria-label={label}
    title={label}
    disabled={disabled}
    onMouseDown={(event) => event.preventDefault()}
    onClick={onClick}
    sx={{ minWidth: '2.35rem', px: '0.6rem' }}
  >
    {shortLabel}
  </Button>
);

const linkHref = (value: unknown): string => {
  if (typeof value !== 'object' || value === null || !('href' in value)) return '';
  return typeof value.href === 'string' ? value.href : '';
};

export const MarkdownEditor = ({
  value,
  onChange,
  placeholder = '',
  minRows = 6,
  disabled = false,
  testId,
  ref,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
}: MarkdownEditorProps) => {
  const t = useTranslations();
  const tabsId = useId();
  const [mode, setMode] = useState<'editor' | 'markdown'>('editor');
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const [linkAttempted, setLinkAttempted] = useState(false);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const sourceOnly = needsSourceOnlyEditing(value);
  const editor = useEditor({
    content: value,
    contentType: 'markdown',
    editable: !disabled,
    extensions: editorExtensions(placeholder),
    editorProps: {
      attributes: {
        'aria-label': ariaLabel,
        'aria-multiline': 'true',
        id: testId === undefined ? `${tabsId}-editor` : `${testId}-wysiwyg`,
        role: 'textbox',
        ...(ariaDescribedBy === undefined ? {} : { 'aria-describedby': ariaDescribedBy }),
        ...(disabled ? { 'aria-disabled': 'true' } : {}),
        ...(testId === undefined ? {} : { 'data-testid': `${testId}-wysiwyg` }),
      },
    },
    onUpdate: ({ editor: current }) => onChange(current.getMarkdown()),
  }, [ariaDescribedBy, ariaLabel, disabled, placeholder, tabsId, testId]);

  // While the surface has focus its own keystrokes arrive back as a prop one render later; replaying them would rewind the caret.
  useEffect(() => {
    if (editor === null || sourceOnly || editor.isFocused || editor.getMarkdown() === value) return;
    editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false });
  }, [editor, mode, sourceOnly, value]);

  const toolbar = useEditorState({
    editor,
    selector: ({ editor: current }) => current === null ? null : ({
      blockquote: current.isActive('blockquote'),
      bold: current.isActive('bold'),
      bulletList: current.isActive('bulletList'),
      canRedo: current.can().redo(),
      canUndo: current.can().undo(),
      code: current.isActive('code'),
      codeBlock: current.isActive('codeBlock'),
      heading2: current.isActive('heading', { level: 2 }),
      heading3: current.isActive('heading', { level: 3 }),
      italic: current.isActive('italic'),
      link: current.isActive('link'),
      orderedList: current.isActive('orderedList'),
    }),
  });

  const openLinkDialog = () => {
    if (editor === null || disabled) return;
    const currentHref = linkHref(editor.getAttributes('link'));
    setLinkValue(currentHref === '' ? 'https://' : currentHref);
    setLinkAttempted(false);
    setLinkOpen(true);
  };

  const closeLinkDialog = () => {
    setLinkOpen(false);
    setLinkAttempted(false);
    requestAnimationFrame(() => editor?.commands.focus());
  };

  const applyLink = () => {
    const href = authoredLink(linkValue);
    setLinkAttempted(true);
    if (editor === null || href === null) return;
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    closeLinkDialog();
  };

  const removeLink = () => {
    editor?.chain().focus().extendMarkRange('link').unsetLink().run();
    closeLinkDialog();
  };

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!disabled && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openLinkDialog();
    }
  };

  const editorDisabled = disabled || editor === null;
  const editorPanelId = `${tabsId}-editor-panel`;
  const markdownPanelId = `${tabsId}-markdown-panel`;
  const linkTitleId = `${tabsId}-link-title`;
  const activeMode = sourceOnly ? 'markdown' : mode;

  useImperativeHandle(ref, () => ({
    focus: () => {
      if (activeMode === 'markdown' || editorDisabled) sourceRef.current?.focus();
      else editor?.commands.focus();
    },
  }), [activeMode, editor, editorDisabled]);

  return (
    <Box data-testid={testId} sx={{ minWidth: 0 }}>
      {sourceOnly ? <Alert severity="info" sx={{ mb: '0.55rem' }}>{t.markdownEditor.sourceOnlyHint}</Alert> : null}
      <Tabs
        value={activeMode}
        onChange={(_event, next: 'editor' | 'markdown') => setMode(next)}
        aria-label={t.markdownEditor.tabsAria}
        variant="fullWidth"
        sx={{ minHeight: '2.75rem' }}
      >
        <Tab id={`${tabsId}-editor-tab`} aria-controls={editorPanelId} value="editor" label={t.markdownEditor.editorTab} disabled={sourceOnly} sx={{ minHeight: '2.75rem' }} />
        <Tab id={`${tabsId}-markdown-tab`} aria-controls={markdownPanelId} value="markdown" label={t.markdownEditor.markdownTab} sx={{ minHeight: '2.75rem' }} />
      </Tabs>
      {activeMode === 'editor' ? (
        <Paper
          id={editorPanelId}
          role="tabpanel"
          aria-labelledby={`${tabsId}-editor-tab`}
          variant="outlined"
          sx={{ overflow: 'hidden' }}
        >
          <MarkdownEditorToolbar
            direction="row"
            useFlexGap
            spacing="0.35rem"
            role="toolbar"
            aria-label={t.markdownEditor.toolbarAria}
            sx={{ flexWrap: 'wrap', p: '0.55rem' }}
          >
            <FormatButton active={toolbar?.bold ?? false} disabled={editorDisabled} label={t.markdownEditor.bold} shortLabel={<strong>B</strong>} onClick={() => editor?.chain().focus().toggleBold().run()} />
            <FormatButton active={toolbar?.italic ?? false} disabled={editorDisabled} label={t.markdownEditor.italic} shortLabel={<em>I</em>} onClick={() => editor?.chain().focus().toggleItalic().run()} />
            <FormatButton active={toolbar?.heading2 ?? false} disabled={editorDisabled} label={t.markdownEditor.heading2} shortLabel="H2" onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} />
            <FormatButton active={toolbar?.heading3 ?? false} disabled={editorDisabled} label={t.markdownEditor.heading3} shortLabel="H3" onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} />
            <FormatButton active={toolbar?.bulletList ?? false} disabled={editorDisabled} label={t.markdownEditor.bulletList} shortLabel="•" onClick={() => editor?.chain().focus().toggleBulletList().run()} />
            <FormatButton active={toolbar?.orderedList ?? false} disabled={editorDisabled} label={t.markdownEditor.orderedList} shortLabel="1." onClick={() => editor?.chain().focus().toggleOrderedList().run()} />
            <FormatButton active={toolbar?.blockquote ?? false} disabled={editorDisabled} label={t.markdownEditor.blockquote} shortLabel="❝" onClick={() => editor?.chain().focus().toggleBlockquote().run()} />
            <FormatButton active={toolbar?.code ?? false} disabled={editorDisabled} label={t.markdownEditor.inlineCode} shortLabel="&lt;/&gt;" onClick={() => editor?.chain().focus().toggleCode().run()} />
            <FormatButton active={toolbar?.codeBlock ?? false} disabled={editorDisabled} label={t.markdownEditor.codeBlock} shortLabel="{ }" onClick={() => editor?.chain().focus().toggleCodeBlock().run()} />
            <FormatButton active={toolbar?.link ?? false} disabled={editorDisabled} label={t.markdownEditor.link} shortLabel="↗" onClick={openLinkDialog} />
            <ActionButton disabled={editorDisabled || !(toolbar?.canUndo ?? false)} label={t.markdownEditor.undo} shortLabel="↶" onClick={() => editor?.chain().focus().undo().run()} />
            <ActionButton disabled={editorDisabled || !(toolbar?.canRedo ?? false)} label={t.markdownEditor.redo} shortLabel="↷" onClick={() => editor?.chain().focus().redo().run()} />
          </MarkdownEditorToolbar>
          <MarkdownEditorContent
            onKeyDownCapture={keyDown}
            rows={minRows}
            data-disabled={disabled}
          >
            <EditorContent editor={editor} />
          </MarkdownEditorContent>
        </Paper>
      ) : (
        <Box id={markdownPanelId} role="tabpanel" aria-labelledby={`${tabsId}-markdown-tab`} sx={{ pt: '0.55rem' }}>
          <MarkdownSourceInput
            fullWidth
            multiline
            minRows={minRows}
            value={value}
            readOnly={disabled}
            placeholder={placeholder}
            inputRef={sourceRef}
            onChange={(event) => onChange(event.target.value)}
            inputProps={{
              'aria-label': ariaLabel,
              ...(ariaDescribedBy === undefined ? {} : { 'aria-describedby': ariaDescribedBy }),
              'data-testid': testId === undefined ? undefined : `${testId}-markdown`,
            }}
          />
        </Box>
      )}
      <Dialog open={linkOpen} onClose={closeLinkDialog} fullWidth maxWidth="xs" aria-labelledby={linkTitleId}>
        <DialogTitle id={linkTitleId}>{t.markdownEditor.linkDialogTitle}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            margin="dense"
            label={t.markdownEditor.linkUrlLabel}
            value={linkValue}
            error={linkAttempted && authoredLink(linkValue) === null}
            helperText={linkAttempted && authoredLink(linkValue) === null ? t.markdownEditor.linkInvalid : ' '}
            onChange={(event) => setLinkValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              applyLink();
            }}
          />
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap' }}>
          {toolbar?.link ? <Button type="button" color="error" onClick={removeLink}>{t.markdownEditor.linkRemove}</Button> : null}
          <Button type="button" onClick={closeLinkDialog}>{t.common.cancel}</Button>
          <Button type="button" variant="contained" onClick={applyLink}>{t.markdownEditor.linkApply}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
