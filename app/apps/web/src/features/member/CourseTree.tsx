import { createContext, useContext, useEffect, useId, useMemo, useState, type ComponentProps } from 'react';
import {
  Box,
  Chip,
  OutlinedInput,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useForkRef } from '@mui/material/utils';
import type { TreeItemProps } from '@mui/x-tree-view/TreeItem';
import type { UseTreeItemContentSlotOwnProps } from '@mui/x-tree-view/useTreeItem';
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
  COURSE_TREE_SCROLL_PADDING_REM,
  CourseTreeChapterTitle,
  CourseTreeItem,
  CourseTreeItemContent,
  CourseTreeModuleTitle,
  CourseTreeRoot,
  LessonDurationText,
  TreeLessonTitle,
  TreeProgressCount,
  VisuallyHidden,
} from '../../theme.js';
import { branchOfLesson } from './course-tree-state.js';
import { Highlighted } from './highlight.js';
import { Caret, CompletionPartial, LockClosed, LockOpen } from './tree-icons.js';

const TITLE_TOOLTIP_DELAY_MS = 500;

type RowConfig = {
  title: string;
  testId: string;
  to?: string;
  ref?: (node: HTMLElement | null) => void;
  prefetch?: () => void;
};

const RowContext = createContext<RowConfig>({ title: '', testId: '' });

const RowContent = (props: ComponentProps<typeof CourseTreeItemContent> & Pick<UseTreeItemContentSlotOwnProps, 'data-focused'>) => {
  const row = useContext(RowContext);
  const ref = useForkRef<HTMLDivElement>(props.ref, row.ref);
  const focused = props['data-focused'] !== undefined;
  const [tooltip, setTooltip] = useState({ focused, open: focused });
  if (tooltip.focused !== focused) setTooltip({ focused, open: focused });
  return (
    <Tooltip
      describeChild
      title={row.title}
      open={tooltip.open}
      onOpen={() => setTooltip({ focused, open: true })}
      onClose={() => setTooltip({ focused, open: false })}
      enterDelay={TITLE_TOOLTIP_DELAY_MS}
      enterNextDelay={TITLE_TOOLTIP_DELAY_MS}
    >
      <CourseTreeItemContent
        {...props}
        as={row.to === undefined ? 'div' : Link}
        to={row.to}
        tabIndex={-1}
        ref={ref}
        data-testid={row.testId}
        onMouseEnter={row.prefetch}
      />
    </Tooltip>
  );
};

const ExpandIcon = () => <Caret open={false} />;
const CollapseIcon = () => <Caret open />;
const ITEM_SLOTS = { content: RowContent, expandIcon: ExpandIcon, collapseIcon: CollapseIcon };
const ITEM_SLOT_PROPS = { groupTransition: { unmountOnExit: true } };

const toggleWithKeyboard = (toggle: () => void): NonNullable<TreeItemProps['onKeyDown']> => (event) => {
  if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
  event.defaultMuiPrevented = true;
  event.preventDefault();
  toggle();
};

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
  singleChapter: boolean;
};

const filterModules = (
  modules: CourseStructureModule[],
  needle: string,
): VisibleModule[] =>
  modules
    .map((module) => ({
      ...module,
      singleChapter: module.chapters.length === 1,
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
  return (Number.isFinite(rootFontSize) ? rootFontSize : 16) * COURSE_TREE_SCROLL_PADDING_REM;
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
  scrollIntoView,
  guest,
}: {
  lesson: CourseStructureLesson;
  courseId: string;
  search: string;
  scrollIntoView: boolean;
  guest: boolean;
}) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const labelId = useId();
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
      {' '}
      {guest && lesson.isPreview ? <Chip size="small" label={t.anon.previewChip} color="primary" variant="outlined" /> : null}
      {' '}
      <LessonCompletion status={lesson.completionStatus} />
      {' '}
      <AccessMark status={lesson.accessStatus} />
    </Stack>
  );

  const locked = lesson.accessStatus === 'not-accessible' || (guest && !lesson.isPreview);
  return (
    <RowContext value={{
      title: locked ? t.courseTree.lockedLessonTooltip({ name: lesson.name }) : lesson.name,
      testId: `lesson-button-${lesson.lessonId}`,
      ...(locked ? {} : { to: `/my/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lesson.lessonId)}`, prefetch }),
      ref: rowRef,
    }}>
      <CourseTreeItem
        itemId={`lesson:${lesson.contentId}`}
        kind="lesson"
        disabled={locked}
        aria-labelledby={labelId}
        aria-description={locked ? t.courseTree.lockedLessonTooltip({ name: lesson.name }) : undefined}
        slots={ITEM_SLOTS}
        slotProps={{ label: { id: labelId } }}
        onFocusCapture={locked ? undefined : prefetch}
        onKeyDown={(event) => {
          if (locked || event.key !== 'Enter' || event.target !== event.currentTarget) return;
          event.defaultMuiPrevented = true;
          event.preventDefault();
          event.currentTarget.querySelector('a')?.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            altKey: event.altKey,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            shiftKey: event.shiftKey,
          }));
        }}
        label={<>{label}{' '}{marks}</>}
      />
    </RowContext>
  );
};

