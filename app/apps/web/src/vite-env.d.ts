declare module '*.css';

interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly MODE: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_APP_BASE_DOMAIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
