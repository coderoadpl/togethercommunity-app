import { DELETED_MEMBER_DISPLAY, DELETED_POST_PLACEHOLDER } from '#core/domain/index.js';

import type { Messages } from './messages.js';

export const translateDeletedContent = (text: string, t: Messages): string =>
  text === DELETED_MEMBER_DISPLAY ? t.deletedContent.member
    : text === DELETED_POST_PLACEHOLDER ? t.deletedContent.post : text;
