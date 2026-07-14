import { useRef, useState, type FormEvent } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormLabel,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Paper,
  Select,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import DOMPurify from 'dompurify';

import { lessonBlockSchema, type CourseLesson, type LessonBlock } from '@core/domain/index.js';

import { actions } from '../../../api.js';
import { useLanguage, useTranslations, type Messages } from '../../../i18n/index.js';
import { formatDate } from '../../../lib/format.js';
import { Eyebrow, LessonHtmlContent } from '../../../theme.js';
import { errorMessage, MutationError } from './feedback.js';

type BlockType = LessonBlock['type'];

type BlockDraft =
  | { type: 'video'; storageKey: string; streamVideoId: string; streamLibraryId: string; streamCollectionId: string }
  | { type: 'embed'; embedUrl: string }
  | { type: 'pdf'; pdfUrl: string; name: string }
  | { type: 'link'; url: string; description: string }
  | { type: 'html'; html: string };

const BLOCK_TYPE_ORDER: BlockType[] = ['video', 'embed', 'pdf', 'link', 'html'];

const blockTypeLabel = (t: Messages, value: BlockType): string => {
  switch (value) {
    case 'video':
      return t.lessons.typeVideo;
    case 'embed':
      return t.lessons.typeEmbed;
    case 'pdf':
      return t.lessons.typePdf;
    case 'link':
      return t.lessons.typeLink;
    case 'html':
      return t.lessons.typeHtml;
  }
};

const emptyBlock = (type: BlockType): BlockDraft => {
  switch (type) {
    case 'video':
      return { type: 'video', storageKey: '', streamVideoId: '', streamLibraryId: '', streamCollectionId: '' };
    case 'embed':
      return { type: 'embed', embedUrl: '' };
    case 'pdf':
      return { type: 'pdf', pdfUrl: '', name: '' };
    case 'link':
      return { type: 'link', url: '', description: '' };
    case 'html':
      return { type: 'html', html: '' };
  }
};

const toDraft = (block: LessonBlock): BlockDraft => {
  switch (block.type) {
    case 'video':
      return {
        type: 'video',
        storageKey: block.storageKey,
        streamVideoId: block.streamVideoId,
        streamLibraryId: block.streamLibraryId ?? '',
        streamCollectionId: block.streamCollectionId ?? '',
      };
    case 'embed':
      return { type: 'embed', embedUrl: block.embedUrl };
    case 'pdf':
      return { type: 'pdf', pdfUrl: block.pdfUrl, name: block.name ?? '' };
    case 'link':
      return { type: 'link', url: block.url, description: block.description ?? '' };
    case 'html':
      return { type: 'html', html: block.html };
  }
};

const toBlock = (draft: BlockDraft): unknown => {
  switch (draft.type) {
    case 'video':
      return {
        type: 'video',
        storageKey: draft.storageKey,
        streamVideoId: draft.streamVideoId,
        ...(draft.streamLibraryId ? { streamLibraryId: draft.streamLibraryId } : {}),
        ...(draft.streamCollectionId ? { streamCollectionId: draft.streamCollectionId } : {}),
      };
    case 'embed':
      return { type: 'embed', embedUrl: draft.embedUrl };
    case 'pdf':
      return { type: 'pdf', pdfUrl: draft.pdfUrl, ...(draft.name ? { name: draft.name } : {}) };
    case 'link':
      return { type: 'link', url: draft.url, ...(draft.description ? { description: draft.description } : {}) };
    case 'html':
      return { type: 'html', html: draft.html };
  }
};

const parseBlocks = (
  drafts: BlockDraft[],
  t: Messages,
): { ok: true; blocks: LessonBlock[] } | { ok: false; message: string } => {
  const blocks: LessonBlock[] = [];
  for (const draft of drafts) {
    const parsed = lessonBlockSchema.safeParse(toBlock(draft));
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? t.lessons.invalidBlocks };
    blocks.push(parsed.data);
  }
  return { ok: true, blocks };
};

