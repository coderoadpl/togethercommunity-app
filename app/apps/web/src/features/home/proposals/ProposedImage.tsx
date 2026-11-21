import { useState } from 'react';
import { Box, Link, Stack } from '@mui/material';

import type { ProposalImageExtension } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { useTranslations } from '../../../i18n/index.js';
import { BreakAnywhereText, CoverImageElement, FinePrint } from '../../../theme.js';
import type { ImageAwaitingApproval } from './proposal-display.js';

type LoadState = 'loading' | 'loaded' | 'failed';

const FORMAT_NAMES: Record<ProposalImageExtension, string> = {
  png: 'PNG',
  jpg: 'JPEG',
  webp: 'WebP',
  svg: 'SVG',
  ico: 'ICO',
};

const ImageFacts = ({ image, path }: { image: ImageAwaitingApproval; path: string }) => {
  const t = useTranslations().changeProposals;
  return (
    <>
      <FinePrint component="p" data-testid="proposed-image-facts">
        {t.proposedImageFacts({ format: FORMAT_NAMES[image.extension], fingerprint: image.digest.slice(0, 12) })}
      </FinePrint>
      <BreakAnywhereText component="p" variant="caption">{path}</BreakAnywhereText>
      <FinePrint component="p">{t.proposedImagePrivate}</FinePrint>
    </>
  );
};

const RasterPreview = ({ image, path, source }: { image: ImageAwaitingApproval; path: string; source: string }) => {
  const t = useTranslations().changeProposals;
  const [load, setLoad] = useState<LoadState>('loading');
  return (
    <Stack useFlexGap spacing="0.35rem" data-testid="proposed-image" data-state={load}>
      {load === 'failed' ? null : (
        <Box sx={{ maxWidth: '12rem' }}>
          <CoverImageElement
            frame="card"
            src={source}
            alt={t.proposedImageAlt}
            onLoad={() => setLoad('loaded')}
            onError={() => setLoad('failed')}
          />
        </Box>
      )}
      {load === 'loading' ? <FinePrint component="p" role="status">{t.proposedImageLoading}</FinePrint> : null}
      {load === 'failed' ? <FinePrint component="p" role="alert">{t.proposedImageFailed}</FinePrint> : null}
      <ImageFacts image={image} path={path} />
    </Stack>
  );
};

const VectorDownload = ({ image, path, source }: { image: ImageAwaitingApproval; path: string; source: string }) => {
  const t = useTranslations().changeProposals;
  return (
    <Stack useFlexGap spacing="0.35rem" data-testid="proposed-image" data-state="download">
      <FinePrint component="p">{t.proposedImageSvgReason}</FinePrint>
      <Link href={source} download={`${image.digest}.svg`} rel="noreferrer" variant="body2">
        {t.proposedImageSvgDownload}
      </Link>
      <ImageFacts image={image} path={path} />
    </Stack>
  );
};

export const ProposedImage = ({ image, path }: { image: ImageAwaitingApproval; path: string }) => {
  const source = actions.changeProposalImagePath(image.proposalId, image.digest);
  return image.extension === 'svg'
    ? <VectorDownload image={image} path={path} source={source} />
    : <RasterPreview key={source} image={image} path={path} source={source} />;
};
