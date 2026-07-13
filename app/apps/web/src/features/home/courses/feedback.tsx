import { Alert, Box } from '@mui/material';

import { ApiError } from '@core/client/index.js';

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const detailMessages = (details: unknown): string[] => {
  if (details === null || typeof details !== 'object') return [];
  const messages: string[] = [];
  if ('formErrors' in details && isStringArray(details.formErrors)) messages.push(...details.formErrors);
  if ('fieldErrors' in details && details.fieldErrors !== null && typeof details.fieldErrors === 'object') {
    for (const value of Object.values(details.fieldErrors)) {
      if (isStringArray(value)) messages.push(...value);
    }
  }
  return messages;
};

export const errorMessage = (error: unknown): string =>
  error instanceof ApiError ? error.appError.message : error instanceof Error ? error.message : 'Something went wrong';

export const MutationError = ({ error }: { error: Error }) => {
  const appError = error instanceof ApiError ? error.appError : null;
  const details = appError ? detailMessages(appError.details) : [];
  return (
    <Alert>
      {appError ? appError.message : error.message}
      {details.length > 0 ? (
        <Box component="ul" sx={{ m: 0, pl: '1.2rem' }}>
          {details.map((message) => (
            <Box component="li" key={message}>
              {message}
            </Box>
          ))}
        </Box>
      ) : null}
    </Alert>
  );
};

export const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

export const displayDate = (value: string): string =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
