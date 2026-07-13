import { useEffect, useState } from 'react';
import {
  Box,
  Collapse,
  FormControl,
  FormLabel,
  List,
  ListItemButton,
  OutlinedInput,
  Stack,
  Tooltip,
} from '@mui/material';

import type {
  AccessStatus,
  CompletionStatus,
  CourseStructureChapter,
  CourseStructureLesson,
  CourseStructureModule,
  CourseStructureWithAccess,
} from '@core/domain/index.js';

import { useTranslations } from '../../i18n/index.js';
import { TreeChapterTitle, TreeModuleTitle } from '../../theme.js';
import { Highlighted } from './highlight.js';
import { Caret, CompletionFull, CompletionPartial, LockClosed, LockOpen } from './tree-icons.js';

const AccessMark = ({ status }: { status: AccessStatus }) => {
  if (status === 'not-accessible') return <LockClosed />;
  if (status === 'partially-accessible') return <LockOpen />;
  return null;
};

const CompletionMark = ({ status }: { status: CompletionStatus }) => {
  if (status === 'fully-completed') return <CompletionFull />;
  if (status === 'partially-completed') return <CompletionPartial />;
  return null;
};

const matchesLesson = (lesson: CourseStructureLesson, needle: string) =>
  needle === '' || lesson.name.toLowerCase().includes(needle);

type VisibleChapter = CourseStructureChapter & { lessons: CourseStructureLesson[] };
type VisibleModule = CourseStructureModule & { chapters: VisibleChapter[] };

const filterModules = (
  modules: CourseStructureModule[],
  needle: string,
): VisibleModule[] =>
  modules
    .map((module) => ({
      ...module,
      chapters: module.chapters
        .map((chapter) => ({
          ...chapter,
          lessons: chapter.lessons.filter((lesson) => matchesLesson(lesson, needle)),
        }))
        .filter((chapter) => needle === '' || chapter.lessons.length > 0),
    }))
    .filter((module) => needle === '' || module.chapters.length > 0);

