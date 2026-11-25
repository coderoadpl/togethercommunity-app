import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { listLayoutSchema, type ListLayout, type ListLayoutId } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { LIST_LAYOUT_STORAGE_PREFIX, onListLayoutCopiesCleared, persistedJsonPreference } from '../../../theme-mode.js';
import { defaultGridLayout, reconcileGridLayout, sameGridLayout, type GridLayoutSchema } from '../../../components/ui/data-grid/grid-layout.js';

const GRID_LAYOUT_SAVE_DELAY_MS = 800;
const writes = new Map<string, Promise<void>>();

const enqueueWrite = (key: string, write: () => Promise<void>) => {
  const previous = writes.get(key) ?? Promise.resolve();
  const next = previous.then(write);
  writes.set(key, next);
  const release = () => { if (writes.get(key) === next) writes.delete(key); };
  void next.then(release, release);
};

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

interface WriteSession {
  active: boolean;
  revision: number;
  timer?: ReturnType<typeof setTimeout>;
}

export const useSavedGridLayout = ({ tenantId, userId, listId, schema, readOnly = false }: SavedGridLayoutInput) => {
  const queryClient = useQueryClient();
  const scope = useMemo(() => ({
    key: JSON.stringify([tenantId, userId, listId]),
    writable: userId !== undefined && !readOnly,
    cache: userId !== undefined && !readOnly
      ? persistedJsonPreference<ListLayout | null>(`${LIST_LAYOUT_STORAGE_PREFIX}${listId}:${tenantId}:${userId}`, parseGridLayout, null)
      : null,
  }), [tenantId, userId, listId, readOnly]);
  const cached = useMemo(() => scope.cache?.load() ?? null, [scope]);
  const saved = useQuery({ ...actions.listLayouts.get(tenantId, userId, listId), enabled: scope.writable });
  const [state, setState] = useState<{ scope: typeof scope; local: ListLayout | null; error: Error | null }>({ scope, local: null, error: null });
  if (state.scope !== scope) setState({ scope, local: null, error: null });
  const current = state.scope === scope ? state : null;
  const layout = current?.local ?? reconcileGridLayout(scope.writable && saved.isSuccess ? saved.data.layout : cached, schema);
  const sessionRef = useRef<WriteSession | null>(null);

  useLayoutEffect(() => {
    const session: WriteSession = { active: scope.writable, revision: 0 };
    sessionRef.current = session;
    const discard = () => {
      session.active = false;
      clearTimeout(session.timer);
    };
    const unsubscribe = onListLayoutCopiesCleared(discard);
    return () => { discard(); unsubscribe(); };
  }, [scope]);

  const updateLocal = (next: ListLayout) => setState({ scope, local: next, error: null });
  const write = (session: WriteSession, revision: number, operation: () => Promise<unknown>, supersedable: boolean) => {
    enqueueWrite(scope.key, async () => {
      if (!session.active || (supersedable && session.revision !== revision)) return;
      try {
        await operation();
        if (session.active) void queryClient.invalidateQueries(actions.listLayouts.invalidates(tenantId, userId, listId));
      } catch (error) {
        if (session.active && session.revision === revision) {
          setState((previous) => ({ ...previous, error: error instanceof Error ? error : new Error(String(error)) }));
        }
      }
    });
  };

  const change = (next: ListLayout) => {
    if (sameGridLayout(next, layout)) return;
    updateLocal(next);
    const session = sessionRef.current;
    if (!session?.active) return;
    scope.cache?.save(next);
    clearTimeout(session.timer);
    const revision = ++session.revision;
    session.timer = setTimeout(() => {
      write(session, revision, () => actions.listLayouts.save({ listId, layout: next }), true);
    }, GRID_LAYOUT_SAVE_DELAY_MS);
  };

  const reset = () => {
    updateLocal(defaultGridLayout(schema));
    const session = sessionRef.current;
    if (!session?.active) return;
    scope.cache?.clear();
    clearTimeout(session.timer);
    const revision = ++session.revision;
    write(session, revision, () => actions.listLayouts.reset({ listId }), false);
  };

  return { layout, change, reset, saveError: current?.error ?? null };
};
