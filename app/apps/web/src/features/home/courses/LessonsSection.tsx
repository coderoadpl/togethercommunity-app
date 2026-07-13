import { useState, type FormEvent } from 'react';
import {
  Box,
  Button,
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
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { lessonBlockSchema, type CourseLesson, type LessonBlock } from '@core/domain/index.js';

import { actions } from '../../../api.js';
import { Eyebrow } from '../../../theme.js';
import { displayDate, errorMessage, MutationError } from './feedback.js';

type BlockType = LessonBlock['type'];

type BlockDraft =
  | { type: 'video'; storageKey: string; streamVideoId: string; streamLibraryId: string; streamCollectionId: string }
  | { type: 'embed'; embedUrl: string }
  | { type: 'pdf'; pdfUrl: string; name: string }
  | { type: 'link'; url: string; description: string }
  | { type: 'html'; html: string };

const blockTypes: { value: BlockType; label: string }[] = [
  { value: 'video', label: 'Video' },
  { value: 'embed', label: 'Embed' },
  { value: 'pdf', label: 'PDF' },
  { value: 'link', label: 'Link' },
  { value: 'html', label: 'HTML' },
];

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

const parseBlocks = (drafts: BlockDraft[]): { ok: true; blocks: LessonBlock[] } | { ok: false; message: string } => {
  const blocks: LessonBlock[] = [];
  for (const draft of drafts) {
    const parsed = lessonBlockSchema.safeParse(toBlock(draft));
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid lesson blocks' };
    blocks.push(parsed.data);
  }
  return { ok: true, blocks };
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
      return field('html', 'html', draft.html, (html) => onChange({ ...draft, html }), true);
  }
};

const LessonForm = ({ lesson, onDone }: { lesson: CourseLesson | null; onDone: () => void }) => {
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
    const parsed = parseBlocks(blocks);
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
        {lesson ? 'Edit lesson' : 'New lesson'}
      </Typography>
      <FormControl fullWidth>
        <FormLabel htmlFor="lesson-name">name</FormLabel>
        <OutlinedInput id="lesson-name" value={name} onChange={(event) => setName(event.target.value)} required />
      </FormControl>

      <Divider />
      <Eyebrow variant="overline" component="h4">
        Content blocks
      </Eyebrow>
      {blocks.length === 0 ? (
        <Typography variant="caption">No blocks yet.</Typography>
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
                  aria-label={`move block ${index} up`}
                  onClick={() => moveBlock(index, -1)}
                >
                  ↑
                </Button>
                <Button
                  size="small"
                  variant="text"
                  disabled={index === blocks.length - 1}
                  aria-label={`move block ${index} down`}
                  onClick={() => moveBlock(index, 1)}
                >
                  ↓
                </Button>
                <Button
                  size="small"
                  variant="text"
                  color="error"
                  aria-label={`remove block ${index}`}
                  onClick={() => removeBlock(index)}
                >
                  remove
                </Button>
              </Stack>
              <BlockFields draft={block} index={index} onChange={(next) => changeBlock(index, next)} />
            </Paper>
          ))}
        </Stack>
      )}

      <Stack direction="row" useFlexGap spacing="0.5rem" sx={{ alignItems: 'flex-end' }}>
        <FormControl size="small" sx={{ minWidth: '10rem' }}>
          <FormLabel htmlFor="add-block-type">block type</FormLabel>
          <Select
            id="add-block-type"
            value={addType}
            onChange={(event) => setAddType(blockTypes.find((item) => item.value === event.target.value)?.value ?? 'video')}
            inputProps={{ 'aria-label': 'block type' }}
          >
            {blockTypes.map((item) => (
              <MenuItem key={item.value} value={item.value}>
                {item.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button variant="outlined" onClick={() => setBlocks([...blocks, emptyBlock(addType)])}>
          add block
        </Button>
      </Stack>

      <Stack direction="row" useFlexGap spacing="0.75rem">
        <Button type="submit" variant="contained" disabled={pending || name.trim().length === 0}>
          {pending ? 'saving…' : lesson ? 'save lesson' : 'create lesson'}
        </Button>
        {lesson ? (
          <Button variant="text" onClick={onDone} disabled={pending}>
            cancel
          </Button>
        ) : null}
      </Stack>

      {validationError ? <Typography variant="caption" role="alert">{validationError}</Typography> : null}
      {mutationError ? <MutationError error={mutationError} /> : null}
    </Paper>
  );
};

export const LessonsSection = () => {
  const lessons = useQuery(actions.lessons);
  const [editing, setEditing] = useState<CourseLesson | null>(null);

  return (
    <Stack useFlexGap spacing="1.5rem">
      <LessonForm key={editing?.id ?? 'new'} lesson={editing} onDone={() => setEditing(null)} />

      <Box component="section">
        <Typography variant="h2" component="h3" sx={{ mb: '1rem' }}>
          Lessons
        </Typography>
        {lessons.isPending ? (
          <Typography variant="body1">loading lessons…</Typography>
        ) : lessons.isError ? (
          <Typography variant="body1" role="alert">
            {errorMessage(lessons.error)}
          </Typography>
        ) : lessons.data.lessons.length === 0 ? (
          <Typography variant="body1">No lessons yet.</Typography>
        ) : (
          <List disablePadding>
            {lessons.data.lessons.map((lesson) => (
              <ListItem
                key={lesson.id}
                data-testid="lesson-row"
                secondaryAction={
                  <Button variant="text" onClick={() => setEditing(lesson)}>
                    edit
                  </Button>
                }
              >
                <ListItemText
                  primary={lesson.name}
                  secondary={
                    <>
                      {lesson.contents.length} block{lesson.contents.length === 1 ? '' : 's'} ·{' '}
                      {displayDate(lesson.createdAt)}
                    </>
                  }
                />
              </ListItem>
            ))}
          </List>
        )}
      </Box>
    </Stack>
  );
};
