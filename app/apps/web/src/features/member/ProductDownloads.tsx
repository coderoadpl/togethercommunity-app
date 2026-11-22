import { Box, Button, Divider, Stack, Typography } from '@mui/material';

import type { ProductDownloadAssetView } from '#core/domain/index.js';

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

const DownloadRow = ({ file }: { file: DownloadFile }) => {
  const t = useTranslations();
  const { language } = useLanguage();
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
        aria-label={t.student.downloadFileVersion({ name: file.fileName, number: file.versionNumber })}
        data-testid={`download-${file.id}`}
        sx={{ flexShrink: 0 }}
      >
        {t.student.downloadButton}
      </Button>
    </Stack>
  );
};

export const ProductDownloads = ({ productId, productTitle, downloads }: {
  productId: string;
  productTitle: string;
  downloads: ProductDownloadAssetView[];
}) => {
  const t = useTranslations();

  if (downloads.length === 0) return null;

  return (
    <Stack
      role="group"
      aria-label={t.student.downloadsGroupLabel({ title: productTitle })}
      useFlexGap
      spacing="0.75rem"
      data-testid={`product-downloads-${productId}`}
    >
      <Typography variant="overline" component="h3">
        {t.student.downloadsHeading}
      </Typography>
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
    </Stack>
  );
};