const HtmlBlockEditor = ({
  index,
  value,
  onChange,
}: {
  index: number;
  value: string;
  onChange: (html: string) => void;
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
      label: t.lessons.htmlToolbarBold,
      apply: () => surround('<strong>', '</strong>', t.lessons.htmlPlaceholderBold),
    },
    {
      key: 'italic',
      label: t.lessons.htmlToolbarItalic,
      apply: () => surround('<em>', '</em>', t.lessons.htmlPlaceholderItalic),
    },
    {
      key: 'heading',
      label: t.lessons.htmlToolbarHeading,
      apply: () => surround('<h3>', '</h3>', t.lessons.htmlPlaceholderHeading),
    },
    {
      key: 'list',
      label: t.lessons.htmlToolbarList,
      apply: () => surround('<ul>\n  <li>', '</li>\n</ul>', t.lessons.htmlPlaceholderList),
    },
    {
      key: 'code',
      label: t.lessons.htmlToolbarCode,
      apply: () => surround('<code>', '</code>', t.lessons.htmlPlaceholderCode),
    },
  ];

  return (
    <Stack useFlexGap spacing="0.6rem">
      <Tabs
        value={tab}
        onChange={(_event, next: 'edit' | 'preview') => setTab(next)}
        aria-label={t.lessons.htmlTabsAria}
      >
        <Tab value="edit" label={t.lessons.htmlEditTab} />
        <Tab value="preview" label={t.lessons.htmlPreviewTab} />
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
          <FormControl fullWidth size="small">
            <FormLabel htmlFor={`block-${index}-html`}>{t.lessons.htmlLabel}</FormLabel>
            <OutlinedInput
              id={`block-${index}-html`}
              size="small"
              value={value}
              multiline
              minRows={4}
              inputRef={inputRef}
              onChange={(event) => onChange(event.target.value)}
            />
          </FormControl>
        </>
      ) : value.trim().length === 0 ? (
        <Typography variant="caption" data-testid="html-preview-empty">
          {t.lessons.htmlPreviewEmpty}
        </Typography>
      ) : (
        <LessonHtmlContent
          data-testid="html-preview"
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(value) }}
        />
      )}
    </Stack>
  );
};

const BlockFields = ({
  draft,
  index,
  onChange,
}: {
  draft: BlockDraft;
  index: number;
  onChange: (next: BlockDraft) => void;
}) => {
  const field = (label: string, key: string, value: string, update: (value: string) => void, multiline = false) => (
    <FormControl fullWidth size="small">
      <FormLabel htmlFor={`block-${index}-${key}`}>{label}</FormLabel>
      <OutlinedInput
        id={`block-${index}-${key}`}
        size="small"
        value={value}
        multiline={multiline}
        minRows={multiline ? 3 : undefined}
        onChange={(event) => update(event.target.value)}
      />
    </FormControl>
  );

  switch (draft.type) {
    case 'video':
      return (
        <Stack useFlexGap spacing="0.6rem">
          {field('storageKey', 'storageKey', draft.storageKey, (storageKey) => onChange({ ...draft, storageKey }))}
          {field('streamVideoId', 'streamVideoId', draft.streamVideoId, (streamVideoId) =>
            onChange({ ...draft, streamVideoId }),
          )}
          {field('streamLibraryId', 'streamLibraryId', draft.streamLibraryId, (streamLibraryId) =>
            onChange({ ...draft, streamLibraryId }),
          )}
          {field('streamCollectionId', 'streamCollectionId', draft.streamCollectionId, (streamCollectionId) =>
            onChange({ ...draft, streamCollectionId }),
          )}
        </Stack>
      );
    case 'embed':
      return field('embedUrl', 'embedUrl', draft.embedUrl, (embedUrl) => onChange({ ...draft, embedUrl }));
    case 'pdf':
      return (
        <Stack useFlexGap spacing="0.6rem">
          {field('pdfUrl', 'pdfUrl', draft.pdfUrl, (pdfUrl) => onChange({ ...draft, pdfUrl }))}
          {field('name', 'name', draft.name, (name) => onChange({ ...draft, name }))}
        </Stack>
      );
    case 'link':
      return (
        <Stack useFlexGap spacing="0.6rem">
          {field('url', 'url', draft.url, (url) => onChange({ ...draft, url }))}
          {field('description', 'description', draft.description, (description) => onChange({ ...draft, description }))}
        </Stack>
      );
    case 'html':
      return (
        <HtmlBlockEditor
          index={index}
          value={draft.html}
          onChange={(html) => onChange({ ...draft, html })}
        />
      );
  }
};

