import { LessonHtmlContent } from '../../theme.js';
import { sanitizeRichText } from './rich-text-sanitizer.js';

export const RichTextContent = ({
  html,
  centered = false,
  ...rest
}: { html: string; centered?: boolean; 'data-testid'?: string }) => (
  <LessonHtmlContent
    {...rest}
    sx={{ marginInline: centered ? 'auto' : 0 }}
    dangerouslySetInnerHTML={{ __html: sanitizeRichText(html) }}
  />
);
