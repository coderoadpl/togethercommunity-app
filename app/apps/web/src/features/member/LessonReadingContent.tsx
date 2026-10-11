import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Box, Button } from '@mui/material';

import { useTranslations } from '../../i18n/index.js';
import { readLessonTextAutoExpand } from './lesson-reading-preference.js';
import { RichTextContent } from '../../components/ui/RichTextContent.js';

export const LESSON_TEXT_REVEAL_EVENT = 'lesson-text:reveal';

export const LessonReadingContent = ({ html }: { html: string }) => {
  const t = useTranslations();
  const contentId = useId();
  const content = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(readLessonTextAutoExpand);
  const [preview, setPreview] = useState({ long: false, height: 0, fadeEnd: 0, fadeStart: 0 });
  const body = useMemo(() => <RichTextContent centered html={html} data-testid="lesson-html" />, [html]);
  const collapsed = preview.long && !expanded;

  useLayoutEffect(() => {
    const element = content.current;
    if (element === null) return;
    const measure = () => {
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const height = Math.max(window.innerHeight * 0.6, rem * 24);
      const top = element.getBoundingClientRect().top;
      let fadeEnd = height;
      for (const caption of element.querySelectorAll('figcaption')) {
        const rect = caption.getBoundingClientRect();
        if (rect.top - top < height && rect.bottom - top > height) {
          fadeEnd = Math.min(fadeEnd, Math.max(0, rect.top - top));
        }
      }
      const long = element.scrollHeight > height;
      const fadeStart = Math.max(0, fadeEnd - rem * 4);
      setPreview((previous) => previous.long === long && previous.height === height &&
        previous.fadeEnd === fadeEnd && previous.fadeStart === fadeStart
        ? previous
        : { long, height, fadeEnd, fadeStart });
    };
    const reveal = () => setExpanded(true);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener('resize', measure);
    element.addEventListener(LESSON_TEXT_REVEAL_EVENT, reveal);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      element.removeEventListener(LESSON_TEXT_REVEAL_EVENT, reveal);
    };
  }, [html]);

  return (
    <Box sx={{ maxWidth: '44rem', mx: 'auto' }}>
      <Box
        id={contentId}
        data-testid="lesson-reading-preview"
        data-collapsed={collapsed}
        onFocusCapture={collapsed ? () => setExpanded(true) : undefined}
        sx={collapsed ? {
          maxHeight: preview.height,
          overflow: 'hidden',
          maskImage: `linear-gradient(to bottom, black ${String(preview.fadeStart)}px, transparent ${String(preview.fadeEnd)}px)`,
        } : undefined}
      >
        <Box ref={content}>
          {body}
        </Box>
      </Box>
      {preview.long ? (
        <Box sx={{ mt: '0.75rem', display: 'flex', justifyContent: 'center' }}>
          <Button
            variant="outlined"
            aria-controls={contentId}
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? t.lesson.collapseText : t.lesson.showAll}
          </Button>
        </Box>
      ) : null}
    </Box>
  );
};
