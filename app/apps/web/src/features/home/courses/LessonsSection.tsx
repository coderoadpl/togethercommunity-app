import { useRef, useState, type FormEvent, type ReactElement } from 'react';
import {
  Box,
  Button,
  Chip,
  Divider,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Paper,
  Select,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';

import {
  inspectVideoEmbedUrl,
  lessonBlockSchema,
  type CourseLesson,
  type LessonBlock,
  type VideoEmbedUrlInspection,
} from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { ConfirmDialog, ListSection, PanelPage, SectionCard, StatusView } from '../../../components/layout/index.js';
import { HtmlEditor } from '../../../components/ui/HtmlEditor.js';
import { ListPagination, usePagedList } from '../../../components/ui/ListPagination.js';
import { matchesQuery, SearchField, useDebouncedValue } from '../../../components/ui/SearchField.js';
import { useLanguage, useTranslations, type Messages } from '../../../i18n/index.js';
import { formatDate } from '../../../lib/format.js';
import { useUnsavedChanges } from '../use-unsaved-changes.js';
import {
  Eyebrow,
  LessonMediaClip,
  LessonMediaFrame,
  LessonMediaIframe,
} from '../../../theme.js';
import { BunnyVideoPickerDialog } from './BunnyVideoPickerDialog.js';
import { errorMessage, MutationError } from './feedback.js';

type BlockType = LessonBlock['type'];

type BlockDraft =
  | { type: 'video'; storageKey: string; streamVideoId: string; streamLibraryId: string; streamCollectionId: string }
  | { type: 'embed'; embedUrl: string }
  | { type: 'pdf'; pdfUrl: string; name: string }
  | { type: 'link'; url: string; description: string }
  | { type: 'html'; html: string };

const BLOCK_TYPE_ORDER: BlockType[] = ['video', 'embed', 'pdf', 'link', 'html'];

const TYPE_FILTERS: (BlockType | 'all')[] = ['all', ...BLOCK_TYPE_ORDER];

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

const embedUrlErrorMessage = (inspection: VideoEmbedUrlInspection, t: Messages): string | null => {
  switch (inspection.kind) {
    case 'invalid-url':
      return t.lessons.embedInvalidUrl;
    case 'invalid-provider':
      return inspection.provider === 'youtube'
        ? t.lessons.embedInvalidYoutubeUrl
        : t.lessons.embedInvalidVimeoUrl;
    case 'supported':
    case 'unsupported':
      return null;
  }
};

const parseBlocks = (
  drafts: BlockDraft[],
  t: Messages,
): { ok: true; blocks: LessonBlock[] } | { ok: false; message: string } => {
  const blocks: LessonBlock[] = [];
  for (const draft of drafts) {
    if (draft.type === 'embed') {
      const inspection = inspectVideoEmbedUrl(draft.embedUrl);
      const message = embedUrlErrorMessage(inspection, t);
      if (message !== null) return { ok: false, message };
    }
    const parsed = lessonBlockSchema.safeParse(toBlock(draft));
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? t.lessons.invalidBlocks };
    blocks.push(parsed.data);
  }
  return { ok: true, blocks };
};

const VideoBlockFields = ({
  draft,
  index,
  onChange,
  field,
  showPrivacyNote,
}: {
  draft: Extract<BlockDraft, { type: 'video' }>;
  index: number;
  onChange: (next: BlockDraft) => void;
  field: (label: string, key: string, value: string, update: (value: string) => void) => ReactElement;
  showPrivacyNote: boolean;
}) => {
  const t = useTranslations();
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <Stack useFlexGap spacing="0.6rem">
      {showPrivacyNote ? (
        <Typography variant="caption" color="text.secondary" role="note">
          {t.integrations.bunnySecurityHint}
        </Typography>
      ) : null}
      <Box>
        <Button
          size="small"
          variant="outlined"
          data-testid={`block-${index}-bunny-picker`}
          onClick={() => setPickerOpen(true)}
        >
          {t.lessons.videoPickFromBunny}
        </Button>
      </Box>
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
      {pickerOpen ? (
        <BunnyVideoPickerDialog
          onClose={() => setPickerOpen(false)}
          onSelect={(video, libraryId) =>
            onChange({
              ...draft,
              streamVideoId: video.id,
              streamLibraryId: libraryId,
              storageKey: draft.storageKey.trim().length > 0 ? draft.storageKey : video.id,
            })
          }
        />
      ) : null}
    </Stack>
  );
};

