# Together client SDK integrator quickstart

## Install

Install the client SDK:

```bash
npm install @together-community/client-sdk
```

Install `@tanstack/query-core` as well when descriptor typing is wanted. The
`@together-community` scope is a placeholder until the owner selects the final
npm scope. The package is ESM-only and supports Node 20 or newer, modern
bundlers, and React Native through Metro 0.82 or newer.

## Base URL and tenancy

The request host selects the tenant. Set `baseUrl` to the workspace origin,
such as `https://acme.example.com`. There is no tenant header.

## Bearer authentication

```ts
import { createApiClient } from '@together-community/client-sdk';
import { createCliAuthAdapter } from '@together-community/client-sdk/auth-client';

let token: string | null = null;
const auth = createCliAuthAdapter(
  'https://acme.example.com',
  (issued) => {
    token = issued;
  },
  () => token,
);
const session = await auth.signIn({ email, password });

const api = createApiClient({
  baseUrl: 'https://acme.example.com',
  headers: () => (token === null ? {} : { authorization: `Bearer ${token}` }),
});
```

A successful `session` value exposes `twoFactorRedirect`; when it is true,
complete the TOTP step with `auth.verifyTotp(code)`. Authentication failures
arrive as `Result` values with codes from `ERROR_CODES`. Every API client method
also returns a `Result` envelope. `unwrap` converts a successful envelope to its
value and throws for an error envelope, which suits TanStack Query usage.

## Courses

Direct client calls return envelopes:

```ts
import { createApiClient, unwrap } from '@together-community/client-sdk';

const api = createApiClient({ baseUrl: 'https://acme.example.com' });
const { courses } = unwrap(await api.studentCourses());
const { structure } = unwrap(await api.studentCourseStructure(courses[0].id));
```

The matching TanStack descriptors return unwrapped values:

```ts
import { QueryClient } from '@tanstack/query-core';
import {
  courseStructureQuery,
  studentCoursesQuery,
} from '@together-community/client-sdk';

const queryClient = new QueryClient();
const { courses } = await queryClient.fetchQuery(studentCoursesQuery(api));
const { structure } = await queryClient.fetchQuery(
  courseStructureQuery(api, courses[0].id),
);
```

## Community

Use real space identifiers returned by the list call:

```ts
const { spaces } = unwrap(await api.listSpaces());
const spaceId = spaces[0].id;
const { feed } = unwrap(await api.spaceFeed({ spaceId, limit: 20 }));
const { post } = unwrap(await api.createPost({
  contextKind: 'space',
  contextId: spaceId,
  body: 'Welcome to the space',
}));
await api.reactToPost({ postId: post.id, emoji: '👍' });
```

The same operations are available as query and mutation descriptors:

```ts
import {
  createPostMutation,
  reactToPostMutation,
  spaceFeedQuery,
  spacesQuery,
} from '@together-community/client-sdk';

const { spaces } = await queryClient.fetchQuery(spacesQuery(api));
const spaceId = spaces[0].id;
const { feed } = await queryClient.fetchQuery(
  spaceFeedQuery(api, { spaceId, limit: 20 }),
);
const { post } = await createPostMutation(api).mutationFn({
  contextKind: 'space',
  contextId: spaceId,
  body: 'Welcome to the space',
});
await reactToPostMutation(api).mutationFn({ postId: post.id, emoji: '👍' });
```

## Notifications

Direct calls support unread polling, listing, and read acknowledgements:

```ts
const { unread } = unwrap(await api.unreadNotificationCount());
const { notifications } = unwrap(await api.listNotifications({}));
if (notifications[0] !== undefined) {
  await api.markNotificationRead({ id: notifications[0].id });
}
```

The corresponding descriptors can be passed to TanStack Query integrations:

```ts
import {
  markNotificationReadMutation,
  notificationsQuery,
  unreadNotificationsQuery,
} from '@together-community/client-sdk';

const { unread } = await queryClient.fetchQuery(unreadNotificationsQuery(api));
const { notifications } = await queryClient.fetchQuery(notificationsQuery(api, {}));
if (notifications[0] !== undefined) {
  await markNotificationReadMutation(api).mutationFn({ id: notifications[0].id });
}
```

Configure polling in the consuming TanStack integration around
`unreadNotificationsQuery(api)`. EventSource users can instead subscribe at
the exported `NOTIFICATIONS_STREAM_PATH`.

## Error model

API and authentication calls return `Result` envelopes. Import `ERROR_CODES`
from the domain subpath. Import `HTTP_STATUS_BY_ERROR_CODE` and
`EXIT_CODE_BY_ERROR_CODE` from the contract subpath when an integration needs
the canonical HTTP or process mapping.

Release operators should also read the [publishing guide](./client-sdk-publishing.md).
