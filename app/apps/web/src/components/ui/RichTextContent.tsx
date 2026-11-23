import { Box, IconButton, Modal, SvgIcon, Typography } from '@mui/material';
import { useCallback, useId, useMemo, useState, type MouseEvent } from 'react';

import { useTranslations } from '../../i18n/index.js';
import { LessonHtmlContent, LessonImageLightbox, LessonLightboxBackdrop, LessonLightboxImage } from '../../theme.js';
import { sanitizeRichText } from './rich-text-sanitizer.js';

interface LightboxImage {
  src: string;
  alt: string;
  figcaption: string;
  vector: boolean;
  fillRatio: number | null;
  html: string;
}

const CloseIcon = () => (
  <SvgIcon stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" aria-hidden viewBox="0 0 24 24">
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </SvgIcon>
);

const isVectorSource = (src: string): boolean => {
  if (src.startsWith('data:image/svg+xml')) return true;
  try {
    return new URL(src, document.baseURI).pathname.toLowerCase().endsWith('.svg');
  } catch {
    return false;
  }
};

const renderedRatio = (image: HTMLImageElement): number | null => {
  const { width, height } = image.getBoundingClientRect();
  return width > 0 && height > 0 ? width / height : null;
};

const altText = (alt: string): string => alt.trim().replace(/\.+$/u, '');

export const RichTextContent = ({
  html,
  centered = false,
  ...rest
}: { html: string; centered?: boolean; 'data-testid'?: string }) => {
  const t = useTranslations();
  const captionId = useId();
  const [selected, setSelected] = useState<LightboxImage | null>(null);
  const [captionHeight, setCaptionHeight] = useState(0);
  if (selected !== null && selected.html !== html) {
    setSelected(null);
  }
  const image = selected?.html === html ? selected : null;
  const content = useMemo(() => {
    const template = document.createElement('template');
    template.innerHTML = sanitizeRichText(html);
    for (const img of template.content.querySelectorAll('img')) {
      if (img.closest('a')) continue;
      const alt = altText(img.alt);
      img.setAttribute('role', 'button');
      img.setAttribute('tabindex', '0');
      img.setAttribute('aria-label', alt ? t.lesson.enlargeNamedImage({ alt }) : t.lesson.enlargeImage);
      img.setAttribute('aria-haspopup', 'dialog');
    }
    return { __html: template.innerHTML };
  }, [html, t.lesson]);

  const openImage = (target: EventTarget) => {
    if (!(target instanceof HTMLImageElement) || target.closest('a')) return;
    target.focus();
    const src = target.currentSrc || target.src;
    const vector = isVectorSource(src);
    setSelected({
      src,
      alt: target.alt,
      figcaption: target.closest('figure')?.querySelector('figcaption')?.textContent?.trim() ?? '',
      vector,
      fillRatio: vector ? renderedRatio(target) : null,
      html,
    });
  };
  const measureVector = (loaded: HTMLImageElement) => {
    const { naturalWidth, naturalHeight } = loaded;
    if (naturalWidth === 0 || naturalHeight === 0) return;
    setSelected((current) => current?.vector === true && current.fillRatio === null
      ? { ...current, fillRatio: naturalWidth / naturalHeight }
      : current);
  };
  const observeCaption = useCallback((caption: HTMLElement | null) => {
    if (caption === null) return;
    const measure = () => setCaptionHeight(caption.getBoundingClientRect().height);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(caption);
    return () => {
      observer?.disconnect();
      setCaptionHeight(0);
    };
  }, []);
  const close = () => setSelected(null);
  const closeOutsideImage = (event: MouseEvent<HTMLElement>) => {
    if (event.target instanceof Element && event.target.closest('img, button, [data-slot="caption"]')) return;
    close();
  };

  const alt = image ? altText(image.alt) : '';
  const figcaption = image?.figcaption ?? '';
  const dialogName = alt || figcaption || t.lesson.enlargeImage;

  return <>
    <LessonHtmlContent
      {...rest}
      sx={{ marginInline: centered ? 'auto' : 0 }}
      dangerouslySetInnerHTML={content}
      onClick={(event) => openImage(event.target)}
      onKeyDown={(event) => {
        if ((event.key === 'Enter' || event.key === ' ') && event.target instanceof HTMLImageElement && !event.target.closest('a')) {
          event.preventDefault();
          openImage(event.target);
        }
      }}
    />
    <Modal open={image !== null} onClose={close} slots={{ backdrop: LessonLightboxBackdrop }}>
      <LessonImageLightbox
        role="dialog"
        aria-modal="true"
        aria-label={dialogName}
        aria-describedby={figcaption && dialogName !== figcaption ? captionId : undefined}
        data-testid="lesson-image-lightbox"
        onClick={closeOutsideImage}
      >
        <IconButton autoFocus disableFocusRipple data-slot="close" aria-label={t.common.close} onClick={close}><CloseIcon /></IconButton>
        <Box data-slot="stage" sx={{ '--lightbox-caption-height': `${String(captionHeight)}px` }}>
          {image && <LessonLightboxImage src={image.src} alt={image.alt} vector={image.vector} fillRatio={image.fillRatio} onLoad={(event) => measureVector(event.currentTarget)} />}
          {figcaption && <Typography ref={observeCaption} id={captionId} data-slot="caption">{figcaption}</Typography>}
        </Box>
      </LessonImageLightbox>
    </Modal>
  </>;
};
