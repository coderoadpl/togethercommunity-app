import { useState } from 'react';
import { Button, Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import type { MarketingList } from '#core/domain/index.js';
import { actions } from '../../../api.js';
import { PanelPage, ResponsiveTable, SectionCard, StatusView } from '../../../components/layout/index.js';
import { useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDateTime } from '../../../lib/format.js';
import { usePanelContext } from '../panel-context.js';
import { DirectoryError, DirectoryPagination, DirectorySelect } from './DirectoryFields.js';

const ListRow = ({ list }: { list: MarketingList }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const { tenant } = usePanelContext();
  const [showCounts, setShowCounts] = useState(false);
  const detail = useQuery({ ...actions.directory.list(tenant.id, { listId: list.id }), enabled: showCounts });
  const rule = list.rule;
  const summary = rule === null ? '—' : rule.kind === 'tag' ? `${t.directory.tagRule}: ${rule.tags.join(', ')} · ${rule.match === 'any' ? t.directory.any : t.directory.allTags}` : rule.kind === 'product_grant' ? `${t.directory.productRule}: ${rule.productIds.length} · ${rule.state === 'active' ? t.directory.activeGrant : t.directory.ever}` : t.directory.consentRule;
  return <TableRow><TableCell><Link to="/panel/marketing/lists/$listId" params={{ listId: list.id }}>{list.name}</Link><br />{list.key}</TableCell><TableCell>{t.directory[list.kind]}</TableCell><TableCell>{summary}</TableCell><TableCell>{detail.data?.counts.contactCount ?? <Button disabled={detail.isFetching} onClick={() => setShowCounts(true)}>{t.directory.loadCounts}</Button>}<DirectoryError error={detail.error} /></TableCell><TableCell>{detail.data?.counts.suppressedCount ?? '—'}</TableCell><TableCell>{formatDateTime(list.updatedAt, language)}</TableCell></TableRow>;
};

export const ListsPanel = () => {
  const t = useTranslations();
  const { tenant } = usePanelContext();
  const [cursor, setCursor] = useState<string>();
  const [archived, setArchived] = useState(false);
  const lists = useQuery(actions.directory.lists(tenant.id, { limit: 50, archived, ...(cursor ? { cursor } : {}) }));
  return <PanelPage title={t.directory.listsTitle} description={t.directory.listsDescription} action={<Button variant="contained" component={Link} to="/panel/marketing/lists/new">+ {t.directory.newList}</Button>}><SectionCard title={t.directory.listsTitle}>
    <DirectorySelect label={t.directory.archiveState} value={archived ? 'true' : 'false'} onChange={(value) => { setArchived(value === 'true'); setCursor(undefined); }} options={[{ value: 'false', label: t.directory.active }, { value: 'true', label: t.directory.archived }]} />
    <DirectoryError error={lists.error} />{lists.isPending ? <StatusView state={{ kind: 'loading', label: t.directory.loading }} /> : lists.data?.lists.length === 0 ? <StatusView state={{ kind: 'empty', title: t.directory.listsEmpty }} /> : <ResponsiveTable><Table aria-label={t.directory.listsTitle}><TableHead><TableRow>{[t.directory.name, t.directory.kind, t.directory.rule, t.directory.contactCount, t.directory.suppressedCount, t.directory.updatedAt].map((label) => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead><TableBody>{lists.data?.lists.map((list) => <ListRow key={list.id} list={list} />)}</TableBody></Table></ResponsiveTable>}
    <DirectoryPagination cursor={cursor} nextCursor={lists.data?.nextCursor} onChange={setCursor} />
  </SectionCard></PanelPage>;
};
