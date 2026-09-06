import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { VersionPreview, VersionPreviewFieldName } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { ConfirmDialog, StatusView } from '../../../components/layout/index.js';
import { localizePanelError, useLanguage, useTranslations, type Messages } from '../../../i18n/index.js';
import { formatDateTime, formatPrice } from '../../../lib/format.js';
import { CoverImage } from '../../../components/ui/CoverImage.js';
import { BreakAnywhereText, Eyebrow, FinePrint, VersionDiffRow } from '../../../theme.js';

type PreviewValue = VersionPreview['fields'][number]['value'];

const FieldValue = ({ value, t, language }: { value: PreviewValue; t: Messages; language: string }) => {
  if (value.kind === 'text') {
    return value.value === '' ? (
      <FinePrint component="p">{t.courses.versionEmptyValue}</FinePrint>
    ) : (
      <Typography variant="body2">{value.value}</Typography>
    );
  }
  if (value.kind === 'flag') {
    return <Typography variant="body2">{value.value ? t.courses.versionFlagOn : t.courses.versionFlagOff}</Typography>;
  }
  if (value.kind === 'price') {
    return <Typography variant="body2">{formatPrice(value.amountCents, value.currency, language)}</Typography>;
  }
  if (value.kind === 'image') {
    return value.url === null ? (
      <FinePrint component="p">{t.courses.versionEmptyValue}</FinePrint>
    ) : (
      <Stack useFlexGap spacing="0.35rem">
        <Box sx={{ maxWidth: '12rem' }}>
          <CoverImage src={value.url} alt="" />
        </Box>
        <BreakAnywhereText component="p" variant="caption">
          {value.url}
        </BreakAnywhereText>
      </Stack>
    );
  }
  if (value.kind === 'list') {
    return value.items.length === 0 ? (
      <FinePrint component="p">{t.courses.versionEmptyList}</FinePrint>
    ) : (
      <Stack component="ul" useFlexGap spacing="0.15rem" sx={{ m: 0, pl: '1.1rem' }}>
        {value.items.map((item, index) => (
          <Typography key={`${item}-${index}`} component="li" variant="body2">
            {item}
          </Typography>
        ))}
      </Stack>
    );
  }
  return value.items.length === 0 ? (
    <FinePrint component="p">{t.courses.versionEmptyList}</FinePrint>
  ) : (
    <Stack component="ul" useFlexGap spacing="0.15rem" sx={{ m: 0, pl: '1.1rem' }}>
      {value.items.map((item, index) => (
        <Typography key={`${item.type}-${index}`} component="li" variant="body2">
          {t.courses.versionBlockType[item.type]}
          {item.detail === '' ? null : ` · ${item.detail}`}
        </Typography>
      ))}
    </Stack>
  );
};

const FieldRow = ({
  name,
  stored,
  current,
  changed,
  t,
  language,
}: {
  name: VersionPreviewFieldName;
  stored: PreviewValue;
  current: PreviewValue | undefined;
  changed: boolean;
  t: Messages;
  language: string;
}) => (
  <VersionDiffRow
    useFlexGap
    spacing="0.4rem"
    changed={changed}
    data-testid={`version-field-${name}`}
    data-changed={changed ? 'true' : 'false'}
  >
    <Eyebrow variant="overline" component="h4">
      {t.courses.versionField[name]}
    </Eyebrow>
    <Stack useFlexGap direction={{ xs: 'column', sm: 'row' }} spacing="1rem">
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <FinePrint component="p">{t.courses.versionColumnStored}</FinePrint>
        <FieldValue value={stored} t={t} language={language} />
      </Box>
      {current === undefined ? null : (
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <FinePrint component="p">{t.courses.versionColumnCurrent}</FinePrint>
          <FieldValue value={current} t={t} language={language} />
        </Box>
      )}
    </Stack>
  </VersionDiffRow>
);

