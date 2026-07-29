export interface RuntimeRoute {
  method: string;
  path: string;
}

export const collectRuntimeRoutes: () => RuntimeRoute[];
