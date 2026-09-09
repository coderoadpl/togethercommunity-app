import { useEffect, useId, useMemo, useState, type ReactElement } from 'react';
import {
  Box,
  Collapse,
  Chip,
  List,
  ListItemButton,
  OutlinedInput,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import type {
  AccessStatus,
  CompletionStatus,
  CourseStructureChapter,
  CourseStructureLesson,
  CourseStructureModule,
  CourseStructureWithAccess,
} from '#core/domain/index.js';

import { actions } from '../../api.js';
import { CompletionMark } from '../../components/ui/CompletionMark.js';
import { useTranslations } from '../../i18n/index.js';
import {
  CourseTreeChapterTitle,
  CourseTreeModuleButton,
  CourseTreeModuleTitle,
  LessonDurationText,
  TreeLessonTitle,
  TreeProgressCount,
  VisuallyHidden,
} from '../../theme.js';
import { branchOfLesson } from './course-tree-state.js';
import { Highlighted } from './highlight.js';
import { Caret, CompletionPartial, LockClosed, LockOpen } from './tree-icons.js';

const TITLE_TOOLTIP_DELAY_MS = 500;

const SCROLL_PADDING_REM = 0.5;
const STICKY_MODULE_HEADER_HEIGHT_PX = 46;
const LESSON_SCROLL_MARGIN_TOP = `calc(${STICKY_MODULE_HEADER_HEIGHT_PX}px + ${SCROLL_PADDING_REM}rem)`;

const ROW_SX = { width: '100%', pr: '0.75rem' } as const;
const MODULE_ROW_SX = {
  ...ROW_SX,
  pl: '0.75rem',
  py: '0.5rem',
  minHeight: STICKY_MODULE_HEADER_HEIGHT_PX,
  columnGap: '0.4rem',
} as const;
const CHAPTER_ROW_SX = { ...ROW_SX, pl: '1.4rem', py: '0.45rem', minHeight: 44, columnGap: '0.4rem' } as const;
const LESSON_ROW_SX = {
  ...ROW_SX,
  pl: '2rem',
  py: '0.4rem',
  minHeight: 44,
  scrollMarginTop: LESSON_SCROLL_MARGIN_TOP,
} as const;

const RowTooltip = ({ title, children }: { title: string; children: ReactElement }) => (
  <Tooltip describeChild title={title} enterDelay={TITLE_TOOLTIP_DELAY_MS} enterNextDelay={TITLE_TOOLTIP_DELAY_MS}>
    {children}
  </Tooltip>
);

const AccessMark = ({ status }: { status: AccessStatus }) => {
  const t = useTranslations();
  if (status === 'not-accessible') {
    return (
      <>
        <LockClosed />
        <VisuallyHidden>{t.courseTree.accessLocked}</VisuallyHidden>
      </>
    );
  }
  if (status === 'partially-accessible') {
    return (
      <>
        <LockOpen />
        <VisuallyHidden>{t.courseTree.accessPartiallyUnlocked}</VisuallyHidden>
      </>
    );
  }
  return null;
};

const LessonCompletion = ({ status }: { status: CompletionStatus }) => {
  const t = useTranslations();
  if (status === 'fully-completed') {
    return <CompletionMark label={t.courseTree.completionComplete} />;
  }
  if (status === 'partially-completed') {
    return (
      <>
        <CompletionPartial />
        <VisuallyHidden>{t.courseTree.completionPartial}</VisuallyHidden>
      </>
    );
  }
  return null;
};

const ProgressMark = ({ lessons, guest }: { lessons: CourseStructureLesson[]; guest: boolean }) => {
  const t = useTranslations();
  if (guest) return <TreeProgressCount variant="caption" component="span">{`${lessons.length} ${t.courseOverview.statLessons({ count: lessons.length })}`}</TreeProgressCount>;
  const done = lessons.filter((lesson) => lesson.completionStatus === 'fully-completed').length;
  const total = lessons.length;
  if (done === total && total > 0) {
    return <CompletionMark label={t.courseTree.completionComplete} />;
  }
  return (
    <TreeProgressCount variant="caption" component="span">
      {`${done}/${total}`}
    </TreeProgressCount>
  );
};

const matchesLesson = (lesson: CourseStructureLesson, needle: string) =>
  needle === '' || lesson.name.toLowerCase().includes(needle);

type VisibleChapter = CourseStructureChapter & { allLessons: CourseStructureLesson[] };
type VisibleModule = Omit<CourseStructureModule, 'chapters'> & {
  chapters: VisibleChapter[];
  allLessons: CourseStructureLesson[];
};

const filterModules = (
  modules: CourseStructureModule[],
  needle: string,
): VisibleModule[] =>
  modules
    .map((module) => ({
      ...module,
      allLessons: module.chapters.flatMap((chapter) => chapter.lessons),
      chapters: module.chapters
        .map((chapter) => ({
          ...chapter,
          allLessons: chapter.lessons,
          lessons: chapter.lessons.filter((lesson) => matchesLesson(lesson, needle)),
        }))
        .filter((chapter) => chapter.lessons.length > 0),
    }))
    .filter((module) => module.chapters.length > 0);

const nearestTreeScroller = (node: HTMLElement): HTMLElement | null =>
  node.closest('[data-course-tree-scroll]');

const nearestModuleHeader = (node: HTMLElement): HTMLElement | null => {
  const module = node.closest('[data-course-tree-module]');
  const header = module?.querySelector('[data-course-tree-module-header]');
  return header instanceof HTMLElement ? header : null;
};

const scrollPaddingPx = (): number => {
  const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(rootFontSize) ? rootFontSize * SCROLL_PADDING_REM : 8;
};

const isComfortablyVisible = (node: HTMLElement, scroller: HTMLElement): boolean => {
  if (scroller.clientHeight <= 0) return false;
  const padding = scrollPaddingPx();
  const nodeRect = node.getBoundingClientRect();
  const headerRect = nearestModuleHeader(node)?.getBoundingClientRect();
  const scrollerRect = scroller.getBoundingClientRect();
  const visibleTop = Math.max(scrollerRect.top + padding, headerRect?.bottom ?? scrollerRect.top + padding);
  return (
    nodeRect.top >= visibleTop &&
    nodeRect.bottom <= scrollerRect.bottom - padding
  );
};

const useScrollIntoViewWhen = (active: boolean) => {
  const [node, setNode] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!active || node === null) return;
    const scroller = nearestTreeScroller(node);
    if (scroller !== null && isComfortablyVisible(node, scroller)) return;
    node.scrollIntoView({ block: 'center' });
  }, [active, node]);
  return setNode;
};

