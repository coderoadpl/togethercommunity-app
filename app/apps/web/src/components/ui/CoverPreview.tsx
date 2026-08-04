import { useState } from 'react';

import { CoverPreviewIcon, CoverPreviewImage, CoverPreviewSurface } from '../../theme.js';

const IMAGE_ICON_PATH =
  'M21 19V5c0-1.1-.9-2-2-2H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2ZM8.5 11.5l2.5 3.01L14.5 10l4.5 6H5l3.5-4.5Z';

export const CoverPreview = ({
  src,
  label,
  testId,
}: {
  src: string;
  label: string;
  testId: string;
}) => {
  const [loaded, setLoaded] = useState(false);

  return (
    <CoverPreviewSurface
      role="img"
      aria-label={label}
      data-testid={`${testId}-surface`}
    >
      {loaded ? null : (
        <CoverPreviewIcon aria-hidden viewBox="0 0 24 24">
          <path d={IMAGE_ICON_PATH} />
        </CoverPreviewIcon>
      )}
      <CoverPreviewImage
        src={src}
        alt=""
        data-testid={testId}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(false)}
        hidden={!loaded}
      />
    </CoverPreviewSurface>
  );
};
