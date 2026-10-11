import { Button, Modal, Typography } from '@mui/material';
import { useId, useMemo, useState } from 'react';

import { useTranslations } from '../../i18n/index.js';
import { LessonHtmlContent, LessonImageLightbox, LessonLightboxImage } from '../../theme.js';
import { sanitizeRichText } from './rich-text-sanitizer.js';

interface LightboxImage {
  src: string;
  alt: string;
  caption: string;
  html: string;
}

export const RichTextContent = ({
  html,
  centered = false,
  ...rest
}: { html: string; centered?: boolean; 'data-testid'?: string }) => {
  const t = useTranslations();
  const captionId = useId();
  const [selected, setSelected] = useState<LightboxImage | null>(null);
  if (selected !== null && selected.html !== html) {
    setSelected(null);
  }
  const image = selected?.html === html ? selected : null;
  const content = useMemo(() => {
    const template = document.createElement('template');
    template.innerHTML = sanitizeRichText(html);
    for (const img of template.content.querySelectorAll('img')) {
      if (img.closest('a')) continue;
      img.setAttribute('role', 'button');
      img.setAttribute('tabindex', '0');
      img.setAttribute('aria-label', t.lesson.enlargeImage);
      img.setAttribute('aria-haspopup', 'dialog');
    }
    return { __html: template.innerHTML };
  }, [html, t.lesson.enlargeImage]);

  const openImage = (target: EventTarget) => {
    if (!(target instanceof HTMLImageElement) || target.closest('a')) return;
    target.focus();
    setSelected({
      src: target.currentSrc || target.src,
      alt: target.alt,
      caption: target.closest('figure')?.querySelector('figcaption')?.textContent?.trim() || target.alt,
      html,
    });
  };

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
    <Modal open={image !== null} onClose={() => setSelected(null)}>
      <LessonImageLightbox role="dialog" aria-modal="true" aria-label={t.lesson.enlargeImage} aria-describedby={image?.caption ? captionId : undefined}>
        <Button autoFocus onClick={() => setSelected(null)}>{t.common.close}</Button>
        {image && <LessonLightboxImage src={image.src} alt={image.alt} />}
        {image?.caption && <Typography id={captionId} data-slot="caption">{image.caption}</Typography>}
      </LessonImageLightbox>
    </Modal>
  </>;
};
