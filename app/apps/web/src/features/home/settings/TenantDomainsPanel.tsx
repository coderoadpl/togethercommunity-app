import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  FormHelperText,
  FormLabel,
  Link as MuiLink,
  OutlinedInput,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  MAX_CUSTOM_DOMAINS_PER_TENANT,
} from '#core/domain/index.js';
import type {
  TenantRouting,
  TenantDomainStatus,
} from '#core/domain/index.js';
import { actions } from '../../../api.js';
import { SectionCard, StatusView } from '../../../components/layout/index.js';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog.js';
import { CopyField } from '../../../components/ui/CopyField.js';
import { useToastError, useToastOutcome } from '../../../components/ui/Toast.js';
import { errorCodeOf, localizePanelError, serverMessageOf, useLanguage, useTranslations } from '../../../i18n/index.js';
import type { Messages } from '../../../i18n/index.js';
import { formatDateTime } from '../../../lib/format.js';
import { Eyebrow, QuietActionLink } from '../../../theme.js';

const CUSTOM_DOMAIN_DOCS_URL =
  'https://github.com/coderoadpl/togethercommunity-app/blob/main/app/docs/custom-domains.md';

const domainStatusLabel = (t: Messages, status: TenantDomainStatus): string => {
  switch (status) {
    case 'active':
      return t.tenantDomains.statusActive;
    case 'pending-dns':
      return t.tenantDomains.statusPendingDns;
    case 'provider-verification':
      return t.tenantDomains.statusProviderVerification;
    case 'error':
      return t.tenantDomains.statusError;
  }
};

const DOMAIN_STATUS_COLOR: Record<TenantDomainStatus, 'success' | 'warning' | 'info' | 'error'> = {
  active: 'success',
  'pending-dns': 'warning',
  'provider-verification': 'info',
  error: 'error',
};

/**
 * A provider refusal and a rejected domain both carry the one sentence that says
 * which domain cannot be connected and why, which the generic copy would drop.
 */
const domainErrorMessage = (error: unknown, t: Messages): string => {
  const code = errorCodeOf(error);
  if (code === 'conflict') return t.tenantDomains.conflict;
  if (code === 'integration_unavailable' || code === 'validation') {
    return serverMessageOf(error) ?? localizePanelError(error, t);
  }
  return localizePanelError(error, t);
};

const DnsRecordRow = ({ record }: { record: TenantRouting['customDomains'][number]['records'][number] }) => {
  const t = useTranslations();

  return (
    <Stack
      useFlexGap
      spacing="0.4rem"
      data-testid={`dns-record-${record.type}-${record.name}`}
    >
      <Stack direction="row" useFlexGap sx={{ gap: '0.5rem', alignItems: 'center' }}>
        <Typography variant="caption">
          {t.tenantDomains.recordType}: {record.type}
        </Typography>
        <Chip
          size="small"
          color={record.status === 'verified' ? 'success' : 'default'}
          label={record.status === 'verified' ? t.tenantDomains.recordVerified : t.tenantDomains.recordPending}
        />
      </Stack>
      <CopyField
        size="small"
        label={t.tenantDomains.recordName}
        value={record.name}
        testId={`dns-record-name-${record.type}-${record.name}`}
      />
      <CopyField
        size="small"
        label={t.tenantDomains.recordValue}
        value={record.value}
        testId={`dns-record-value-${record.type}-${record.name}`}
      />
    </Stack>
  );
};

const DomainRecords = ({ entry }: { entry: TenantRouting['customDomains'][number] }) => {
  const t = useTranslations();
  const rows = entry.records.map((record) => (
    <DnsRecordRow key={`${record.type}-${record.name}-${record.value}`} record={record} />
  ));
  if (entry.status === 'active') {
    return (
      <Box component="details">
        <Typography component="summary" variant="caption" sx={{ cursor: 'pointer' }}>
          {t.tenantDomains.recordsSummary({ count: entry.records.length })}
        </Typography>
        <Stack useFlexGap spacing="0.5rem">{rows}</Stack>
      </Box>
    );
  }
  return (
    <Stack useFlexGap spacing="0.5rem">
      <Typography variant="caption">{t.tenantDomains.recordsHeading}</Typography>
      {rows}
    </Stack>
  );
};

const TenantRedirectsSection = () => {
  const t = useTranslations();
  const redirects = useQuery(actions.tenantRedirects({ limit: 0 }));

  if (!redirects.isSuccess) return null;

  return (
    <Typography variant="body2" data-testid="tenant-redirects-summary">
      {t.tenantDomains.redirectsCount({ count: redirects.data.total })}
      {' · '}
      <MuiLink component={Link} to="/panel/settings/redirects">
        {t.tenantDomains.redirectsManage} →
      </MuiLink>
    </Typography>
  );
};