const LessonRow = ({
  lesson,
  courseId,
  search,
  currentLessonId,
  scrollIntoView,
  guest,
}: {
  lesson: CourseStructureLesson;
  courseId: string;
  search: string;
  currentLessonId?: string | undefined;
  scrollIntoView: boolean;
  guest: boolean;
}) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const rowRef = useScrollIntoViewWhen(scrollIntoView);
  const prefetch = () => {
    if (guest) return;
    void queryClient.prefetchQuery(actions.studentLesson(lesson.lessonId));
  };
  const label = (
    <TreeLessonTitle component="span" noWrap sx={{ display: 'block', minWidth: 0, flex: 1 }}>
      <Highlighted text={lesson.name} query={search} />
    </TreeLessonTitle>
  );
  const marks = (
    <Stack
      direction="row"
      useFlexGap
      sx={{ alignItems: 'center', columnGap: '0.35rem', ml: '0.5rem', flexShrink: 0 }}
    >
      {lesson.durationMinutes !== undefined && (
        <LessonDurationText data-testid={`lesson-duration-${lesson.lessonId}`}>
          {t.courseTree.lessonDuration({ minutes: lesson.durationMinutes })}
        </LessonDurationText>
      )}
      {guest && lesson.isPreview ? <Chip size="small" label={t.anon.previewChip} color="primary" variant="outlined" /> : null}
      <LessonCompletion status={lesson.completionStatus} />
      <AccessMark status={lesson.accessStatus} />
    </Stack>
  );

  if (lesson.accessStatus === 'not-accessible' || (guest && !lesson.isPreview)) {
    return (
      <RowTooltip title={t.courseTree.lockedLessonTooltip({ name: lesson.name })}>
        <Box component="span" sx={{ display: 'block' }}>
          <ListItemButton
            disabled
            ref={rowRef}
            data-testid={`lesson-button-${lesson.lessonId}`}
            sx={{ ...LESSON_ROW_SX, opacity: 0.6 }}
          >
            {label}
            {marks}
          </ListItemButton>
        </Box>
      </RowTooltip>
    );
  }

  return (
    <RowTooltip title={lesson.name}>
      <ListItemButton
        component={Link}
        ref={rowRef}
        to={`/my/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lesson.lessonId)}`}
        selected={lesson.lessonId === currentLessonId}
        data-testid={`lesson-button-${lesson.lessonId}`}
        onMouseEnter={prefetch}
        onFocus={prefetch}
        sx={LESSON_ROW_SX}
      >
        {label}
        {marks}
      </ListItemButton>
    </RowTooltip>
  );
};

