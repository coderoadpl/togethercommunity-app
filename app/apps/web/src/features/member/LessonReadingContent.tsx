import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Box, Button } from '@mui/material';

import { useTranslations } from '../../i18n/index.js';
import { readLessonTextAutoExpand } from './lesson-reading-preference.js';
import { RichTextContent } from '../../components/ui/RichTextContent.js';
import { sanitizeRichText } from '../../components/ui/rich-text-sanitizer.js';

export const LESSON_TEXT_REVEAL_EVENT = 'lesson-text:reveal';

export const LessonReadingContent = ({ html }: { html: string }) => {
  const t = useTranslations();
  const contentId = useId();
  const content = useRef<HTMLDivElement>(null);
  const visiblePreview = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(readLessonTextAutoExpand);
  const [preview, setPreview] = useState({ long: false, height: 0, fullHeight: 0, fadeEnd: 0, fadeStart: 0 });
  const body = useMemo(() => <RichTextContent centered html={html} data-testid="lesson-html" />, [html]);
  const collapsed = preview.long && !expanded;
  const previewHtml = useMemo(() => {
    if (!collapsed) return '';
    const template = document.createElement('template');
    template.innerHTML = sanitizeRichText(html);
    for (const element of template.content.querySelectorAll('[id]')) element.removeAttribute('id');
    return template.innerHTML;
  }, [html, collapsed]);

  useLayoutEffect(() => {
    const element = content.current;
    if (element === null) return;
    if (collapsed) element.setAttribute('hidden', 'until-found');
    else element.removeAttribute('hidden');
  }, [collapsed]);

  useLayoutEffect(() => {
    const element = content.current;
    if (element === null) return;
    const measure = () => {
      const visible = element.hasAttribute('hidden') ? visiblePreview.current ?? element : element;
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const height = Math.max(window.innerHeight * 0.6, rem * 24);
      const top = visible.getBoundingClientRect().top;
      let fadeEnd = height;
      for (const caption of visible.querySelectorAll('figcaption')) {
        const rect = caption.getBoundingClientRect();
        if (rect.top - top < height && rect.bottom - top > height) {
          fadeEnd = Math.min(fadeEnd, Math.max(0, rect.top - top));
        }
      }
      setPreview({ long: visible.scrollHeight > height, height, fullHeight: visible.scrollHeight, fadeEnd, fadeStart: Math.max(0, fadeEnd - rem * 4) });
    };
    const reveal = () => setExpanded(true);
    const beforeMatch = () => {
      element.removeAttribute('hidden');
      reveal();
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    if (visiblePreview.current !== null) observer?.observe(visiblePreview.current);
    window.addEventListener('resize', measure);
    element.addEventListener(LESSON_TEXT_REVEAL_EVENT, reveal);
    element.addEventListener('beforematch', beforeMatch);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      element.removeEventListener(LESSON_TEXT_REVEAL_EVENT, reveal);
      element.removeEventListener('beforematch', beforeMatch);
    };
  }, [html, collapsed]);

  return (
    <Box sx={{ maxWidth: '44rem', mx: 'auto' }}>
      <Box
        id={contentId}
        data-testid="lesson-reading-preview"
        data-collapsed={collapsed}
        onFocusCapture={() => setExpanded(true)}
        sx={collapsed ? {
          position: 'relative',
          '&:has(> [hidden="until-found"])': {
            maxHeight: preview.height,
            overflow: 'hidden',
            maskImage: `linear-gradient(to bottom, black ${String(preview.fadeStart)}px, transparent ${String(preview.fadeEnd)}px)`,
          },
          '&:not(:has(> [hidden="until-found"])) > [inert]': { display: 'none' },
        } : undefined}
      >
        <Box ref={content} sx={collapsed ? { containIntrinsicBlockSize: `${String(preview.fullHeight)}px` } : undefined}>
          {body}
        </Box>
        {collapsed ? (
          <Box ref={visiblePreview} inert aria-hidden="true" sx={{ position: 'absolute', top: 0, left: 0, width: '100%' }}>
            <RichTextContent centered html={previewHtml} />
          </Box>
        ) : null}
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