export const TenantDomainsPanel = ({ canEdit }: { canEdit: boolean }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const routing = useQuery(actions.tenantRouting);
  const [draft, setDraft] = useState('');
  const [removedRedirectTo, setRemovedRedirectTo] = useState<string | null>(null);
  const [removingDomain, setRemovingDomain] = useState<string | null>(null);
  const invalidate = async () => {
    await queryClient.invalidateQueries(actions.tenantRoutingInvalidates());
  };
  const addDomain = useMutation({ ...actions.addTenantDomain, onSuccess: invalidate });
  const checkDomain = useMutation({ ...actions.checkTenantDomain, onSettled: invalidate });
  const checkStorageCors = useMutation({ ...actions.checkTenantDomainStorageCors, onSettled: invalidate });
  const removeDomain = useMutation({
    ...actions.removeTenantDomain,
    onSuccess: async (result) => {
      setRemovingDomain(null);
      setRemovedRedirectTo(result.redirectTo);
      await invalidate();
    },
  });
  const pending = addDomain.isPending || checkDomain.isPending || checkStorageCors.isPending || removeDomain.isPending;
  const busyWith = (
    mutation: { isPending: boolean; variables?: { domain: string } | undefined },
    domain: string,
  ): boolean => mutation.isPending && mutation.variables?.domain === domain;
  useToastOutcome(
    addDomain.isSuccess,
    t.common.saved,
    addDomain.error === null ? null : domainErrorMessage(addDomain.error, t),
  );
  useToastError(checkDomain.error === null ? null : domainErrorMessage(checkDomain.error, t));
  useToastError(checkStorageCors.error === null ? null : domainErrorMessage(checkStorageCors.error, t));
  useToastError(removeDomain.error === null ? null : domainErrorMessage(removeDomain.error, t));

  if (routing.isError) {
    return (
      <SectionCard title={t.tenantDomains.heading} description={t.tenantDomains.intro}>
        <StatusView
          surface={false}
          state={{
            kind: 'error',
            message: localizePanelError(routing.error, t),
            retry: { label: t.common.retry, onRetry: () => void routing.refetch() },
          }}
        />
      </SectionCard>
    );
  }

  if (!routing.isSuccess) {
    return (
      <SectionCard title={t.tenantDomains.heading} description={t.tenantDomains.intro}>
        <StatusView
          surface={false}
          state={{ kind: 'loading', label: t.common.loading }}
          data-testid="tenant-domains-loading"
        />
      </SectionCard>
    );
  }

  const {
    customDomains,
    tenantHost,
    canonicalOrigin,
    canAddCustomDomain,
    apexDomainsSupported,
  } = routing.data.routing;

  return (
    <SectionCard title={t.tenantDomains.heading} description={t.tenantDomains.intro}>
      <Stack useFlexGap spacing="1rem" data-testid="tenant-domains">
        <Stack useFlexGap spacing="0.3rem" data-testid="tenant-canonical-address">
          <Eyebrow>{t.tenantDomains.canonicalAddress}</Eyebrow>
          <Typography variant="body2">{canonicalOrigin}</Typography>
          <Typography variant="caption">{t.tenantDomains.canonicalExplanation}</Typography>
        </Stack>
        <CopyField
          label={t.tenantDomains.workspaceAddress}
          value={tenantHost}
          mono
          testId="tenant-workspace-address"
        />
        {customDomains.some((entry) => entry.verified) ? null : (
          <Alert severity="warning" data-testid="tenant-domain-warning">
            {t.tenantDomains.firstDomainWarning}
            {' '}
            <MuiLink href={CUSTOM_DOMAIN_DOCS_URL} target="_blank" rel="noreferrer">
              {t.tenantDomains.docsLink}
            </MuiLink>
          </Alert>
        )}
        <TenantRedirectsSection />
        {removedRedirectTo === null ? null : (
          <Alert severity="info" data-testid="tenant-domain-redirect">
            {t.tenantDomains.removedRedirect}
            {' '}
            <MuiLink href={removedRedirectTo}>{removedRedirectTo}</MuiLink>
          </Alert>
        )}
        <Stack useFlexGap spacing="0.3rem">
          <Eyebrow>{t.tenantDomains.customDomains}</Eyebrow>
          {customDomains.length === 0 ? (
            <Typography variant="body2">{t.tenantDomains.none}</Typography>
          ) : customDomains.map((entry) => (
            <Stack key={entry.domain} useFlexGap spacing="0.4rem" data-testid={`tenant-domain-${entry.domain}`}>
              <Stack direction="row" useFlexGap sx={{ gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography variant="body2">{entry.domain}</Typography>
                <Chip
                  size="small"
                  color={DOMAIN_STATUS_COLOR[entry.status]}
                  label={domainStatusLabel(t, entry.status)}
                  data-testid={`tenant-domain-status-${entry.domain}`}
                />
                {entry.status === 'active' ? (
                  <QuietActionLink
                    component="button"
                    type="button"
                    variant="caption"
                    underline="hover"
                    disabled={!canEdit || pending}
                    onClick={() => checkDomain.mutate({ domain: entry.domain })}
                    data-testid={`tenant-domain-check-${entry.domain}`}
                  >
                    {busyWith(checkDomain, entry.domain)
                      ? t.tenantDomains.checking
                      : t.tenantDomains.check}
                  </QuietActionLink>
                ) : (
                  <Button
                    type="button"
                    size="small"
                    disabled={!canEdit || pending}
                    onClick={() => checkDomain.mutate({ domain: entry.domain })}
                    data-testid={`tenant-domain-check-${entry.domain}`}
                  >
                    {busyWith(checkDomain, entry.domain)
                      ? t.tenantDomains.checking
                      : t.tenantDomains.check}
                  </Button>
                )}
                <Button
                  type="button"
                  size="small"
                  color="error"
                  disabled={!canEdit || pending}
                  onClick={() => setRemovingDomain(entry.domain)}
                  data-testid={`tenant-domain-remove-${entry.domain}`}
                >
                  {busyWith(removeDomain, entry.domain)
                    ? t.tenantDomains.removing
                    : t.tenantDomains.remove}
                </Button>
              </Stack>
              {entry.lastError === null ? null : (
                <Typography variant="caption" color="error">{entry.lastError}</Typography>
              )}
              {entry.verified && entry.storageCorsStatus === 'blocked' ? (
                <Typography variant="caption" data-testid={`tenant-domain-cors-hint-${entry.domain}`}>
                  {t.tenantDomains.storageCorsHint}
                  {' '}
                  <MuiLink component={Link} to="/panel/integrations" hash="storage">
                    {t.tenantDomains.storageCorsLink}
                  </MuiLink>
                </Typography>
              ) : null}
              {entry.verified && entry.storageCorsStatus === 'unknown' ? (
                <Typography variant="caption" data-testid={`tenant-domain-cors-unknown-${entry.domain}`}>
                  {t.tenantDomains.storageCorsUnknown}
                  {' '}
                  <QuietActionLink
                    component="button"
                    type="button"
                    variant="caption"
                    underline="hover"
                    disabled={!canEdit || pending}
                    onClick={() => checkStorageCors.mutate({ domain: entry.domain })}
                    data-testid={`tenant-domain-cors-check-${entry.domain}`}
                  >
                    {busyWith(checkStorageCors, entry.domain)
                      ? t.tenantDomains.checking
                      : t.tenantDomains.storageCorsCheck}
                  </QuietActionLink>
                </Typography>
              ) : null}
              <DomainRecords entry={entry} />
              {entry.lastCheckedAt === null ? null : (
                <Typography variant="caption">
                  {t.tenantDomains.lastChecked({ at: formatDateTime(entry.lastCheckedAt, language) })}
                </Typography>
              )}
            </Stack>
          ))}
        </Stack>
        {canAddCustomDomain ? (
          <Stack
            component="form"
            useFlexGap
            spacing="0.5rem"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              addDomain.mutate({ domain: draft }, { onSuccess: () => setDraft('') });
            }}
          >
            <FormControl>
              <FormLabel htmlFor="tenant-domain-input">{t.tenantDomains.addLabel}</FormLabel>
              <OutlinedInput
                id="tenant-domain-input"
                value={draft}
                disabled={!canEdit}
                placeholder={t.tenantDomains.addPlaceholder}
                onChange={(event) => setDraft(event.target.value)}
                inputProps={{ 'data-testid': 'tenant-domain-input' }}
              />
              {apexDomainsSupported ? null : (
                <FormHelperText data-testid="tenant-domain-hint">
                  {t.tenantDomains.addHint}
                </FormHelperText>
              )}
            </FormControl>
            <Button
              type="submit"
              variant="contained"
              disabled={!canEdit || pending || draft.trim().length === 0}
              data-testid="tenant-domain-add"
            >
              {addDomain.isPending ? t.tenantDomains.adding : t.tenantDomains.add}
            </Button>
          </Stack>
        ) : (
          <Typography variant="body2" data-testid="tenant-domain-limit">
            {t.tenantDomains.limitReached({ max: MAX_CUSTOM_DOMAINS_PER_TENANT })}
          </Typography>
        )}
        {removingDomain ? (
          <ConfirmDialog
            open
            title={t.tenantDomains.removeConfirmTitle}
            body={<Typography variant="body1">{t.tenantDomains.removeConfirm({ domain: removingDomain })}</Typography>}
            confirmLabel={busyWith(removeDomain, removingDomain) ? t.tenantDomains.removing : t.tenantDomains.remove}
            cancelLabel={t.common.cancel}
            pending={removeDomain.isPending}
            onClose={() => setRemovingDomain(null)}
            onConfirm={() => removeDomain.mutate({ domain: removingDomain })}
            confirmTestId="tenant-domain-remove-confirm"
          />
        ) : null}
      </Stack>
    </SectionCard>
  );
};