const ChapterNode = ({
  chapter,
  courseId,
  search,
  open,
  onToggle,
  currentLessonId,
  scrollLessonId,
  guest,
}: {
  chapter: VisibleChapter;
  courseId: string;
  search: string;
  open: boolean;
  onToggle: () => void;
  currentLessonId?: string | undefined;
  scrollLessonId: string | null;
  guest: boolean;
}) => {
  const contentId = useId();
  return (
    <Box component="li" sx={{ listStyle: 'none' }}>
      <RowTooltip title={chapter.name}>
        <ListItemButton
          component="button"
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={contentId}
          data-testid={`chapter-toggle-${chapter.id}`}
          sx={CHAPTER_ROW_SX}
        >
          <Caret open={open} />
          <CourseTreeChapterTitle noWrap sx={{ flex: 1, minWidth: 0 }}>
            {chapter.name}
          </CourseTreeChapterTitle>
          <Stack
            direction="row"
            useFlexGap
            sx={{ alignItems: 'center', columnGap: '0.35rem', flexShrink: 0 }}
          >
            <ProgressMark lessons={chapter.allLessons} guest={guest} />
            <AccessMark status={chapter.accessStatus} />
          </Stack>
        </ListItemButton>
      </RowTooltip>
      <Collapse id={contentId} in={open} unmountOnExit>
        <List disablePadding component="ul" sx={{ m: 0, p: 0 }}>
          {chapter.lessons.map((lesson) => (
            <Box component="li" key={lesson.contentId} sx={{ listStyle: 'none' }}>
              <LessonRow
                guest={guest}
                lesson={lesson}
                courseId={courseId}
                search={search}
                currentLessonId={currentLessonId}
                scrollIntoView={lesson.lessonId === scrollLessonId}
              />
            </Box>
          ))}
        </List>
      </Collapse>
    </Box>
  );
};

const ModuleNode = ({
  module,
  courseId,
  search,
  isOpen,
  onToggle,
  currentLessonId,
  scrollLessonId,
  guest,
}: {
  module: VisibleModule;
  courseId: string;
  search: string;
  isOpen: (id: string) => boolean;
  onToggle: (id: string) => void;
  currentLessonId?: string | undefined;
  scrollLessonId: string | null;
  guest: boolean;
}) => {
  const open = isOpen(module.id);
  const contentId = useId();
  return (
    <Box component="li" data-course-tree-module="" sx={{ listStyle: 'none' }}>
      <RowTooltip title={module.name}>
        <CourseTreeModuleButton
          component="button"
          type="button"
          onClick={() => onToggle(module.id)}
          aria-expanded={open}
          aria-controls={contentId}
          data-testid={`module-toggle-${module.id}`}
          data-course-tree-module-header=""
          sx={{
            ...MODULE_ROW_SX,
            position: 'sticky',
            top: `${SCROLL_PADDING_REM}rem`,
            zIndex: 1,
          }}
        >
          <Caret open={open} />
          <CourseTreeModuleTitle noWrap sx={{ flex: 1, minWidth: 0 }}>
            {module.name}
          </CourseTreeModuleTitle>
          <Stack
            direction="row"
            useFlexGap
            sx={{ alignItems: 'center', columnGap: '0.35rem', flexShrink: 0 }}
          >
            <ProgressMark lessons={module.allLessons} guest={guest} />
            <AccessMark status={module.accessStatus} />
          </Stack>
        </CourseTreeModuleButton>
      </RowTooltip>
      <Collapse id={contentId} in={open} unmountOnExit>
        <List disablePadding component="ul" sx={{ m: 0, p: 0 }}>
          {module.chapters.map((chapter) => (
            <ChapterNode
              key={chapter.id}
              guest={guest}
              chapter={chapter}
              courseId={courseId}
              search={search}
              open={isOpen(chapter.id)}
              onToggle={() => onToggle(chapter.id)}
              currentLessonId={currentLessonId}
              scrollLessonId={scrollLessonId}
            />
          ))}
        </List>
      </Collapse>
    </Box>
  );
};

