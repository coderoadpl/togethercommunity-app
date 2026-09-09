import { createContext, useContext, useEffect, type ReactNode } from 'react';

type TitlePart = string | null | undefined;

const TitleContext = createContext({ tenantName: 'Together', studio: false, depth: 0 });
const activeTitles = new Map<symbol, { title: string; depth: number }>();
let originalTitle = '';

const updateTitle = () => {
  let current: { title: string; depth: number } | undefined;
  for (const entry of activeTitles.values()) {
    if (current === undefined || entry.depth >= current.depth) current = entry;
  }
  document.title = current?.title ?? originalTitle;
};

export const useDocumentTitle = (parts: readonly TitlePart[]) => {
  const { depth } = useContext(TitleContext);
  const title = parts.map((part) => part?.trim()).filter(Boolean).join(' · ');

  useEffect(() => {
    if (activeTitles.size === 0) originalTitle = document.title;
    const id = Symbol();
    activeTitles.set(id, { title, depth });
    updateTitle();
    return () => {
      activeTitles.delete(id);
      updateTitle();
    };
  }, [title, depth]);
};

export const DocumentTitleProvider = ({
  tenantName,
  studio = false,
  children,
}: {
  tenantName: string | null | undefined;
  studio?: boolean;
  children: ReactNode;
}) => {
  const context = useContext(TitleContext);
  const { depth } = context;
  const name = tenantName === undefined ? context.tenantName : tenantName?.trim() || 'Together';
  useDocumentTitle([name]);
  return (
    <TitleContext value={{ tenantName: name, studio, depth: depth + 1 }}>
      {children}
    </TitleContext>
  );
};

export const usePageDocumentTitle = (title: ReactNode, studio?: boolean) => {
  const context = useContext(TitleContext);
  const page = typeof title === 'string' || typeof title === 'number' ? String(title).trim() : '';
  useDocumentTitle([
    page,
    page && (studio ?? context.studio) ? 'Studio' : null,
    context.tenantName,
  ]);
};
