import { useEffect } from 'react';
import { Alert, Box } from '@mui/material';

import { ApiError } from '#core/client/index.js';

import { localizePanelError, useTranslations, type Messages } from '../../../i18n/index.js';

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

interface ValidationField {
  name: string;
  id: string;
  label: string;
}

const invalidFieldNames = (details: unknown): string[] => {
  if (details === null || typeof details !== 'object') return [];
  const fields: string[] = [];
  if ('fieldErrors' in details && details.fieldErrors !== null && typeof details.fieldErrors === 'object') {
    for (const [name, value] of Object.entries(details.fieldErrors)) {
      if (isStringArray(value) && value.length > 0) fields.push(name);
    }
  }
  return fields;
};

const hasFormErrors = (details: unknown): boolean =>
  details !== null &&
  typeof details === 'object' &&
  'formErrors' in details &&
  isStringArray(details.formErrors) &&
  details.formErrors.length > 0;

const detailMessages = (details: unknown, t: Messages, fields: ValidationField[]): string[] => {
  const messages = invalidFieldNames(details).map((name) => {
    const field = fields.find((candidate) => candidate.name === name);
    return field === undefined ? t.errors.validationForm : t.errors.validationField({ field: field.label });
  });
  if (hasFormErrors(details)) messages.push(t.errors.validationForm);
  return [...new Set(messages)];
};

export const errorMessage = (error: unknown, t: Messages): string => localizePanelError(error, t);

export const MutationError = ({ error, id, fields = [] }: { error: Error; id?: string; fields?: ValidationField[] }) => {
  const t = useTranslations();
  const appError = error instanceof ApiError ? error.appError : null;
  const fieldNames = invalidFieldNames(appError?.details);
  const firstFieldId = fieldNames
    .map((name) => fields.find((field) => field.name === name)?.id)
    .find((fieldId) => fieldId !== undefined) ?? (fieldNames.length > 0 || hasFormErrors(appError?.details) ? fields[0]?.id : undefined);
  const details = appError ? detailMessages(appError.details, t, fields) : [];

  useEffect(() => {
    if (firstFieldId !== undefined) document.getElementById(firstFieldId)?.focus();
  }, [error, firstFieldId]);

  return (
    <Alert severity="error" id={id}>
      {localizePanelError(error, t)}
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