type BranchProps = {
  courseId: string;
  search: string;
  onToggle: (id: string) => void;
  scrollLessonId: string | null;
  guest: boolean;
};

const ChapterNode = ({ chapter, ...props }: BranchProps & { chapter: VisibleChapter }) => {
  const labelId = useId();
  return (
    <RowContext value={{ title: chapter.name, testId: `chapter-toggle-${chapter.id}` }}>
      <CourseTreeItem
        itemId={chapter.id}
        kind="chapter"
        disableSelection
        aria-labelledby={labelId}
        slots={ITEM_SLOTS}
        slotProps={{ ...ITEM_SLOT_PROPS, label: { id: labelId } }}
        onKeyDown={toggleWithKeyboard(() => props.onToggle(chapter.id))}
        label={
          <>
            <CourseTreeChapterTitle component="span" noWrap sx={{ flex: 1, minWidth: 0 }}>
              {chapter.name}
            </CourseTreeChapterTitle>
            {' '}
            <ProgressMark lessons={chapter.allLessons} guest={props.guest} />
            {' '}
            <AccessMark status={chapter.accessStatus} />
          </>
        }
      >
        {chapter.lessons.map((lesson) => (
          <LessonRow
            key={lesson.contentId}
            {...props}
            lesson={lesson}
            scrollIntoView={lesson.lessonId === props.scrollLessonId}
          />
        ))}
      </CourseTreeItem>
    </RowContext>
  );
};

const ModuleNode = ({ module, ...props }: BranchProps & { module: VisibleModule }) => {
  const labelId = useId();
  return (
    <RowContext value={{ title: module.name, testId: `module-toggle-${module.id}` }}>
      <CourseTreeItem
        itemId={module.id}
        kind="module"
        disableSelection
        aria-labelledby={labelId}
        data-course-tree-module=""
        slots={ITEM_SLOTS}
        slotProps={{ ...ITEM_SLOT_PROPS, label: { id: labelId }, content: { ...{ 'data-course-tree-module-header': '' } } }}
        onKeyDown={toggleWithKeyboard(() => props.onToggle(module.id))}
        label={
          <>
            <CourseTreeModuleTitle component="span" noWrap sx={{ flex: 1, minWidth: 0 }}>
              {module.name}
            </CourseTreeModuleTitle>
            {' '}
            <ProgressMark lessons={module.allLessons} guest={props.guest} />
            {' '}
            <AccessMark status={module.accessStatus} />
          </>
        }
      >
        {module.singleChapter
          ? module.chapters.flatMap((chapter) => chapter.lessons).map((lesson) => (
            <LessonRow
              key={lesson.contentId}
              {...props}
              lesson={lesson}
              scrollIntoView={lesson.lessonId === props.scrollLessonId}
            />
          ))
          : module.chapters.map((chapter) => <ChapterNode key={chapter.id} {...props} chapter={chapter} />)}
      </CourseTreeItem>
    </RowContext>
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
          <CourseTreeRoot
            disabledItemsFocusable
            aria-label={structure.name}
            data-testid="course-tree"
            expandedItems={modules.flatMap((module) => [module.id, ...(module.singleChapter ? [] : module.chapters.map((chapter) => chapter.id))]).filter(isOpen)}
            onItemExpansionToggle={(_event, id) => toggle(id)}
            multiSelect
            selectedItems={modules.flatMap((module) => module.chapters.flatMap((chapter) => chapter.lessons))
              .filter((lesson) => lesson.lessonId === currentLessonId)
              .map((lesson) => `lesson:${lesson.contentId}`)}
          >
            {modules.map((module) => (
              <ModuleNode
                key={module.id}
                guest={guest}
                module={module}
                courseId={courseId}
                search={searchActive ? search : ''}
                onToggle={toggle}
                scrollLessonId={scrollLessonId}
              />
            ))}
          </CourseTreeRoot>
        )}
      </Box>
    </Box>
  );
};
