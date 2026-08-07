# ADR-0014: Signed video playback

Status: accepted, 2026-08-07.

## Context

Native players require direct HLS playlists, while the existing learner-facing
lesson read signs only Bunny Stream embed URLs for browser playback. A Stream
library's CDN hostname is tenant-specific and cannot be derived from its library
identifier.

## Decision

Together provides an additive, session-authenticated
`GET /api/student/lessons/:lessonId/playback` endpoint. It applies the existing
`lesson:play` entitlement gate and returns every playable lesson block in lesson
order.

Bunny embed tokens and CDN Token Authentication V2 directory tokens use the
tenant's existing `bunny.securityKey`. The CDN hostname is stored as
`bunnyStreamCdnHostname`. Signed URLs share one expiry whose lifetime comes from
`PLAYBACK_TOKEN_TTL_SECONDS` and defaults to six hours.

When the security key is absent, the endpoint returns an unsigned embed URL and
no HLS URL. When only the CDN hostname is absent, it returns a signed embed URL
and no HLS URL. External embeds remain unchanged after authorization, and video
blocks without a library identifier are reported as unavailable.

The member web player remains unchanged.