const LessonRow = ({
  lesson,
  courseId,
  search,
}: {
  lesson: CourseStructureLesson;
  courseId: string;
  search: string;
}) => {
  const t = useTranslations();
  const label = <Highlighted text={lesson.name} query={search} />;
  const marks = (
    <Stack direction="row" useFlexGap sx={{ alignItems: 'center', columnGap: '0.35rem', ml: '0.5rem' }}>
      <CompletionMark status={lesson.completionStatus} />
      <AccessMark status={lesson.accessStatus} />
    </Stack>
  );

  if (lesson.accessStatus === 'not-accessible') {
    return (
      <Tooltip title={t.courseTree.lockedTooltip}>
        <Box component="span" sx={{ display: 'block' }}>
          <ListItemButton
            disabled
            data-testid={`lesson-button-${lesson.lessonId}`}
            sx={{ pl: '3.4rem', pr: '0.75rem', opacity: 0.6 }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>{label}</Box>
            {marks}
          </ListItemButton>
        </Box>
      </Tooltip>
    );
  }

  return (
    <ListItemButton
      component="a"
      href={`/my/courses/${courseId}/lessons/${lesson.lessonId}`}
      data-testid={`lesson-button-${lesson.lessonId}`}
      sx={{ pl: '3.4rem', pr: '0.75rem' }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>{label}</Box>
      {marks}
    </ListItemButton>
  );
};

const ChapterNode = ({
  chapter,
  courseId,
  search,
  open,
  onToggle,
}: {
  chapter: VisibleChapter;
  courseId: string;
  search: string;
  open: boolean;
  onToggle: () => void;
}) => (
  <Box component="li" sx={{ listStyle: 'none' }}>
    <ListItemButton
      onClick={onToggle}
      data-testid={`chapter-toggle-${chapter.id}`}
      sx={{ pl: '2rem', pr: '0.75rem', columnGap: '0.4rem' }}
    >
      <Caret open={open} />
      <TreeChapterTitle sx={{ flex: 1, minWidth: 0 }}>{chapter.name}</TreeChapterTitle>
      <Stack direction="row" useFlexGap sx={{ alignItems: 'center', columnGap: '0.35rem' }}>
        <CompletionMark status={chapter.completionStatus} />
        <AccessMark status={chapter.accessStatus} />
      </Stack>
    </ListItemButton>
    <Collapse in={open} unmountOnExit>
      <List disablePadding component="ul" sx={{ m: 0, p: 0 }}>
        {chapter.lessons.map((lesson) => (
          <Box component="li" key={lesson.contentId} sx={{ listStyle: 'none' }}>
            <LessonRow lesson={lesson} courseId={courseId} search={search} />
          </Box>
        ))}
      </List>
    </Collapse>
  </Box>
);

const ModuleNode = ({
  module,
  courseId,
  search,
  isOpen,
  onToggle,
}: {
  module: VisibleModule;
  courseId: string;
  search: string;
  isOpen: (id: string) => boolean;
  onToggle: (id: string) => void;
}) => {
  const open = isOpen(module.id);
  return (
    <Box component="li" sx={{ listStyle: 'none' }}>
      <ListItemButton
        onClick={() => onToggle(module.id)}
        data-testid={`module-toggle-${module.id}`}
        sx={{ pl: '0.75rem', pr: '0.75rem', columnGap: '0.4rem' }}
      >
        <Caret open={open} />
        <TreeModuleTitle sx={{ flex: 1, minWidth: 0 }}>{module.name}</TreeModuleTitle>
        <Stack direction="row" useFlexGap sx={{ alignItems: 'center', columnGap: '0.35rem' }}>
          <CompletionMark status={module.completionStatus} />
          <AccessMark status={module.accessStatus} />
        </Stack>
      </ListItemButton>
      <Collapse in={open} unmountOnExit>
        <List disablePadding component="ul" sx={{ m: 0, p: 0 }}>
          {module.chapters.map((chapter) => (
            <ChapterNode
              key={chapter.id}
              chapter={chapter}
              courseId={courseId}
              search={search}
              open={isOpen(chapter.id)}
              onToggle={() => onToggle(chapter.id)}
            />
          ))}
        </List>
      </Collapse>
    </Box>
  );
};

export const CourseTree = ({
  courseId,
  structure,
}: {
  courseId: string;
  structure: CourseStructureWithAccess;
}) => {
  const t = useTranslations();
  const [rawSearch, setRawSearch] = useState('');
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    const timer = setTimeout(() => setSearch(rawSearch.trim().toLowerCase()), 300);
    return () => clearTimeout(timer);
  }, [rawSearch]);

  const searchActive = search !== '';
  const isOpen = (id: string) => searchActive || !collapsed.has(id);
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const modules = filterModules(structure.modules, search);

  return (
    <Box>
      <FormControl fullWidth sx={{ mb: '1rem' }}>
        <FormLabel htmlFor="lesson-search">{t.courseTree.searchLessons}</FormLabel>
        <OutlinedInput
          id="lesson-search"
          size="small"
          value={rawSearch}
          onChange={(event) => setRawSearch(event.target.value)}
          placeholder={t.courseTree.filterPlaceholder}
          inputProps={{ 'data-testid': 'lesson-search', 'aria-label': t.courseTree.searchLessons }}
        />
      </FormControl>

      {modules.length === 0 ? (
        <Box sx={{ px: '0.75rem', py: '1rem' }} data-testid="tree-no-results">
          <TreeChapterTitle>{t.courseTree.noMatches}</TreeChapterTitle>
        </Box>
      ) : (
        <List disablePadding component="ul" sx={{ m: 0, p: 0 }} data-testid="course-tree">
          {modules.map((module) => (
            <ModuleNode
              key={module.id}
              module={module}
              courseId={courseId}
              search={searchActive ? search : ''}
              isOpen={isOpen}
              onToggle={toggle}
            />
          ))}
        </List>
      )}
    </Box>
  );
};
