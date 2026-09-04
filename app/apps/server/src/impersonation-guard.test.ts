import { describe, expect, it } from 'vitest';

import { BETTER_AUTH_SIGN_OUT_PATH, BETTER_AUTH_SIGN_UP_PATH } from '#adapters/auth/create-auth.js';
import { API_PATHS } from '#core/contract/index.js';

import { collectRuntimeRoutes } from '../../../scripts/generate-route-table.mjs';
import { impersonationRouteDecision } from './impersonation-guard.js';

const runtimeRoutes = collectRuntimeRoutes();

describe('impersonation route guard', () => {
  it('refuses every mutating runtime route except leaving the view', () => {
    const allowedMutations = runtimeRoutes
      .filter((route) => !['GET', 'HEAD', 'OPTIONS'].includes(route.method))
      .filter((route) => impersonationRouteDecision(route) === 'allow')
      .map((route) => `${route.method} ${route.path}`);

    expect(allowedMutations).toEqual([`POST ${API_PATHS.impersonationStop}`]);
  });

  it('refuses every direct-message route, reads included', () => {
    const messageRoutes = runtimeRoutes.filter((route) =>
      route.path.startsWith(API_PATHS.messagesList),
    );

    expect(messageRoutes.length).toBeGreaterThan(3);
    for (const route of messageRoutes) {
      expect(impersonationRouteDecision(route), `${route.method} ${route.path}`).toBe('private');
    }
  });

  it('lets the operator sign out of the account the view hangs on', () => {
    expect(
      impersonationRouteDecision({ method: 'POST', path: BETTER_AUTH_SIGN_OUT_PATH }),
    ).toBe('allow');
    expect(
      impersonationRouteDecision({ method: 'POST', path: BETTER_AUTH_SIGN_UP_PATH }),
    ).toBe('read-only');
  });

  it('allows the member read surface, including the notifications stream', () => {
    for (const path of [
      API_PATHS.me,
      API_PATHS.memberNavigation,
      API_PATHS.memberHomeFeed,
      API_PATHS.studentCourses,
      API_PATHS.notificationsStream,
    ]) {
      expect(impersonationRouteDecision({ method: 'GET', path })).toBe('allow');
    }
  });
});