const EmbedBlockFields = ({
  draft,
  index,
  onChange,
}: {
  draft: Extract<BlockDraft, { type: 'embed' }>;
  index: number;
  onChange: (next: BlockDraft) => void;
}) => {
  const t = useTranslations();
  const inspection = inspectVideoEmbedUrl(draft.embedUrl);
  const error = draft.embedUrl.length === 0 ? null : embedUrlErrorMessage(inspection, t);
  return (
    <Stack useFlexGap spacing="0.6rem">
      <FormControl fullWidth size="small" error={error !== null}>
        <FormLabel htmlFor={`block-${index}-embedUrl`}>{t.lessons.embedUrlLabel}</FormLabel>
        <OutlinedInput
          id={`block-${index}-embedUrl`}
          size="small"
          value={draft.embedUrl}
          onChange={(event) => onChange({ ...draft, embedUrl: event.target.value })}
        />
        {error === null ? null : <FormHelperText>{error}</FormHelperText>}
      </FormControl>
      {inspection.kind === 'supported' ? (
        <LessonMediaFrame sx={{ aspectRatio: '16 / 9' }}>
          <LessonMediaClip>
            <LessonMediaIframe
              src={inspection.embedUrl}
              title={t.lessons.embedPreviewTitle}
              allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              data-testid="embed-preview"
            />
          </LessonMediaClip>
        </LessonMediaFrame>
      ) : null}
      {inspection.kind === 'supported' ? (
        <Typography variant="caption" color="text.secondary" role="note">
          {inspection.provider === 'youtube' ? t.lessons.youtubePrivacyNote : t.lessons.vimeoPrivacyNote}
        </Typography>
      ) : null}
    </Stack>
  );
};

const BlockFields = ({
  draft,
  index,
  onChange,
  showBunnyPrivacyNote,
}: {
  draft: BlockDraft;
  index: number;
  onChange: (next: BlockDraft) => void;
  showBunnyPrivacyNote: boolean;
}) => {
  const t = useTranslations();
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
        <VideoBlockFields
          draft={draft}
          index={index}
          onChange={onChange}
          field={field}
          showPrivacyNote={showBunnyPrivacyNote}
        />
      );
    case 'embed':
      return <EmbedBlockFields draft={draft} index={index} onChange={onChange} />;
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
        <HtmlEditor
          id={`block-${index}-html`}
          value={draft.html}
          onChange={(html) => onChange({ ...draft, html })}
          fieldLabel={t.lessons.htmlLabel}
          size="small"
        />
      );
  }
};

