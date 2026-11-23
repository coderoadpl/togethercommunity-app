import { Fragment } from 'react';
import { Alert, Stack } from '@mui/material';

import type { AccessItem, ChangeProposalAccessChange, ChangeProposalAccessLabels } from '#core/domain/index.js';

import { useTranslations } from '../../../i18n/index.js';
import { WrapAnywhereText } from '../../../theme.js';
import { FieldDiffEmpty, FieldDiffList, FieldDiffRow } from '../FieldDiff.js';
import { Isolated, Sentence } from './proposal-text.js';

type Labels = ChangeProposalAccessLabels | undefined;

type NamedKind = keyof Pick<ChangeProposalAccessLabels, 'courses' | 'modules' | 'lessons'>;

interface Exclusion {
  courseId: string;
  moduleId: string;
}

const exclusionsOf = (items: readonly AccessItem[]): Exclusion[] =>
  items.flatMap((item) => item.level === 'course' ? (item.excludedModuleIds ?? []).map((moduleId) => ({ courseId: item.courseId, moduleId })) : []);

const usedElsewhere = (labels: Labels, moduleId: string): boolean => labels?.excludedModulesInOtherCourses?.includes(moduleId) === true;

const isGone = (labels: Labels, kind: NamedKind, id: string): boolean =>
  labels !== undefined && (labels[kind].find((entry) => entry.id === id)?.title ?? null) === null;

const distinct = (ids: readonly string[]): string[] => [...new Set(ids)];

// The owner view marks a module once for both lists; when the two lists exclude it under different courses, the mark
// cannot say which item it came from, so neither list claims it.
const sharedExclusions = (items: readonly AccessItem[], otherList: readonly AccessItem[], labels: Labels): string[] => {
  const other = exclusionsOf(otherList);
  return distinct(exclusionsOf(items)
    .filter((exclusion) => usedElsewhere(labels, exclusion.moduleId)
      && !other.some((candidate) => candidate.moduleId === exclusion.moduleId && candidate.courseId !== exclusion.courseId))
    .map((exclusion) => exclusion.moduleId));
};

const namesGoneOrArchived = (items: readonly AccessItem[], labels: Labels): boolean => items.some((item) => {
  if (isGone(labels, 'courses', item.courseId) || labels?.archivedCourses?.includes(item.courseId) === true) return true;
  switch (item.level) {
    case 'course':
      return (item.excludedModuleIds ?? []).some((id) => isGone(labels, 'modules', id));
    case 'modules':
      return item.moduleIds.some((id) => isGone(labels, 'modules', id));
    case 'lessons':
      return item.lessonIds.some((id) => isGone(labels, 'lessons', id));
  }
});

interface AccessFacts {
  refused: boolean;
  sharedNow: string[];
  lifted: string[];
}

export const accessFacts = (change: ChangeProposalAccessChange, labels: Labels): AccessFacts => {
  const refused = namesGoneOrArchived(change.after, labels) || sharedExclusions(change.after, change.before, labels).length > 0;
  const sharedNow = sharedExclusions(change.before, change.after, labels);
  const stillExcluded = new Set(exclusionsOf(change.after).map((exclusion) => exclusion.moduleId));
  return { refused, sharedNow, lifted: sharedNow.filter((id) => !stillExcluded.has(id)) };
};

const AccessName = ({ kind, id, labels, excluded = false }: { kind: NamedKind; id: string; labels: Labels; excluded?: boolean }) => {
  const t = useTranslations().changeProposals;
  if (isGone(labels, kind, id)) {
    return <span data-testid="access-gone"><Isolated sentence={(slot) => t.accessGone({ id: slot })} value={id} /></span>;
  }
  const title = labels?.[kind].find((candidate) => candidate.id === id)?.title ?? id;
  const name = kind === 'courses' && labels?.archivedCourses?.includes(id) === true
    ? t.accessArchived
    : excluded && usedElsewhere(labels, id) ? t.accessUsedElsewhere : t.accessName;
  return <Isolated sentence={(slot) => name({ name: slot })} value={title} />;
};

const AccessNames = ({ kind, ids, labels, excluded = false }: { kind: NamedKind; ids: readonly string[]; labels: Labels; excluded?: boolean }) => (
  <>
    {ids.map((id, index) => (
      <Fragment key={id}>
        {index === 0 ? null : ', '}
        <AccessName kind={kind} id={id} labels={labels} excluded={excluded} />
      </Fragment>
    ))}
  </>
);

