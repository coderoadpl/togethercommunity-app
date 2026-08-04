import { API_PATHS } from '#core/contract/index.js';

export const DEFAULT_API_BODY_LIMIT = 100 * 1024;
export const PUBLIC_FORM_BODY_LIMIT = 16 * 1024;
export const WEBHOOK_BODY_LIMIT = 512 * 1024;
export const M2M_TRANSACTIONAL_BODY_LIMIT = 512 * 1024;
export const CONTENT_BODY_LIMIT = 2 * 1024 * 1024;

const CONTENT_PATHS = new Set<string>([
  API_PATHS.marketingLayouts,
  API_PATHS.marketingDocuments,
  API_PATHS.marketingDocumentUpdate,
  API_PATHS.lessonsCreate,
  API_PATHS.lessonsUpdate,
]);

const isWebhookPath = (path: string): boolean =>
  path.startsWith('/api/webhooks/stripe/')
  || path.startsWith('/api/webhooks/ses/');

const isPublicFormPath = (path: string): boolean =>
  /^\/u\/[^/]+(?:\/(?:confirm|all|preferences))?$/.test(path)
  || /^\/marketing\/confirm\/[^/]+$/.test(path);

export const requestBodyLimit = (method: string, path: string): number | undefined => {
  if (!['POST', 'PUT', 'PATCH'].includes(method)) return undefined;
  if (isWebhookPath(path)) return WEBHOOK_BODY_LIMIT;
  if (path === API_PATHS.m2mTransactionalMessagesCreate) return M2M_TRANSACTIONAL_BODY_LIMIT;
  if (CONTENT_PATHS.has(path)) return CONTENT_BODY_LIMIT;
  if (path.startsWith('/api/')) return DEFAULT_API_BODY_LIMIT;
  if (isPublicFormPath(path)) return PUBLIC_FORM_BODY_LIMIT;
  return undefined;
};
