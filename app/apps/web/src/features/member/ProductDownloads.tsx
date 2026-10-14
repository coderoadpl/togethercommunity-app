import { Box, Button, Stack, Typography } from '@mui/material';

import type { ProductDownloadAssetView } from '#core/domain/index.js';

import { useTranslations } from '../../i18n/index.js';

export const ProductDownloads = ({ productId, downloads }: {
  productId: string;
  downloads: ProductDownloadAssetView[];
}) => {
  const t = useTranslations();

  if (downloads.length === 0) return null;

  return (
    <Stack useFlexGap spacing="0.5rem" data-testid={`product-downloads-${productId}`}>
      <Typography variant="overline" component="h3">
        {t.student.downloadsHeading}
      </Typography>
      <Box>
        <Stack direction="row" useFlexGap spacing="0.5rem" sx={{ flexWrap: 'wrap' }}>
          {downloads.map((download) => (
            <Stack key={download.id} spacing="0.5rem">
              <Button variant="outlined" size="small" component="a" href={download.downloadPath}
                data-testid={`download-${download.id}`}>
                {t.student.downloadFile({ name: download.fileName })}
                {' · '}{t.products.fileVersion({ number: download.versionNumber })}
              </Button>
              {download.personalisationSizeExceeded ? (
                <Typography variant="body2" color="text.secondary">
                  {t.student.downloadNoCopyIdentifier}
                </Typography>
              ) : null}
              {download.versionNote ? <Typography variant="body2">{download.versionNote}</Typography> : null}
              {download.previousVersions.length > 0 ? (
                <Box component="details">
                  <Typography component="summary" sx={{ cursor: 'pointer' }}>{t.products.previousVersions}</Typography>
                  <Stack spacing="0.5rem">
                    {download.previousVersions.map((previous) => (
                      <Box key={previous.id}>
                        <Button size="small" component="a" href={previous.downloadPath} data-testid={`download-${previous.id}`}>
                          {t.student.downloadFile({ name: previous.fileName })}
                          {' · '}{t.products.fileVersion({ number: previous.versionNumber })}
                        </Button>
                        {previous.personalisationSizeExceeded ? (
                          <Typography variant="body2" color="text.secondary">
                            {t.student.downloadNoCopyIdentifier}
                          </Typography>
                        ) : null}
                        {previous.versionNote ? <Typography variant="body2">{previous.versionNote}</Typography> : null}
                      </Box>
                    ))}
                  </Stack>
                </Box>
              ) : null}
            </Stack>
          ))}
        </Stack>
      </Box>
    </Stack>
  );
};
