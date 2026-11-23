import { Fragment } from 'react';

import type { AccessItem, ChangeProposalAccessChange, ChangeProposalAccessLabels } from '#core/domain/index.js';

import { useTranslations } from '../../../i18n/index.js';
import { FieldDiffEmpty, FieldDiffList, FieldDiffRow } from '../FieldDiff.js';
import { Isolated, Sentence } from './proposal-text.js';

type Labels = ChangeProposalAccessLabels | undefined;

type NamedKind = keyof ChangeProposalAccessLabels;

const AccessName = ({ kind, id, labels }: { kind: NamedKind; id: string; labels: Labels }) => {
  const t = useTranslations().changeProposals;
  const entry = labels?.[kind].find((candidate) => candidate.id === id);
  if (labels !== undefined && (entry === undefined || entry.title === null)) {
    return <span data-testid="access-gone"><Isolated sentence={(slot) => t.accessGone({ id: slot })} value={id} /></span>;
  }
  return <Isolated sentence={(slot) => t.accessName({ name: slot })} value={entry?.title ?? id} />;
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
    : <FieldDiffList items={items.map((item, index) => ({ key: String(index), content: <AccessItemText item={item} labels={labels} /> }))} />;
};

export const AccessChangeRow = ({
  change,
  labels,
  label,
  labelComponent,
}: {
  change: ChangeProposalAccessChange;
  labels: Labels;
  label: string;
  labelComponent: 'h3' | 'h4';
}) => {
  const t = useTranslations().changeProposals;
  return (
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
  );
};

export const AccessApprovalText = ({ target, items, labels }: { target: string; items: readonly AccessItem[]; labels: Labels }) => {
  const t = useTranslations().changeProposals;
  if (items.length === 0) return <Isolated sentence={(slot) => t.approveProductSetAccessNothing({ target: slot })} value={target} />;
  return (
    <Sentence
      text={(name, access) => t.approveProductSetAccess({ target: name, access })}
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
};
