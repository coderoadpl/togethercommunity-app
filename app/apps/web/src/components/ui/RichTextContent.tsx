import DOMPurify from 'dompurify';

import { LessonHtmlContent } from '../../theme.js';

export const RichTextContent = ({
  html,
  ...rest
}: { html: string; 'data-testid'?: string }) => (
  <LessonHtmlContent {...rest} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />
);
