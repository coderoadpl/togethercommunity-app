import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Alert, Box, Button, Divider, Stack, Typography } from '@mui/material';

import type { MemberDownloadFailureCode, ProductDownloadAssetView } from '#core/domain/index.js';

import { ChevronDownIcon, DownloadIcon } from '../../components/ui/account-icons.js';
import { useLanguage, useTranslations } from '../../i18n/index.js';
import { formatFileSize } from '../../lib/format.js';
import { AccountDisclosure, AccountWrappingText } from '../../theme.js';

type DownloadFile = Pick<
  ProductDownloadAssetView,
  'id' | 'fileName' | 'contentType' | 'sizeBytes' | 'versionNumber' | 'versionNote' | 'downloadPath'
>;

const KNOWN_FILE_TYPES: Readonly<Record<string, string>> = {
  'application/pdf': 'PDF',
  'application/zip': 'ZIP',
  'application/epub+zip': 'EPUB',
};

const fileTypeLabel = ({ contentType, fileName }: Pick<DownloadFile, 'contentType' | 'fileName'>): string => {
  const known = KNOWN_FILE_TYPES[contentType.toLowerCase()];
  if (known !== undefined) return known;
  const extension = /\.([a-z0-9]{1,5})$/iu.exec(fileName)?.[1];
  if (extension !== undefined) return extension.toUpperCase();
  return (contentType.split('/').pop() ?? contentType).toUpperCase();
};

export const DOWNLOAD_PENDING_MS = 5000;

const useDownloadPending = () => {
  const [pending, setPending] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (pending) {
      event.preventDefault();
      return;
    }
    setPending(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setPending(false);
    }, DOWNLOAD_PENDING_MS);
  };
  return { pending, onClick };
};

const DownloadRow = ({ file }: { file: DownloadFile }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const { pending, onClick } = useDownloadPending();
  const meta = [
    fileTypeLabel(file),
    formatFileSize(file.sizeBytes, language),
    t.student.downloadVersionShort({ number: file.versionNumber }),
  ].join(' · ');

  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      useFlexGap
      data-testid={`download-row-${file.id}`}
      sx={{ alignItems: { xs: 'flex-start', sm: 'center' }, columnGap: '1rem', rowGap: '0.5rem' }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <AccountWrappingText variant="subtitle2" component="p">{file.fileName}</AccountWrappingText>
        <Typography variant="body2" color="text.secondary" data-testid={`download-meta-${file.id}`}>{meta}</Typography>
        {file.versionNote ? <Typography variant="body2">{file.versionNote}</Typography> : null}
      </Box>
      <Button
        variant="outlined"
        size="small"
        component="a"
        href={file.downloadPath}
        startIcon={<DownloadIcon />}
        onClick={onClick}
        aria-disabled={pending}
        aria-label={pending
          ? `${t.student.downloadPreparing} ${file.fileName}`
          : t.student.downloadFileVersion({ name: file.fileName, number: file.versionNumber })}
        data-pending={pending}
        data-testid={`download-${file.id}`}
        sx={{ flexShrink: 0 }}
      >
        {pending ? t.student.downloadPreparing : t.student.downloadButton}
      </Button>
    </Stack>
  );
};

export interface DownloadFailureNotice {
  code: MemberDownloadFailureCode;
  assetId: string | null;
  onRetry: () => void;
}

const retryPathFor = (downloads: ProductDownloadAssetView[], assetId: string | null): string | null => {
  if (assetId === null) return null;
  const file = downloads.flatMap((download) => [download, ...download.previousVersions])
    .find((candidate) => candidate.id === assetId);
  return file?.downloadPath ?? null;
};

export const DownloadFailureAlert = ({ failure, retryPath, 'data-testid': testId }: {
  failure: DownloadFailureNotice;
  retryPath: string | null;
  'data-testid'?: string;
}) => {
  const t = useTranslations();
  return (
    <Alert
      severity="error"
      data-testid={testId}
      action={retryPath === null ? (
        <Button color="inherit" size="small" onClick={failure.onRetry}>{t.common.close}</Button>
      ) : (
        <Button color="inherit" size="small" component="a" href={retryPath} onClick={failure.onRetry}>{t.common.retry}</Button>
      )}
    >
      {t.student.downloadFailures[failure.code]}
    </Alert>
  );
};

export const ProductDownloads = ({ productId, productTitle, downloads, failure = null }: {
  productId: string;
  productTitle: string;
  downloads: ProductDownloadAssetView[];
  failure?: DownloadFailureNotice | null;
}) => {
  const t = useTranslations();

  if (downloads.length === 0 && failure === null) return null;

  return (
    <Stack
      role="group"
      aria-label={t.student.downloadsGroupLabel({ title: productTitle })}
      useFlexGap
      spacing="0.75rem"
      data-testid={`product-downloads-${productId}`}
    >
      {downloads.length === 0 ? null : (
        <Typography variant="overline" component="h3">
          {t.student.downloadsHeading}
        </Typography>
      )}
      {failure === null ? null : (
        <DownloadFailureAlert
          failure={failure}
          retryPath={retryPathFor(downloads, failure.assetId)}
          data-testid={`download-failure-${productId}`}
        />
      )}
      {downloads.length === 0 ? null : (
        <Stack useFlexGap spacing="0.75rem" divider={<Divider flexItem />}>
          {downloads.map((download) => (
            <Box key={download.id}>
              <DownloadRow file={download} />
              {download.previousVersions.length > 0 ? (
                <AccountDisclosure component="details">
                  <Typography component="summary" variant="body2">
                    {t.products.previousVersions}
                    <ChevronDownIcon />
                  </Typography>
                  <Stack useFlexGap spacing="0.75rem">
                    {download.previousVersions.map((previous) => (
                      <DownloadRow key={previous.id} file={previous} />
                    ))}
                  </Stack>
                </AccountDisclosure>
              ) : null}
            </Box>
          ))}
        </Stack>
      )}
    </Stack>
  );
};