const AccessItemText = ({ item, labels }: { item: AccessItem; labels: Labels }) => {
  const t = useTranslations().changeProposals;
  const course = <AccessName kind="courses" id={item.courseId} labels={labels} />;
  switch (item.level) {
    case 'course': {
      const excluded = item.excludedModuleIds ?? [];
      return excluded.length === 0
        ? <Sentence text={(slot) => t.accessWholeCourse({ course: slot })} parts={[course]} />
        : (
          <Sentence
            text={(courseSlot, modules) => t.accessCourseWithout({ course: courseSlot, modules, count: excluded.length })}
            parts={[course, <AccessNames key="modules" kind="modules" ids={excluded} labels={labels} excluded />]}
          />
        );
    }
    case 'modules':
      return (
        <Sentence
          text={(courseSlot, modules) => t.accessModules({ course: courseSlot, modules, count: item.moduleIds.length })}
          parts={[course, <AccessNames key="modules" kind="modules" ids={item.moduleIds} labels={labels} />]}
        />
      );
    case 'lessons':
      return (
        <Sentence
          text={(courseSlot, lessons) => t.accessLessons({ course: courseSlot, lessons, count: item.lessonIds.length })}
          parts={[course, <AccessNames key="lessons" kind="lessons" ids={item.lessonIds} labels={labels} />]}
        />
      );
  }
};

const AccessList = ({ items, labels }: { items: readonly AccessItem[]; labels: Labels }) => {
  const t = useTranslations().changeProposals;
  return items.length === 0
    ? <FieldDiffEmpty>{t.accessNothing}</FieldDiffEmpty>
    : (
      <FieldDiffList
        items={items.map((item, index) => ({
          key: String(index),
          content: <WrapAnywhereText component="span" variant="body2"><AccessItemText item={item} labels={labels} /></WrapAnywhereText>,
        }))}
      />
    );
};

const ModulesSentence = ({ text, ids, labels }: { text: (params: { modules: string; count: number }) => string; ids: readonly string[]; labels: Labels }) => (
  <Sentence text={(modules) => text({ modules, count: ids.length })} parts={[<AccessNames key="modules" kind="modules" ids={ids} labels={labels} />]} />
);

const AccessNotes = ({ change, labels }: { change: ChangeProposalAccessChange; labels: Labels }) => {
  const t = useTranslations().changeProposals;
  const facts = accessFacts(change, labels);
  return (
    <>
      {facts.refused ? <Alert severity="warning" data-testid="proposal-access-refused">{t.accessListRefused}</Alert> : null}
      {facts.sharedNow.length === 0 ? null : (
        <Alert severity="info" data-testid="proposal-access-shared" sx={{ overflowWrap: 'anywhere' }}>
          <ModulesSentence text={t.accessSharedExclusionNow} ids={facts.sharedNow} labels={labels} />
          {facts.refused || facts.lifted.length === 0 ? null : (
            <>
              {' '}
              <ModulesSentence text={t.accessSharedExclusionLifted} ids={facts.lifted} labels={labels} />
            </>
          )}
        </Alert>
      )}
    </>
  );
};

export const AccessChangeRow = ({
  change,
  labels,
  label,
  labelComponent,
  pending,
}: {
  change: ChangeProposalAccessChange;
  labels: Labels;
  label: string;
  labelComponent: 'h3' | 'h4';
  pending: boolean;
}) => {
  const t = useTranslations().changeProposals;
  return (
    <Stack useFlexGap spacing="0.5rem">
      <FieldDiffRow
        label={label}
        labelComponent={labelComponent}
        changed
        data-testid="proposal-access-changes"
        columns={[
          { label: t.columnNow, value: <AccessList items={change.before} labels={labels} /> },
          { label: t.columnAfter, value: <AccessList items={change.after} labels={labels} /> },
        ]}
      />
      {pending ? <AccessNotes change={change} labels={labels} /> : null}
    </Stack>
  );
};

export const AccessApprovalText = ({
  target,
  change,
  labels,
  newProduct,
  group,
}: {
  target: string;
  change: ChangeProposalAccessChange;
  labels: Labels;
  newProduct: boolean;
  group: boolean;
}) => {
  const t = useTranslations().changeProposals;
  const facts = accessFacts(change, labels);
  if (facts.refused) {
    const refused = group ? t.approveGroupProductSetAccessRefused : t.approveProductSetAccessRefused;
    return <Isolated sentence={(slot) => refused({ target: slot })} value={target} />;
  }
  const items = change.after;
  const nothing = newProduct ? t.approveProductSetAccessNothingNewProduct : t.approveProductSetAccessNothing;
  const grants = newProduct ? t.approveProductSetAccessNewProduct : t.approveProductSetAccess;
  return (
    <>
      {items.length === 0 ? <Isolated sentence={(slot) => nothing({ target: slot })} value={target} /> : (
        <Sentence
          text={(name, access) => grants({ target: name, access })}
          parts={[
            <bdi key="target">{target}</bdi>,
            <Fragment key="access">
              {items.map((item, index) => (
                <Fragment key={index}>
                  {index === 0 ? null : '; '}
                  <AccessItemText item={item} labels={labels} />
                </Fragment>
              ))}
            </Fragment>,
          ]}
        />
      )}
      {newProduct || facts.lifted.length === 0 ? null : (
        <>
          {' '}
          <ModulesSentence text={t.accessSharedExclusionLifted} ids={facts.lifted} labels={labels} />
        </>
      )}
    </>
  );
};
