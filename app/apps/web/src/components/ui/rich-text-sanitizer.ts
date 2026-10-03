import DOMPurify from 'dompurify';

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

export const sanitizeRichText = (html: string): string => DOMPurify.sanitize(html, SANITIZE_CONFIG);
