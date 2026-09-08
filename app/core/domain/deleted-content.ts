import { DELETED_POST_PLACEHOLDER } from './community.js';
import { deletedContentPl } from './deleted-content.pl.js';
import { languageOrDefault } from './language.js';
import { DELETED_MEMBER_DISPLAY } from './tenant.js';

export const translateDeletedEmailContent = (text: string, language: string): string => {
  const messages = languageOrDefault(language) === 'pl'
    ? deletedContentPl : { member: 'Deleted account', post: 'Deleted post' };
  return text === DELETED_MEMBER_DISPLAY ? messages.member
    : text === DELETED_POST_PLACEHOLDER ? messages.post : text;
};
