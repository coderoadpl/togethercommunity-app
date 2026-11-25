import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { listLayoutSchema, type ListLayout, type ListLayoutId } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { LIST_LAYOUT_STORAGE_PREFIX, persistedJsonPreference } from '../../../theme-mode.js';
import { defaultGridLayout, reconcileGridLayout, sameGridLayout, type GridLayoutSchema } from '../../../components/ui/data-grid/grid-layout.js';

const GRID_LAYOUT_SAVE_DELAY_MS = 800;

const parseGridLayout = (value: unknown): ListLayout | null => {
  const parsed = listLayoutSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

interface SavedGridLayoutInput {
  tenantId: string;
  userId: string | undefined;
  listId: ListLayoutId;
  schema: GridLayoutSchema;
  readOnly?: boolean;
}

interface LocalChange { layout: ListLayout; persist: boolean }

export const useSavedGridLayout = ({ tenantId, userId, listId, schema, readOnly = false }: SavedGridLayoutInput) => {
  const queryClient = useQueryClient();
  const cache = useMemo(
    () => userId && !readOnly
      ? persistedJsonPreference<ListLayout | null>(`${LIST_LAYOUT_STORAGE_PREFIX}${listId}:${tenantId}:${userId}`, parseGridLayout, null)
      : null,
    [listId, tenantId, userId, readOnly],
  );
  const cached = useMemo(() => cache?.load() ?? null, [cache]);
  const saved = useQuery(actions.listLayouts.get(tenantId, listId));
  const [local, setLocal] = useState<LocalChange | null>(null);
  const save = useMutation({
    ...actions.listLayouts.save,
    onSuccess: async () => { await queryClient.invalidateQueries(actions.listLayouts.invalidates(tenantId, listId)); },
  });
  const reset = useMutation({
    ...actions.listLayouts.reset,
    onSuccess: async () => { await queryClient.invalidateQueries(actions.listLayouts.invalidates(tenantId, listId)); },
  });
  const pending = useRef<ListLayout | null>(null);
  const saveLayout = save.mutate;

  const stored = saved.isSuccess ? saved.data.layout : cached;
  const layout = local?.layout ?? reconcileGridLayout(stored, schema);

  useEffect(() => {
    if (local === null || !local.persist || readOnly) return;
    pending.current = local.layout;
    const timer = setTimeout(() => {
      pending.current = null;
      saveLayout({ listId, layout: local.layout });
    }, GRID_LAYOUT_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [local, listId, readOnly, saveLayout]);

  useEffect(() => () => {
    if (pending.current !== null) saveLayout({ listId, layout: pending.current });
  }, [listId, saveLayout]);

  const change = (next: ListLayout) => {
    if (sameGridLayout(next, layout)) return;
    cache?.save(next);
    setLocal({ layout: next, persist: true });
  };

  const resetLayout = () => {
    pending.current = null;
    cache?.clear();
    setLocal({ layout: defaultGridLayout(schema), persist: false });
    if (!readOnly) reset.mutate({ listId });
  };

  return {
    layout,
    change,
    reset: resetLayout,
    saveError: save.error ?? reset.error,
  };
};
