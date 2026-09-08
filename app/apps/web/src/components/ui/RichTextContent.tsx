import DOMPurify from 'dompurify';

import { LessonHtmlContent } from '../../theme.js';

const SANITIZE_CONFIG = Object.freeze({
  FORBID_TAGS: [
    'form', 'input', 'button', 'select', 'textarea', 'option', 'optgroup',
    'label', 'fieldset', 'legend', 'datalist', 'output', 'object', 'embed',
  ],
  FORBID_ATTR: [
    'action', 'method', 'enctype', 'target', 'accept-charset',
    'form', 'formaction', 'formmethod', 'formenctype', 'formtarget', 'formnovalidate',
  ],
});

export const RichTextContent = ({
  html,
  ...rest
}: { html: string; 'data-testid'?: string }) => (
  <LessonHtmlContent
    {...rest}
    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html, SANITIZE_CONFIG) }}
  />
);