const LessonForm = ({ lesson, onDone }: { lesson: CourseLesson | null; onDone: () => void }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [name, setName] = useState(lesson?.name ?? '');
  const [blocks, setBlocks] = useState<BlockDraft[]>(lesson ? lesson.contents.map(toDraft) : []);
  const [addType, setAddType] = useState<BlockType>('video');
  const [validationError, setValidationError] = useState<string | null>(null);

  const invalidate = async () => {
    await queryClient.invalidateQueries(actions.lessonsInvalidates());
  };

  const createLesson = useMutation({ ...actions.createLesson, onSuccess: async () => { await invalidate(); onDone(); } });
  const updateLesson = useMutation({ ...actions.updateLesson, onSuccess: async () => { await invalidate(); onDone(); } });

  const pending = createLesson.isPending || updateLesson.isPending;
  const mutationError = createLesson.error ?? updateLesson.error;

  const changeBlock = (index: number, next: BlockDraft) =>
    setBlocks(blocks.map((block, position) => (position === index ? next : block)));

  const removeBlock = (index: number) => setBlocks(blocks.filter((_, position) => position !== index));

  const moveBlock = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    setBlocks(next);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setValidationError(null);
    const parsed = parseBlocks(blocks, t);
    if (!parsed.ok) {
      setValidationError(parsed.message);
      return;
    }
    if (lesson) updateLesson.mutate({ id: lesson.id, name: name.trim(), contents: parsed.blocks });
    else createLesson.mutate({ name: name.trim(), contents: parsed.blocks });
  };

  return (
    <Paper elevation={1} component="form" onSubmit={submit} sx={{ p: '1.25rem', display: 'grid', gap: '1rem' }}>
      <Typography variant="h2" component="h3">
        {lesson ? t.lessons.editLesson : t.lessons.newLesson}
      </Typography>
      <FormControl fullWidth>
        <FormLabel htmlFor="lesson-name">{t.common.name}</FormLabel>
        <OutlinedInput id="lesson-name" value={name} onChange={(event) => setName(event.target.value)} required />
      </FormControl>

      <Divider />
      <Eyebrow variant="overline" component="h4">
        {t.lessons.contentBlocks}
      </Eyebrow>
      {blocks.length === 0 ? (
        <Typography variant="caption">{t.lessons.noBlocks}</Typography>
      ) : (
        <Stack useFlexGap spacing="0.9rem">
          {blocks.map((block, index) => (
            <Paper key={index} variant="outlined" sx={{ p: '0.9rem', display: 'grid', gap: '0.6rem' }} data-testid="lesson-block">
              <Stack direction="row" useFlexGap spacing="0.5rem" sx={{ alignItems: 'center' }}>
                <Eyebrow variant="overline" component="span" data-testid="block-type">
                  {block.type}
                </Eyebrow>
                <Box sx={{ flex: 1 }} />
                <Button
                  size="small"
                  variant="text"
                  disabled={index === 0}
                  aria-label={t.lessons.moveUp({ index })}
                  onClick={() => moveBlock(index, -1)}
                >
                  ↑
                </Button>
                <Button
                  size="small"
                  variant="text"
                  disabled={index === blocks.length - 1}
                  aria-label={t.lessons.moveDown({ index })}
                  onClick={() => moveBlock(index, 1)}
                >
                  ↓
                </Button>
                <Button
                  size="small"
                  variant="text"
                  color="error"
                  aria-label={t.lessons.removeBlock({ index })}
                  onClick={() => removeBlock(index)}
                >
                  {t.common.remove}
                </Button>
              </Stack>
              <BlockFields draft={block} index={index} onChange={(next) => changeBlock(index, next)} />
            </Paper>
          ))}
        </Stack>
      )}

      <Stack direction="row" useFlexGap spacing="0.5rem" sx={{ alignItems: 'flex-end' }}>
        <FormControl size="small" sx={{ minWidth: '10rem' }}>
          <FormLabel htmlFor="add-block-type">{t.lessons.blockTypeLabel}</FormLabel>
          <Select
            id="add-block-type"
            value={addType}
            onChange={(event) =>
              setAddType(BLOCK_TYPE_ORDER.find((value) => value === event.target.value) ?? 'video')
            }
            inputProps={{ 'aria-label': t.lessons.blockTypeLabel }}
          >
            {BLOCK_TYPE_ORDER.map((value) => (
              <MenuItem key={value} value={value}>
                {blockTypeLabel(t, value)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button variant="outlined" onClick={() => setBlocks([...blocks, emptyBlock(addType)])}>
          {t.lessons.addBlock}
        </Button>
      </Stack>

      <Stack direction="row" useFlexGap spacing="0.75rem">
        <Button type="submit" variant="contained" disabled={pending || name.trim().length === 0}>
          {pending ? t.lessons.saving : lesson ? t.lessons.saveLesson : t.lessons.createLesson}
        </Button>
        {lesson ? (
          <Button variant="text" onClick={onDone} disabled={pending}>
            {t.common.cancel}
          </Button>
        ) : null}
      </Stack>

      {validationError ? <Typography variant="caption" role="alert">{validationError}</Typography> : null}
      {mutationError ? <MutationError error={mutationError} /> : null}
    </Paper>
  );
};

const LessonDeleteDialog = ({ lesson, onClose }: { lesson: CourseLesson; onClose: () => void }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const references = useQuery(actions.lessonReferences(lesson.id));
  const deleteLesson = useMutation({
    ...actions.deleteLesson,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.lessonsInvalidates());
      onClose();
    },
  });

  const summary = () => {
    if (references.isPending) return <Typography variant="body2">{t.lessons.deleteReferencesLoading}</Typography>;
    if (references.isError) return <MutationError error={references.error} />;
    const { chapters, products, progressCount } = references.data.references;
    if (chapters.length === 0 && products.length === 0 && progressCount === 0) {
      return <Typography variant="body2">{t.lessons.deleteReferencesNone}</Typography>;
    }
    return (
      <Stack useFlexGap spacing="0.35rem">
        {chapters.length > 0 ? (
          <Typography variant="body2">{t.lessons.deleteReferencesChapters({ count: chapters.length })}</Typography>
        ) : null}
        {products.length > 0 ? (
          <Typography variant="body2">{t.lessons.deleteReferencesProducts({ count: products.length })}</Typography>
        ) : null}
        {progressCount > 0 ? (
          <Typography variant="body2">{t.lessons.deleteReferencesProgress({ count: progressCount })}</Typography>
        ) : null}
      </Stack>
    );
  };

  return (
    <Dialog open onClose={onClose} aria-labelledby="lesson-delete-title">
      <DialogTitle id="lesson-delete-title">{t.lessons.deleteConfirmTitle}</DialogTitle>
      <DialogContent>
        <Stack useFlexGap spacing="0.75rem" sx={{ pt: '0.25rem' }}>
          <Typography variant="body1">{t.lessons.deleteConfirmIntro({ name: lesson.name })}</Typography>
          {summary()}
          {deleteLesson.isError ? <MutationError error={deleteLesson.error} /> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={onClose} disabled={deleteLesson.isPending}>
          {t.common.cancel}
        </Button>
        <Button
          variant="contained"
          color="error"
          onClick={() => deleteLesson.mutate(lesson.id)}
          disabled={deleteLesson.isPending || references.isPending}
        >
          {deleteLesson.isPending ? t.lessons.deleting : t.lessons.deleteConfirm}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export const LessonsSection = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const lessons = useQuery(actions.lessons);
  const [editing, setEditing] = useState<CourseLesson | null>(null);
  const [deleting, setDeleting] = useState<CourseLesson | null>(null);

  return (
    <Stack useFlexGap spacing="1.5rem">
      <LessonForm key={editing?.id ?? 'new'} lesson={editing} onDone={() => setEditing(null)} />

      <Box component="section">
        <Typography variant="h2" component="h3" sx={{ mb: '1rem' }}>
          {t.lessons.heading}
        </Typography>
        {lessons.isPending ? (
          <Typography variant="body1">{t.lessons.loading}</Typography>
        ) : lessons.isError ? (
          <Typography variant="body1" role="alert">
            {errorMessage(lessons.error, t)}
          </Typography>
        ) : lessons.data.lessons.length === 0 ? (
          <Typography variant="body1">{t.lessons.empty}</Typography>
        ) : (
          <List disablePadding>
            {lessons.data.lessons.map((lesson) => (
              <ListItem
                key={lesson.id}
                data-testid="lesson-row"
                secondaryAction={
                  <Stack direction="row" useFlexGap spacing="0.25rem">
                    <Button variant="text" onClick={() => setEditing(lesson)}>
                      {t.lessons.edit}
                    </Button>
                    <Button
                      variant="text"
                      color="error"
                      aria-label={t.lessons.deleteAria({ name: lesson.name })}
                      onClick={() => setDeleting(lesson)}
                    >
                      {t.lessons.delete}
                    </Button>
                  </Stack>
                }
              >
                <ListItemText
                  primary={lesson.name}
                  secondary={
                    <>
                      {lesson.contents.length} {t.lessons.blockNoun({ count: lesson.contents.length })} ·{' '}
                      {formatDate(lesson.createdAt, language)}
                    </>
                  }
                />
              </ListItem>
            ))}
          </List>
        )}
      </Box>

      {deleting ? <LessonDeleteDialog lesson={deleting} onClose={() => setDeleting(null)} /> : null}
    </Stack>
  );
};
