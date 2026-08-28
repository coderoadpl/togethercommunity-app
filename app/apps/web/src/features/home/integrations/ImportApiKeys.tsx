import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControl,
  FormControlLabel,
  FormLabel,
  OutlinedInput,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  IMPORT_API_KEY_DEFAULT_EXPIRY_DAYS,
  IMPORT_API_KEY_MAX_LIFETIME_DAYS,
  IMPORT_API_KEY_MAX_LIFETIME_MS,
  isImportApiKeyScope,
  type TenantApiKeyPublic,
} from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { ConfirmDialog, StatusView } from '../../../components/layout/index.js';
import { localizePanelError, useLanguage, useTranslations } from '../../../i18n/index.js';

const dateInputValue = (date: Date): string => {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const relativeDateInputValue = (days: number): string =>
  dateInputValue(new Date(Date.now() + days * 24 * 60 * 60 * 1000));

const expiryIsoForDate = (value: string): string => {
  const selectedEnd = new Date(`${value}T23:59:59.999`).getTime();
  const maximum = Date.now() + IMPORT_API_KEY_MAX_LIFETIME_MS;
  return new Date(Math.min(selectedEnd, maximum)).toISOString();
};

const keyState = (key: TenantApiKeyPublic): 'active' | 'expired' | 'revoked' => {
  if (key.revokedAt !== null) return 'revoked';
  if (key.expiresAt !== null && Date.parse(key.expiresAt) <= Date.now()) return 'expired';
  return 'active';
};

export const ImportApiKeys = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const keys = useQuery(actions.apiKeys);
  const [name, setName] = useState('');
  const [contentScope, setContentScope] = useState(false);
  const [usersScope, setUsersScope] = useState(false);
  const [expiryDate, setExpiryDate] = useState(() => relativeDateInputValue(IMPORT_API_KEY_DEFAULT_EXPIRY_DAYS));
  const [confirmingRevoke, setConfirmingRevoke] = useState<TenantApiKeyPublic | null>(null);
  const [auditKeyId, setAuditKeyId] = useState<string | null>(null);
  const audit = useQuery({
    ...actions.apiKeyImportAudit(auditKeyId ?? ''),
    enabled: auditKeyId !== null,
  });

  const create = useMutation({
    ...actions.createApiKey,
    onSuccess: async () => {
      setName('');
      setContentScope(false);
      setUsersScope(false);
      setExpiryDate(relativeDateInputValue(IMPORT_API_KEY_DEFAULT_EXPIRY_DAYS));
      await queryClient.invalidateQueries(actions.apiKeysInvalidates());
    },
  });
  const revoke = useMutation({
    ...actions.revokeApiKey,
    onSuccess: () => setConfirmingRevoke(null),
    onSettled: async () => {
      await queryClient.invalidateQueries(actions.apiKeysInvalidates());
    },
  });

  const hasScope = contentScope || usersScope;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const scopes = [
      ...(contentScope ? ['import:content'] as const : []),
      ...(usersScope ? ['import:users'] as const : []),
    ];
    if (scopes.length === 0 || expiryDate === '') return;
    create.mutate({ name, scopes, expiresAt: expiryIsoForDate(expiryDate) });
  };

  const importKeys = keys.data?.apiKeys.filter((key) =>
    key.scopes?.some(isImportApiKeyScope) === true) ?? [];
  const locale = language === 'pl' ? 'pl-PL' : 'en-US';
  const formatDate = (value: string): string =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(value));

  return (
    <Stack useFlexGap spacing="1.25rem">
      <Box component="form" onSubmit={submit} sx={{ display: 'grid', gap: '0.8rem' }}>
        <FormControl fullWidth>
          <FormLabel htmlFor="import-api-key-name">{t.integrations.importKeysNameLabel}</FormLabel>
          <OutlinedInput
            id="import-api-key-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t.integrations.importKeysNamePlaceholder}
            inputProps={{ 'data-testid': 'import-api-key-name' }}
          />
        </FormControl>
        <FormControl component="fieldset">
          <FormLabel component="legend">{t.integrations.importKeysScopesLabel}</FormLabel>
          <FormControlLabel
            control={(
              <Checkbox
                checked={contentScope}
                onChange={(event) => setContentScope(event.target.checked)}
                data-testid="import-api-key-content-scope"
              />
            )}
            label={t.integrations.importKeysContentScope}
          />
          <FormControlLabel
            control={(
              <Checkbox
                checked={usersScope}
                onChange={(event) => setUsersScope(event.target.checked)}
                data-testid="import-api-key-users-scope"
              />
            )}
            label={t.integrations.importKeysUsersScope}
          />
        </FormControl>
        {hasScope ? (
          <FormControl fullWidth>
            <FormLabel htmlFor="import-api-key-expiry">{t.integrations.importKeysExpiryLabel}</FormLabel>
            <OutlinedInput
              id="import-api-key-expiry"
              type="date"
              value={expiryDate}
              onChange={(event) => setExpiryDate(event.target.value)}
              inputProps={{
                min: relativeDateInputValue(1),
                max: relativeDateInputValue(IMPORT_API_KEY_MAX_LIFETIME_DAYS),
                'data-testid': 'import-api-key-expiry',
              }}
            />
            <Typography variant="caption" component="p" sx={{ mt: '0.35rem' }}>
              {t.integrations.importKeysExpiryHint}
            </Typography>
          </FormControl>
        ) : null}
        <Box>
          <Button
            type="submit"
            variant="contained"
            data-testid="import-api-key-create"
            disabled={create.isPending || name.trim() === '' || !hasScope || expiryDate === ''}
          >
            {create.isPending ? t.integrations.importKeysCreating : t.integrations.importKeysCreate}
          </Button>
        </Box>
        {create.isSuccess ? (
          <Alert severity="warning" data-testid="import-api-key-secret">
            <Typography variant="subtitle2">{t.integrations.importKeysSecretHeading}</Typography>
            <Typography variant="body2">{t.integrations.importKeysSecretWarning}</Typography>
            <OutlinedInput
              fullWidth
              readOnly
              value={create.data.secret}
              inputProps={{ 'aria-label': t.integrations.importKeysSecretHeading }}
              sx={{ mt: '0.6rem' }}
            />
          </Alert>
        ) : null}
        {create.isError ? <Alert severity="error">{localizePanelError(create.error, t)}</Alert> : null}
      </Box>

      {keys.isPending ? (
        <StatusView surface={false} state={{ kind: 'loading', label: t.integrations.importKeysLoading }} />
      ) : keys.isError ? (
        <StatusView surface={false} state={{ kind: 'error', message: localizePanelError(keys.error, t), retry: { label: t.common.retry, onRetry: () => void keys.refetch() } }} />
      ) : importKeys.length === 0 ? (
        <Typography color="text.secondary">{t.integrations.importKeysEmpty}</Typography>
      ) : (
        <Stack component="ul" useFlexGap spacing="0.75rem" sx={{ listStyle: 'none', p: 0, m: 0 }}>
          {importKeys.map((key) => {
            const state = keyState(key);
            return (
              <Paper
                component="li"
                variant="outlined"
                key={key.id}
                data-testid={`import-api-key-${key.id}`}
                sx={{ p: '0.9rem' }}
              >
                <Stack useFlexGap spacing="0.6rem">
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <Typography variant="subtitle2">{key.name}</Typography>
                    <Chip
                      size="small"
                      color={state === 'active' ? 'success' : state === 'expired' ? 'warning' : 'default'}
                      label={state === 'active'
                        ? t.integrations.importKeysActive
                        : state === 'expired'
                          ? t.integrations.importKeysExpired
                          : t.integrations.importKeysRevoked}
                    />
                    {key.scopes?.filter(isImportApiKeyScope).map((scope) => (
                      <Chip
                        key={scope}
                        size="small"
                        variant="outlined"
                        label={scope === 'import:content'
                          ? t.integrations.importKeysContentScopeShort
                          : t.integrations.importKeysUsersScopeShort}
                      />
                    ))}
                  </Box>
                  {key.expiresAt === null ? null : (
                    <Typography variant="body2" color="text.secondary">
                      {t.integrations.importKeysExpiresOn({ date: formatDate(key.expiresAt) })}
                    </Typography>
                  )}
                  {state === 'active' ? (
                    <Box sx={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <Button
                        type="button"
                        color="error"
                        size="small"
                        data-testid={`import-api-key-revoke-${key.id}`}
                        onClick={() => setConfirmingRevoke(key)}
                      >
                        {t.integrations.importKeysRevoke}
                      </Button>
                      <Button
                        type="button"
                        size="small"
                        data-testid={`import-api-key-audit-${key.id}`}
                        onClick={() => setAuditKeyId(auditKeyId === key.id ? null : key.id)}
                      >
                        {t.integrations.importKeysAudit}
                      </Button>
                    </Box>
                  ) : (
                    <Button
                      type="button"
                      size="small"
                      data-testid={`import-api-key-audit-${key.id}`}
                      onClick={() => setAuditKeyId(auditKeyId === key.id ? null : key.id)}
                    >
                      {t.integrations.importKeysAudit}
                    </Button>
                  )}
                  {auditKeyId === key.id ? (
                    audit.isPending ? (
                      <StatusView surface={false} state={{ kind: 'loading', label: t.integrations.importKeysAuditLoading }} />
                    ) : audit.isError ? (
                      <Alert severity="error">{localizePanelError(audit.error, t)}</Alert>
                    ) : audit.data.events.length === 0 ? (
                      <Typography color="text.secondary">{t.integrations.importKeysAuditEmpty}</Typography>
                    ) : (
                      <Stack component="ul" useFlexGap spacing="0.4rem" sx={{ listStyle: 'none', p: 0, m: 0 }}>
                        {audit.data.events.map((event) => (
                          <Typography component="li" variant="body2" key={event.id}>
                            {t.integrations.importKeysAuditEvent({
                              kind: t.integrations.importKeysAuditKinds[event.kind],
                              importKey: event.importKey,
                              action: t.integrations.importKeysAuditActions[event.action],
                              at: formatDate(event.at),
                            })}
                          </Typography>
                        ))}
                      </Stack>
                    )
                  ) : null}
                </Stack>
              </Paper>
            );
          })}
        </Stack>
      )}
      {revoke.isError ? <Alert severity="error">{localizePanelError(revoke.error, t)}</Alert> : null}
      <ConfirmDialog
        open={confirmingRevoke !== null}
        title={t.integrations.importKeysRevokeConfirmTitle}
        body={t.integrations.importKeysRevokeConfirmBody}
        confirmLabel={revoke.isPending ? t.integrations.importKeysRevoking : t.integrations.importKeysRevoke}
        cancelLabel={t.common.cancel}
        pending={revoke.isPending}
        onClose={() => setConfirmingRevoke(null)}
        onConfirm={() => {
          if (confirmingRevoke !== null) revoke.mutate({ id: confirmingRevoke.id });
        }}
        confirmTestId="import-api-key-revoke-confirm"
      />
    </Stack>
  );
};
