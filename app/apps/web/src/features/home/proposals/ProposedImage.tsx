import { Fragment, useState } from 'react';
import { Alert, Box, Link, Stack } from '@mui/material';

import type { ProposalImageExtension } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { useTranslations } from '../../../i18n/index.js';
import { BreakAnywhereText, CoverImageElement, FinePrint, UnbrokenSegment, VisuallyHidden } from '../../../theme.js';
import { imageFingerprint, shortProposedImagePath, type ImageAwaitingApproval } from './proposal-display.js';

type LoadState = 'loading' | 'loaded' | 'failed';

const FORMAT_NAMES: Record<ProposalImageExtension, string> = {
  png: 'PNG',
  jpg: 'JPEG',
  webp: 'WebP',
  svg: 'SVG',
  ico: 'ICO',
};

const ProposedAddress = ({ path }: { path: string }) => {
  const segments = shortProposedImagePath(path).split('/');
  return (
    <BreakAnywhereText component="p" variant="caption" title={path} data-testid="proposed-image-address">
      <span aria-hidden data-testid="proposed-image-address-short">
        {segments.map((segment, index) => (
          <Fragment key={index}>
            {index === 0 ? null : <>/<wbr /></>}
            <UnbrokenSegment>{segment}</UnbrokenSegment>
          </Fragment>
        ))}
      </span>
      <VisuallyHidden>{path}</VisuallyHidden>
    </BreakAnywhereText>
  );
};

const ImageFacts = ({ image, path, privateNote }: { image: ImageAwaitingApproval; path: string; privateNote: boolean }) => {
  const t = useTranslations().changeProposals;
  return (
    <>
      <FinePrint component="p" data-testid="proposed-image-facts">
        {t.proposedImageFacts({ format: FORMAT_NAMES[image.extension], fingerprint: imageFingerprint(image.digest) })}
      </FinePrint>
      <ProposedAddress path={path} />
      {privateNote ? <FinePrint component="p">{t.proposedImagePrivate}</FinePrint> : null}
    </>
  );
};

const RasterPreview = ({ image, path, source }: { image: ImageAwaitingApproval; path: string; source: string }) => {
  const t = useTranslations().changeProposals;
  const [load, setLoad] = useState<LoadState>('loading');
  return (
    <Stack useFlexGap spacing="0.35rem" data-testid="proposed-image" data-state={load}>
      {load === 'failed' ? (
        <Alert severity="warning" data-testid="proposed-image-failed">{t.proposedImageFailed}</Alert>
      ) : (
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
      <ImageFacts image={image} path={path} privateNote={load !== 'failed'} />
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
      <ImageFacts image={image} path={path} privateNote />
    </Stack>
  );
};

export const ProposedImage = ({ image, path }: { image: ImageAwaitingApproval; path: string }) => {
  const source = actions.changeProposalImagePath(image.proposalId, image.digest);
  return image.extension === 'svg'
    ? <VectorDownload image={image} path={path} source={source} />
    : <RasterPreview key={source} image={image} path={path} source={source} />;
};
