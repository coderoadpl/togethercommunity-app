import { describe, expect, it } from 'vitest';

import { DELETED_POST_PLACEHOLDER } from './community.js';
import { deletedContentPl } from './deleted-content.pl.js';
import { DELETED_MEMBER_DISPLAY } from './tenant.js';
import { directMessage, lessonQuestion, spaceEvent, spacePost, threadReply } from './transactional-email.js';

const input = {
  tenantName: 'Community',
  lessonName: 'Introduction',
  spaceName: 'General',
  authorDisplay: DELETED_MEMBER_DISPLAY,
  senderDisplay: DELETED_MEMBER_DISPLAY,
  snippet: DELETED_POST_PLACEHOLDER,
  url: 'https://example.test/discussion',
};

describe('deleted content in transactional emails', () => {
  it.each([threadReply, lessonQuestion, spacePost, spaceEvent, directMessage])(
    'translates markers in HTML and plain text for each recipient',
    (render) => {
      for (const language of ['en', 'pl']) {
        const messages = language === 'pl' ? deletedContentPl : { member: 'Deleted account', post: 'Deleted post' };
        const email = render(language, input);
        for (const body of [email.html, email.text]) {
          expect(body).toContain(messages.member);
          expect(body).toContain(messages.post);
          expect(body).not.toContain(DELETED_MEMBER_DISPLAY);
          expect(body).not.toContain(DELETED_POST_PLACEHOLDER);
        }
      }
    },
  );
});