export const VersionPreviewDialog = ({
  versionId,
  onClose,
}: {
  versionId: string;
  onClose: () => void;
}) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const version = useQuery(actions.contentVersion(versionId));
  const restore = useMutation({
    ...actions.restoreContentVersion,
    onSuccess: async () => {
      setConfirming(false);
      await Promise.all([
        queryClient.invalidateQueries(actions.coursesInvalidates()),
        queryClient.invalidateQueries(actions.modulesInvalidates()),
        queryClient.invalidateQueries(actions.lessonsInvalidates()),
        queryClient.invalidateQueries(actions.productsInvalidates()),
        queryClient.invalidateQueries(actions.contentHistoryInvalidates()),
      ]);
    },
  });

  const data = version.data;
  const currentByName = new Map(
    (data?.current?.fields ?? []).map((field) => [field.name, field.value]),
  );
  const changed = new Set(data?.changedFields ?? []);

  return (
    <>
      <Dialog open fullWidth maxWidth="md" onClose={onClose} data-testid="version-preview-dialog">
        <DialogTitle>
          {data === undefined
            ? t.courses.versionLoading
            : t.courses.versionDialogTitle({ ordinal: data.version.ordinal })}
        </DialogTitle>
        <DialogContent dividers>
          {version.isPending ? (
            <StatusView state={{ kind: 'loading', label: t.courses.versionLoading }} />
          ) : version.isError ? (
            <StatusView
              state={{
                kind: 'error',
                message: localizePanelError(version.error, t),
                retry: { label: t.common.retry, onRetry: () => void version.refetch() },
              }}
            />
          ) : (
            <Stack useFlexGap spacing="0.75rem">
              <FinePrint component="p">
                {t.courses.versionDialogSubtitle({
                  date: formatDateTime(version.data.version.createdAt, language),
                  author: version.data.version.createdByDisplayName ?? t.courses.historyUnknownAuthor,
                })}
                {' · '}
                {t.courses.historyEntrySchema({ version: version.data.version.schemaVersion })}
              </FinePrint>
              {version.data.current === null ? (
                <Alert severity="info">{t.courses.versionCurrentMissing}</Alert>
              ) : version.data.changedFields.length === 0 ? (
                <Alert severity="success">{t.courses.versionUnchanged}</Alert>
              ) : (
                <Alert severity="warning">
                  {t.courses.versionChangedCount({ count: version.data.changedFields.length })}
                </Alert>
              )}
              {restore.isError ? (
                <Alert severity="error">{localizePanelError(restore.error, t)}</Alert>
              ) : null}
              {restore.isSuccess ? (
                <Alert severity="success">
                  {t.courses.versionRestoreDone({ ordinal: version.data.version.ordinal })}
                </Alert>
              ) : null}
              {version.data.preview.fields.map((field) => (
                <FieldRow
                  key={field.name}
                  name={field.name}
                  stored={field.value}
                  current={currentByName.get(field.name)}
                  changed={changed.has(field.name)}
                  t={t}
                  language={language}
                />
              ))}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={onClose}>
            {t.courses.versionClose}
          </Button>
          <Button
            variant="contained"
            disabled={data === undefined || restore.isPending}
            onClick={() => setConfirming(true)}
            data-testid="version-restore"
          >
            {t.courses.versionRestore}
          </Button>
        </DialogActions>
      </Dialog>
      <ConfirmDialog
        open={confirming && data !== undefined}
        title={t.courses.versionRestoreConfirmTitle}
        body={
          <Typography variant="body2">
            {t.courses.versionRestoreConfirmBody({ ordinal: data?.version.ordinal ?? 0 })}
          </Typography>
        }
        confirmLabel={t.courses.versionRestoreConfirm}
        cancelLabel={t.common.cancel}
        pending={restore.isPending}
        onConfirm={() => restore.mutate({ versionId })}
        onClose={() => setConfirming(false)}
        data-testid="version-restore-confirm"
      />
    </>
  );
};