const LessonAttachmentsEditor = ({ lessonId }: { lessonId: string }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const attachments = useQuery(actions.lessonAttachments(lessonId));
  const refresh = async () => {
    await queryClient.invalidateQueries(actions.lessonAttachmentsInvalidates(lessonId));
  };
  const upload = useMutation({
    ...actions.uploadLessonAttachment,
    onSuccess: refresh,
  });
  const remove = useMutation({
    ...actions.deleteLessonAttachment,
    onSettled: refresh,
  });
  const selectFile = (file: File | undefined) => {
    if (file === undefined) return;
    upload.mutate({
      lessonId,
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      body: file,
    });
  };

  return (
    <Stack useFlexGap spacing="0.75rem" data-testid="lesson-attachments-editor">
      <Box>
        <Eyebrow variant="overline" component="h4">
          {t.lessons.attachmentsHeading}
        </Eyebrow>
        <Typography variant="body2" color="text.secondary">
          {t.lessons.attachmentsHelp}
        </Typography>
      </Box>
      {attachments.isPending ? (
        <Typography variant="caption">{t.common.loading}</Typography>
      ) : attachments.isError ? (
        <StatusView surface={false} state={{ kind: 'error', message: errorMessage(attachments.error, t), retry: { label: t.common.retry, onRetry: () => void attachments.refetch() } }} />
      ) : attachments.data.attachments.length === 0 ? (
        <Typography variant="caption" data-testid="lesson-attachments-empty">
          {t.lessons.attachmentsEmpty}
        </Typography>
      ) : (
        <List disablePadding>
          {attachments.data.attachments.map((attachment) => (
            <ListItem key={attachment.id} disableGutters>
              <ListItemText
                primary={attachment.fileName}
                secondary={`${t.lessons.attachmentSize({ kilobytes: Math.max(1, Math.ceil(attachment.sizeBytes / 1024)) })}${attachment.status === 'pending' ? ` · ${t.lessons.attachmentPending}` : ''}`}
              />
              <Button
                size="small"
                color="error"
                aria-label={t.lessons.deleteAttachment({ name: attachment.fileName })}
                disabled={remove.isPending}
                onClick={() => remove.mutate({ lessonId, attachmentId: attachment.id })}
              >
                {t.common.remove}
              </Button>
            </ListItem>
          ))}
        </List>
      )}
      <Box>
        <Button component="label" variant="outlined" disabled={upload.isPending}>
          {upload.isPending ? t.lessons.uploadingAttachment : t.lessons.uploadAttachment}
          <input
            hidden
            type="file"
            aria-label={t.lessons.attachmentFileInput}
            onChange={(event) => {
              selectFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </Button>
      </Box>
      {upload.isError ? <MutationError error={upload.error} /> : null}
      {remove.isError ? <MutationError error={remove.error} /> : null}
    </Stack>
  );
};

const LessonForm = ({ lesson, onSaved }: { lesson: CourseLesson | null; onSaved: (lessonId: string) => void }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const tenantSecrets = useQuery(actions.tenantSecrets);
  const [name, setName] = useState(lesson?.name ?? '');
  const [duration, setDuration] = useState(
    lesson?.durationMinutes === undefined ? '' : String(lesson.durationMinutes),
  );
  const [isPreview, setIsPreview] = useState(lesson?.isPreview ?? false);
  const [blocks, setBlocks] = useState<BlockDraft[]>(lesson ? lesson.contents.map(toDraft) : []);
  const [addType, setAddType] = useState<BlockType>('video');
  const [validationError, setValidationError] = useState<string | null>(null);
  const errorId = 'lesson-form-error';
  const initialSnapshot = JSON.stringify([
    lesson?.name ?? '',
    lesson?.durationMinutes === undefined ? '' : String(lesson.durationMinutes),
    lesson?.isPreview ?? false,
    lesson ? lesson.contents.map(toDraft) : [],
  ]);
  const currentSnapshot = JSON.stringify([name, duration, isPreview, blocks]);
  const dirty = currentSnapshot !== initialSnapshot;
  const allowNavigation = useUnsavedChanges(dirty, t.common.unsavedChangesConfirm);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const showBunnyPrivacyNote =
    tenantSecrets.isSuccess && !tenantSecrets.data.secrets.some((secret) => secret.key === 'bunny.securityKey');

  const invalidate = async () => {
    await queryClient.invalidateQueries(actions.lessonsInvalidates());
  };

  const createLesson = useMutation({
    ...actions.createLesson,
    onSuccess: async ({ lesson: created }) => {
      allowNavigation();
      await invalidate();
      onSaved(created.id);
    },
  });
  const updateLesson = useMutation({
    ...actions.updateLesson,
    onSuccess: async ({ lesson: updated }) => {
      allowNavigation();
      await invalidate();
      onSaved(updated.id);
    },
  });

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
    const minutes = Number.parseInt(duration, 10);
    const durationMinutes = Number.isInteger(minutes) && minutes > 0 ? minutes : null;
    if (lesson) {
      updateLesson.mutate({ id: lesson.id, name: name.trim(), isPreview, contents: parsed.blocks, durationMinutes });
    } else {
      createLesson.mutate({
        name: name.trim(),
        isPreview,
        contents: parsed.blocks,
        ...(durationMinutes === null ? {} : { durationMinutes }),
      });
    }
  };

  return (
    <SectionCard title={t.lessons.detailsHeading} onSubmit={submit}>
      <FormControl fullWidth>
        <FormLabel htmlFor="lesson-name">{t.common.name}</FormLabel>
        <OutlinedInput
          id="lesson-name"
          value={name}
          inputRef={nameInputRef}
          onChange={(event) => setName(event.target.value)}
          required
          aria-describedby={mutationError ? errorId : undefined}
        />
      </FormControl>
      <FormControl sx={{ maxWidth: '14rem' }}>
        <FormLabel htmlFor="lesson-duration">{t.lessons.durationLabel}</FormLabel>
        <OutlinedInput
          id="lesson-duration"
          size="small"
          type="number"
          value={duration}
          onChange={(event) => setDuration(event.target.value)}
          inputProps={{ min: 1, step: 1, 'data-testid': 'lesson-duration-input' }}
          aria-describedby={mutationError ? errorId : undefined}
        />
        <FormHelperText>{t.lessons.durationHelper}</FormHelperText>
      </FormControl>
      <FormControl>
        <FormControlLabel
          control={<Switch checked={isPreview} onChange={(event) => setIsPreview(event.target.checked)} />}
          label={t.lessons.previewLabel}
        />
        <FormHelperText>{t.lessons.previewHelper}</FormHelperText>
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
                  {blockTypeLabel(t, block.type)}
                </Eyebrow>
                <Box sx={{ flex: 1 }} />
                <Tooltip title={t.lessons.moveUp({ index })}>
                  <span>
                    <Button
                      size="small"
                      variant="text"
                      disabled={index === 0}
                      aria-label={t.lessons.moveUp({ index })}
                      onClick={() => moveBlock(index, -1)}
                    >
                      ↑
                    </Button>
                  </span>
                </Tooltip>
                <Tooltip title={t.lessons.moveDown({ index })}>
                  <span>
                    <Button
                      size="small"
                      variant="text"
                      disabled={index === blocks.length - 1}
                      aria-label={t.lessons.moveDown({ index })}
                      onClick={() => moveBlock(index, 1)}
                    >
                      ↓
                    </Button>
                  </span>
                </Tooltip>
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
              <BlockFields
                draft={block}
                index={index}
                onChange={(next) => changeBlock(index, next)}
                showBunnyPrivacyNote={showBunnyPrivacyNote}
              />
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

      {lesson === null ? null : (
        <>
          <Divider />
          <LessonAttachmentsEditor lessonId={lesson.id} />
        </>
      )}

      <Stack direction="row" useFlexGap spacing="0.75rem">
        <Button type="submit" variant="contained" disabled={pending || name.trim().length === 0}>
          {pending ? t.lessons.saving : lesson ? t.lessons.saveLesson : t.lessons.createLesson}
        </Button>
      </Stack>

      {validationError ? <Typography variant="caption" role="alert">{validationError}</Typography> : null}
      {mutationError ? (
        <MutationError
          error={mutationError}
          id={errorId}
          fields={[
            { name: 'name', id: 'lesson-name', label: t.common.name },
            { name: 'durationMinutes', id: 'lesson-duration', label: t.lessons.durationLabel },
            { name: 'contents', id: 'lesson-name', label: t.lessons.contentBlocks },
          ]}
        />
      ) : null}
      {tenantSecrets.isError ? <StatusView surface={false} state={{ kind: 'error', message: errorMessage(tenantSecrets.error, t), retry: { label: t.common.retry, onRetry: () => void tenantSecrets.refetch() } }} /> : null}
      {dirty ? <Typography variant="caption" color="warning.main">{t.common.unsavedChanges}</Typography> : null}
    </SectionCard>
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
    if (references.isError) return <StatusView surface={false} state={{ kind: 'error', message: errorMessage(references.error, t), retry: { label: t.common.retry, onRetry: () => void references.refetch() } }} />;
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
    <ConfirmDialog
      open
      title={t.lessons.deleteConfirmTitle}
      body={
        <>
          <Typography variant="body1">{t.lessons.deleteConfirmIntro({ name: lesson.name })}</Typography>
          {summary()}
          {deleteLesson.isError ? <MutationError error={deleteLesson.error} /> : null}
        </>
      }
      confirmLabel={deleteLesson.isPending ? t.lessons.deleting : t.lessons.deleteConfirm}
      cancelLabel={t.common.cancel}
      pending={deleteLesson.isPending}
      confirmDisabled={references.isPending}
      onClose={onClose}
      onConfirm={() => deleteLesson.mutate(lesson.id)}
    />
  );
};

export const LessonsSection = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const navigate = useNavigate();
  const lessons = useQuery(actions.lessons);
  const [deleting, setDeleting] = useState<CourseLesson | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<BlockType | 'all'>('all');
  const query = useDebouncedValue(search);

  const visibleLessons = (lessons.data?.lessons ?? [])
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter((lesson) => matchesQuery(query, lesson.name))
    .filter((lesson) => typeFilter === 'all' || lesson.contents.some((block) => block.type === typeFilter));
  const paged = usePagedList(visibleLessons, `${query}|${typeFilter}`);

  return (
    <PanelPage
      title={t.sections.lessons}
      action={<Button component={Link} to="/panel/lessons/new" variant="contained">+ {t.common.add}</Button>}
    >
      <ListSection
        toolbar={{
          search: (
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder={t.lessons.searchPlaceholder}
            testId="lessons-search"
          />
          ),
          filters: (
            <Stack direction="row" useFlexGap spacing="0.4rem" role="group" aria-label={t.lessons.typeFilterAria}>
              {TYPE_FILTERS.map((value) => (
                <Chip
                  key={value}
                  size="small"
                  clickable
                  variant={typeFilter === value ? 'filled' : 'outlined'}
                  color={typeFilter === value ? 'primary' : 'default'}
                  label={value === 'all' ? t.lessons.typeFilterAll : blockTypeLabel(t, value)}
                  aria-pressed={typeFilter === value}
                  data-testid={`lessons-type-filter-${value}`}
                  onClick={() => setTypeFilter(value)}
                />
              ))}
            </Stack>
          ),
        }}
        pagination={lessons.isSuccess && visibleLessons.length > 0 ? <ListPagination paged={paged} testId="lessons-pagination" /> : undefined}
        isEmpty={lessons.isSuccess && lessons.data.lessons.length === 0}
        empty={<StatusView state={{ kind: 'empty', title: t.lessons.empty, action: <Button component={Link} to="/panel/lessons/new">+ {t.common.add}</Button> }} />}
        noMatches={lessons.isSuccess && lessons.data.lessons.length > 0 && visibleLessons.length === 0 ? <Typography variant="body1">{t.lessons.noMatches}</Typography> : undefined}
      >
        {lessons.isPending ? (
          <StatusView state={{ kind: 'loading', label: t.lessons.loading }} />
        ) : lessons.isError ? (
          <StatusView state={{ kind: 'error', message: errorMessage(lessons.error, t), retry: { label: t.common.retry, onRetry: () => void lessons.refetch() } }} />
        ) : (
          <List disablePadding dense>
            {paged.pageItems.map((lesson) => (
              <ListItem
                key={lesson.id}
                data-testid="lesson-row"
                secondaryAction={
                  <Stack direction="row" useFlexGap spacing="0.25rem">
                    <Button
                      variant="text"
                      onClick={() => void navigate({ to: '/panel/lessons/$lessonId', params: { lessonId: lesson.id } })}
                    >
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
      </ListSection>

      {deleting ? <LessonDeleteDialog lesson={deleting} onClose={() => setDeleting(null)} /> : null}
    </PanelPage>
  );
};

export const LessonCreatePage = () => {
  const t = useTranslations();
  const navigate = useNavigate();

  return (
    <PanelPage title={t.lessons.newLesson} backTo={{ label: t.lessons.allLessons, href: '/panel/lessons' }}>
      <LessonForm
        lesson={null}
        onSaved={(lessonId) => void navigate({ to: '/panel/lessons/$lessonId', params: { lessonId } })}
      />
    </PanelPage>
  );
};

export const LessonEditPage = ({ lesson }: { lesson: CourseLesson }) => {
  const t = useTranslations();
  const navigate = useNavigate();

  return (
    <PanelPage title={lesson.name} backTo={{ label: t.lessons.allLessons, href: '/panel/lessons' }}>
      <LessonForm
        key={lesson.id}
        lesson={lesson}
        onSaved={() => void navigate({ to: '/panel/lessons' })}
      />
    </PanelPage>
  );
};
