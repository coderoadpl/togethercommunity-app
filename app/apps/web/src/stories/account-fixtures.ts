import fixture from './fixtures/account.json';

const me = fixture.calls['me:[]'].value;
const settings = fixture.calls['getTenantSettings:[]'].value.settings;
export const accountSessions = [
  { id: 'desktop', current: false, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/140.0', createdAt: '2026-06-10T12:00:00.000Z', lastActiveAt: '2026-07-01T10:00:00.000Z' },
  { id: 'current', current: true, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140.0.0.0 Safari/537.36', createdAt: '2026-06-15T12:00:00.000Z', lastActiveAt: '2026-07-01T12:00:00.000Z' },
  { id: 'mobile', current: false, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1', createdAt: '2026-06-20T12:00:00.000Z', lastActiveAt: '2026-07-01T09:00:00.000Z' },
  { id: 'unknown', current: false, userAgent: 'A very long unrecognized device label with additional browser details for wrapping', createdAt: '2026-06-25T12:00:00.000Z', lastActiveAt: '2026-06-30T12:00:00.000Z' },
];
export const accountPasskeys = [
  { id: 'laptop', name: 'Personal laptop with a long descriptive passkey name', createdAt: '2026-06-15T12:00:00.000Z' },
  { id: 'key', name: '', createdAt: '2026-06-20T12:00:00.000Z' },
];
const ok = (value: unknown) => ({ ok: true, value });
const erasure = (status: 'open' | 'completed') => ({ id: 'erasure-demo', tenantId: 'tenant-studio', memberId: me.tenant.memberId, requestedAt: '2026-06-20T12:00:00.000Z', createdAt: '2026-06-20T12:00:00.000Z', dueAt: '2026-07-20T12:00:00.000Z', status, resolvedAt: status === 'open' ? null : '2026-06-30T12:00:00.000Z', resolutionNote: null, reason: null, resolvedByUserId: null });

export const accountFixture = (scenario: string, avatarUrl?: string) => {
  const calls: Record<string, unknown> = { ...fixture.calls, 'listAccountSessions:[]': ok({ sessions: [accountSessions[1]] }) };
  let route = '/account';
  if (scenario.startsWith('Security')) route += '?tab=security';
  if (scenario.startsWith('Notifications')) route += '?tab=notifications';
  if (scenario.startsWith('Playback')) {
    route += '?tab=playback';
    calls['getTenantSettings:[]'] = ok({ settings: { ...settings, memberVideoAutoplayOverride: true, videoAutoplayDefault: scenario === 'PlaybackInheritedOn' } });
    calls['me:[]'] = ok({ ...me, tenant: { ...me.tenant, videoAutoplay: scenario === 'PlaybackInheritedOn' ? null : scenario === 'PlaybackOn' } });
  }
  if (scenario === 'ProfileWithAvatarAndDetails') {
    calls['me:[]'] = ok({ ...me, avatarUrl: avatarUrl ?? null, email: 'alexandra.long.email.address.for.account.preview@example.com', tenant: { ...me.tenant, displayName: 'Alexandra Morgan with a deliberately long display name' } });
    calls['getTenantSettings:[]'] = ok({ settings: { ...settings, supportConfigured: true, supportUrl: 'https://example.com/support' } });
    calls['listMemberBillingOrders:[1,25]'] = ok({ orders: [{ id: 'order-demo', createdAt: '2026-06-20T12:00:00.000Z', billing: { companyName: 'Acme Studio', nip: '1234563218', address: '10 Example Street', postalCode: '00-001', city: 'Warsaw', country: 'PL' }, invoice: { id: 'invoice-demo', provider: 'ksef', status: 'issued' } }], total: 1, page: 1, pageSize: 25 });
  }
  if (scenario === 'ProfileErasureOpen' || scenario === 'ProfileErasureResolved') calls['getMyErasureRequest:[]'] = ok({ request: erasure(scenario === 'ProfileErasureOpen' ? 'open' : 'completed') });
  if (scenario === 'SecurityUnverifiedWithoutPassword') calls['me:[]'] = ok({ ...me, emailVerified: false, hasPassword: false });
  if (scenario === 'SecurityPasskeysAndTwoFactorOn' || scenario === 'SecuritySessionsExpanded') {
    calls['listPasskeys:[]'] = ok(accountPasskeys);
    calls['listAccountSessions:[]'] = ok({ sessions: accountSessions });
  }
  if (scenario === 'SecurityPasskeysAndTwoFactorOn') calls['me:[]'] = ok({ ...me, twoFactorEnabled: true });
  if (scenario === 'NotificationsCustomized') calls['me:[]'] = ok({ ...me, tenant: { ...me.tenant, dmOptOut: true, language: 'en' } });
  if (scenario === 'AccountWithoutMembership' || scenario === 'AccountWithoutMembershipPreferences') {
    calls['publicNavigation:[]'] = ok({ navigation: { courses: [], defaultHomeSpaceId: null, lockedSpaces: [], spaces: [] } });
    calls['me:[]'] = ok({ ...me, tenant: { ...me.tenant, memberId: null } });
    if (scenario.endsWith('Preferences')) route += '?tab=notifications';
  }
  if (scenario === 'AccountImpersonated') {
    route += '?tab=security';
    calls['me:[]'] = ok({ ...me, impersonation: { id: 'impersonation-demo', subjectMemberId: me.tenant.memberId, subjectName: me.name, actorName: 'Demo Staff', expiresAt: '2026-07-01T13:00:00.000Z' } });
  }
  if (scenario === 'AccountPlaybackUnavailable') route += '?tab=playback';
  return { ...fixture, scenario, route, calls };
};
