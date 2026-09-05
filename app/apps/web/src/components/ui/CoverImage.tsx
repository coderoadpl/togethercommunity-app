import {
  CoverImageElement,
  CoverPlaceholderBox,
  CoverPlaceholderInitials,
  type CoverFrame,
} from '../../theme.js';

const initialsOf = (title: string): string =>
  title
    .split(/\s+/u)
    .filter((word) => word.length > 0)
    .slice(0, 2)
    .map((word) => (word[0] ?? '').toLocaleUpperCase())
    .join('');

export const CoverImage = ({
  src,
  alt,
  frame = 'card',
  testId,
}: {
  src: string;
  alt: string;
  frame?: CoverFrame;
  testId?: string | undefined;
}) => (
  <CoverImageElement
    frame={frame}
    src={src}
    alt={alt}
    loading={frame === 'standalone' ? 'eager' : 'lazy'}
    data-testid={testId}
  />
);

export const CoverPlaceholder = ({
  title,
  frame = 'card',
  testId,
}: {
  title: string;
  frame?: CoverFrame;
  testId?: string | undefined;
}) => (
  <CoverPlaceholderBox frame={frame} data-testid={testId}>
    <CoverPlaceholderInitials component="span" aria-hidden>
      {initialsOf(title)}
    </CoverPlaceholderInitials>
  </CoverPlaceholderBox>
);
