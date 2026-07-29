import { createContext, useContext } from 'react';

export interface PanelTenant {
  id: string;
  slug: string;
  name: string;
  staffRole: 'owner' | 'admin' | null;
  memberId: string | null;
}

export interface PanelContextValue {
  tenant: PanelTenant;
  email: string;
}

const PanelContext = createContext<PanelContextValue | null>(null);

export const PanelContextProvider = PanelContext.Provider;

export const usePanelContext = (): PanelContextValue => {
  const value = useContext(PanelContext);
  if (!value) throw new Error('usePanelContext must be used within the panel layout');
  return value;
};