const NO_FLIPS: ReadonlySet<string> = new Set();

export const CourseTree = ({
  courseId,
  structure,
  currentLessonId,
  focusLessonId = null,
  expandAll = false,
  guest = false,
  scrollFocusIntoView = false,
}: {
  courseId: string;
  structure: CourseStructureWithAccess;
  currentLessonId?: string | undefined;
  focusLessonId?: string | null | undefined;
  expandAll?: boolean;
  guest?: boolean;
  scrollFocusIntoView?: boolean;
}) => {
  const t = useTranslations();
  const [rawSearch, setRawSearch] = useState('');
  const [search, setSearch] = useState('');
  const [flips, setFlips] = useState<{ focus: string | null; ids: ReadonlySet<string> }>(() => ({
    focus: focusLessonId,
    ids: NO_FLIPS,
  }));

  useEffect(() => {
    const timer = setTimeout(() => setSearch(rawSearch.trim().toLowerCase()), 300);
    return () => clearTimeout(timer);
  }, [rawSearch]);

  const branch = useMemo(
    () => branchOfLesson(structure, focusLessonId),
    [structure, focusLessonId],
  );

  const searchActive = search !== '';
  const flipped = flips.focus === focusLessonId ? flips.ids : NO_FLIPS;
  const openByDefault = (id: string) => expandAll || branch.has(id)
    || (guest && structure.modules.some((module) => module.chapters.some((chapter) => chapter.id === id)));
  const isOpen = (id: string) => searchActive || flipped.has(id) !== openByDefault(id);
  const toggle = (id: string) =>
    setFlips((prev) => {
      const ids = new Set(prev.focus === focusLessonId ? prev.ids : NO_FLIPS);
      if (ids.has(id)) ids.delete(id);
      else ids.add(id);
      return { focus: focusLessonId, ids };
    });

  const modules = useMemo(() => filterModules(structure.modules, search), [structure.modules, search]);
  const scrollLessonId = scrollFocusIntoView ? focusLessonId : null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }}>
      <OutlinedInput
        fullWidth
        size="small"
        sx={{ mb: '0.75rem', flexShrink: 0 }}
        value={rawSearch}
        onChange={(event) => setRawSearch(event.target.value)}
        placeholder={t.courseTree.filterPlaceholder}
        inputProps={{ 'data-testid': 'lesson-search', 'aria-label': t.courseTree.searchLessons }}
      />
      <Typography
        variant="caption"
        component="p"
        color="text.secondary"
        sx={{ mb: '0.75rem', flexShrink: 0 }}
        data-testid="lesson-search-hint"
      >
        {t.courseTree.filterHint}
      </Typography>

      <Box
        data-testid="course-tree-scroll"
        data-course-tree-scroll=""
        sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}
      >
        {modules.length === 0 ? (
          <Box sx={{ px: '0.75rem', py: '1rem' }} data-testid="tree-no-results">
            <CourseTreeChapterTitle>{t.courseTree.noMatches}</CourseTreeChapterTitle>
            <Typography variant="caption" component="p" color="text.secondary" sx={{ mt: '0.35rem' }}>
              {t.search.stemHint}
            </Typography>
          </Box>
        ) : (
          <List disablePadding component="ul" sx={{ m: 0, p: 0 }} data-testid="course-tree">
            {modules.map((module) => (
              <ModuleNode
                key={module.id}
                guest={guest}
                module={module}
                courseId={courseId}
                search={searchActive ? search : ''}
                isOpen={isOpen}
                onToggle={toggle}
                currentLessonId={currentLessonId}
                scrollLessonId={scrollLessonId}
              />
            ))}
          </List>
        )}
      </Box>
    </Box>
  );
};
