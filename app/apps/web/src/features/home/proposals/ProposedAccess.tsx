import { Fragment } from 'react';
import { Alert, Stack } from '@mui/material';

import { sameAccessItems, type AccessItem, type ChangeProposalAccessChange, type ChangeProposalAccessLabels } from '#core/domain/index.js';

import { useTranslations } from '../../../i18n/index.js';
import { WrapAnywhereText } from '../../../theme.js';
import { FieldDiffEmpty, FieldDiffList, FieldDiffRow } from '../FieldDiff.js';
import { Isolated, Sentence } from './proposal-text.js';

type Labels = ChangeProposalAccessLabels | undefined;

type NamedKind = keyof Pick<ChangeProposalAccessLabels, 'courses' | 'modules' | 'lessons'>;

const isGone = (labels: Labels, kind: NamedKind, id: string): boolean =>
  labels !== undefined && (labels[kind].find((entry) => entry.id === id)?.title ?? null) === null;

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

const titleShared = (labels: Labels, kind: NamedKind, id: string, title: string): boolean =>
  labels !== undefined && labels[kind].some((entry) => entry.id !== id && entry.title === title);

export const accessFacts = (change: ChangeProposalAccessChange, labels: Labels): { refused: boolean } => ({
  refused: namesGoneOrArchived(change.after, labels),
});

const AccessName = ({ kind, id, labels }: { kind: NamedKind; id: string; labels: Labels }) => {
  const t = useTranslations().changeProposals;
  if (isGone(labels, kind, id)) {
    return <span data-testid="access-gone"><Isolated sentence={(slot) => t.accessGone({ id: slot })} value={id} /></span>;
  }
  const title = labels?.[kind].find((candidate) => candidate.id === id)?.title ?? id;
  const archived = kind === 'courses' && labels?.archivedCourses?.includes(id) === true;
  if (titleShared(labels, kind, id, title)) {
    const named = archived ? t.accessArchivedWithId : t.accessNameWithId;
    return <Sentence text={(name, idSlot) => named({ name, id: idSlot })} parts={[<bdi key="name">{title}</bdi>, <bdi key="id">{id}</bdi>]} />;
  }
  const name = archived ? t.accessArchived : t.accessName;
  return <Isolated sentence={(slot) => name({ name: slot })} value={title} />;
};

const AccessNames = ({ kind, ids, labels }: { kind: NamedKind; ids: readonly string[]; labels: Labels }) => (
  <>
    {ids.map((id, index) => (
      <Fragment key={id}>
        {index === 0 ? null : ', '}
        <AccessName kind={kind} id={id} labels={labels} />
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
            parts={[course, <AccessNames key="modules" kind="modules" ids={excluded} labels={labels} />]}
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

const AccessNotes = ({ change, labels }: { change: ChangeProposalAccessChange; labels: Labels }) => {
  const t = useTranslations().changeProposals;
  return accessFacts(change, labels).refused ? <Alert severity="warning" data-testid="proposal-access-refused">{t.accessListRefused}</Alert> : null;
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
  refused,
}: {
  target: string;
  change: ChangeProposalAccessChange;
  labels: Labels;
  newProduct: boolean;
  group: boolean;
  refused: boolean;
}) => {
  const t = useTranslations().changeProposals;
  const items = change.after;
  const unchanged = !newProduct && sameAccessItems(change.before, change.after);
  const nothing = newProduct
    ? t.approveProductSetAccessNothingNewProduct
    : unchanged ? t.approveProductSetAccessUnchangedNothing : t.approveProductSetAccessNothing;
  const grants = newProduct
    ? t.approveProductSetAccessNewProduct
    : unchanged ? t.approveProductSetAccessUnchanged : t.approveProductSetAccess;
  const applied = items.length === 0 ? <Isolated sentence={(slot) => nothing({ target: slot })} value={target} /> : (
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
  );
  if (!refused) return applied;
  const warning = group ? t.approveGroupProductSetAccessRefused : t.approveProductSetAccessRefused;
  return <><Isolated sentence={(slot) => warning({ target: slot })} value={target} />{' '}{applied}</>;
};
