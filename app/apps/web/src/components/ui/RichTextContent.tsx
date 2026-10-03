import { LessonHtmlContent } from '../../theme.js';
import { sanitizeRichText } from './rich-text-sanitizer.js';

export const RichTextContent = ({
  html,
  ...rest
}: { html: string; 'data-testid'?: string }) => (
  <LessonHtmlContent
    {...rest}
    dangerouslySetInnerHTML={{ __html: sanitizeRichText(html) }}
  />
);
