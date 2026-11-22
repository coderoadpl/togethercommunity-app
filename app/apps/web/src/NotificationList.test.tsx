import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { Notification } from '#core/domain/index.js';

import { en } from './i18n/en.js';
import { NotificationList } from './NotificationList.js';

const keyName = 'Agent‮ one';
const groupTitle = 'Spring” ‮launch';

const proposal: Notification = {
  id: 'n-proposal',
  tenantId: 't1',
  recipientUserId: 'owner',
  kind: 'change-proposal',
  payload: {
    rootPostId: null,
    postId: null,
    contextKind: 'tenant',
    contextId: 'group-1',
    courseId: null,
    eventId: null,
    domain: null,
    lessonName: '',
    authorDisplay: keyName,
    authorAvatarUrl: null,
    snippet: groupTitle,
  },
  sourceKey: 'change-proposal:key-1',
  readAt: null,
  createdAt: new Date().toISOString(),
};

describe('the notification list', () => {
  it('isolates the key name and the group title a key wrote inside the bell sentences', () => {
    render(<NotificationList notifications={[proposal]} onOpen={() => undefined} />);

    const row = screen.getByTestId('notification-n-proposal');
    const isolated = [...row.querySelectorAll('bdi')].map((element) => element.textContent);
    expect(isolated).toEqual([keyName, groupTitle]);
    expect(row).toHaveTextContent(en.notifications.changeProposal({ key: keyName }), { normalizeWhitespace: false });
    expect(row).toHaveTextContent(en.notifications.changeProposalGroup({ title: groupTitle }), { normalizeWhitespace: false });
  });
});
