import { useId, useState, type ReactNode } from 'react';
import { Alert, Button, FormControl, FormHelperText, FormLabel, MenuItem, OutlinedInput, Select, Stack } from '@mui/material';
import { useInfiniteQuery } from '@tanstack/react-query';

import { actions } from '../../../api.js';
import { localizePanelError, useTranslations, type Messages } from '../../../i18n/index.js';
import { usePanelContext } from '../panel-context.js';

export const DirectoryField = ({ label, value, onChange, required = false, disabled = false, multiline = false, maxLength, helperText }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; disabled?: boolean; multiline?: boolean; maxLength?: number; helperText?: string }) => {
  const id = useId();
  return <FormControl fullWidth><FormLabel htmlFor={id}>{label}</FormLabel><OutlinedInput id={id} value={value} onChange={(event) => onChange(event.target.value)} required={required} disabled={disabled} multiline={multiline} inputProps={{ maxLength }} />{helperText === undefined ? null : <FormHelperText>{helperText}</FormHelperText>}</FormControl>;
};

export const DirectorySelect = <T extends string,>({ label, value, onChange, options, disabled = false, helperText }: { label: string; value: T; onChange: (value: T) => void; options: { value: T; label: string }[]; disabled?: boolean; helperText?: string }) => {
  const id = useId();
  return <FormControl fullWidth><FormLabel id={id}>{label}</FormLabel><Select labelId={id} value={value} disabled={disabled} onChange={(event) => { const option = options.find((entry) => entry.value === event.target.value); if (option) onChange(option.value); }} displayEmpty>{options.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}</Select>{helperText === undefined ? null : <FormHelperText>{helperText}</FormHelperText>}</FormControl>;
};

export const DirectoryError = ({ error }: { error: unknown }) => {
  const t = useTranslations();
  return error ? <Alert severity="error">{localizePanelError(error, t)}</Alert> : null;
};

export const DirectoryListSelect = ({ value, onChange, staticOnly = false, label, helperText }: { value: string; onChange: (value: string) => void; staticOnly?: boolean; label?: string; helperText?: string }) => {
  const t = useTranslations();
  const { tenant } = usePanelContext();
  const lists = useInfiniteQuery(actions.directory.listOptions(tenant.id));
  return <Stack useFlexGap spacing="0.5rem"><DirectorySelect label={label ?? t.directory.list} value={value} onChange={onChange} {...(helperText === undefined ? {} : { helperText })} options={[{ value: '', label: t.directory.all }, ...(lists.data?.pages.flatMap((page) => page.lists).filter((list) => !staticOnly || list.kind === 'static').map((list) => ({ value: list.id, label: `${list.name} (${list.key})` })) ?? [])]} />{lists.hasNextPage ? <Button disabled={lists.isFetchingNextPage} onClick={() => void lists.fetchNextPage()}>{t.directory.loadMore}</Button> : null}<DirectoryError error={lists.error} /></Stack>;
};

export const DirectoryPagination = ({ nextCursor, cursor, onChange }: { nextCursor: string | null | undefined; cursor: string | undefined; onChange: (cursor: string | undefined) => void }) => {
  const t = useTranslations();
  const [history, setHistory] = useState<(string | undefined)[]>([]);
  const [current, setCurrent] = useState(cursor);
  if (current !== cursor) { setCurrent(cursor); setHistory([]); }
  return <Stack direction="row" useFlexGap spacing="0.5rem">{cursor ? <Button onClick={() => { const previous = history.at(-1); setHistory(history.slice(0, -1)); setCurrent(previous); onChange(previous); }}>{t.directory.back}</Button> : null}{nextCursor ? <Button onClick={() => { setHistory([...history, cursor]); setCurrent(nextCursor); onChange(nextCursor); }}>{t.directory.next}</Button> : null}</Stack>;
};

export const DirectoryActions = ({ children }: { children: ReactNode }) => <Stack direction="row" useFlexGap spacing="0.5rem" sx={{ flexWrap: 'wrap' }}>{children}</Stack>;
export const directoryTokens = (value: string): string[] => value.split('|').map((part) => part.trim()).filter(Boolean);

export const suppressionLabel = (reason: string, t: Messages): string => {
  const labels: Record<string, string> = { unsubscribe_global: t.directory.unsubscribe, hard_bounce: t.directory.bounce, complaint: t.directory.complaint, manual: t.directory.manual };
  return labels[reason] ?? reason;
};

export const directoryEventLabel = (type: string, t: Messages): string => {
  const labels: Record<string, string> = { contact_created: t.directory.eventCreated, contact_updated: t.directory.eventUpdated, contact_archived: t.directory.eventArchived, contact_restored: t.directory.eventRestored, member_linked: t.directory.eventLinked, member_unlinked: t.directory.eventUnlinked, membership_added: t.directory.eventMembershipAdded, membership_removed: t.directory.eventMembershipRemoved };
  return labels[type] ?? type;
};
