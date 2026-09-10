import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import { publicAssetUrl } from '../../theme-public-asset.js';
import { accountFixture } from '../account-fixtures.js';
import fixture from '../fixtures/account.json';
import { withPage } from '../page-decorators.js';

const meta = { title: 'Pages/Account', id: 'account', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'en', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShadcnDesktop: Story = { parameters: { __id: 'account--shadcn--desktop', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobile: Story = { parameters: { __id: 'account--shadcn--mobile', viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };
export const ShadcnMobile375: Story = { parameters: { __id: 'account--shadcn--mobile-375', viewport: { defaultViewport: 'mobile-375' } }, globals: { viewport: { value: 'mobile-375' } } };

export const Security: Story = { parameters: { fixture: { ...fixture, route: '/account?tab=security' } } };
export const Notifications: Story = { parameters: { fixture: { ...fixture, route: '/account?tab=notifications' } } };
const settingsCall = fixture.calls['getTenantSettings:[]'];
export const Playback: Story = {
  parameters: {
    docs: { description: { story: 'Synthetic tenant policy permits members to override video autoplay.' } },
    fixture: {
      ...fixture,
      route: '/account?tab=playback',
      calls: {
        ...fixture.calls,
        'getTenantSettings:[]': {
          ...settingsCall,
          value: { ...settingsCall.value, settings: { ...settingsCall.value.settings, memberVideoAutoplayOverride: true } },
        },
      },
    },
  },
};

const scenarioStory = (scenario: string, colorScheme: 'light' | 'dark', viewport: 'desktop' | 'mobile'): Story => ({
  parameters: { fixture: accountFixture(scenario, publicAssetUrl('/brand/together-solo.svg')), colorScheme, viewport: { defaultViewport: viewport },
    docs: { description: { story: 'Deterministic account state.' } } },
  globals: { viewport: { value: viewport } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    if (scenario === 'SecuritySessionsExpanded') await userEvent.click(await canvas.findByTestId('active-sessions-disclosure'));
    if (scenario === 'SecurityTwoFactorSetup') {
      await userEvent.click(await canvas.findByTestId('enable-2fa-open'));
      const dialog = within(canvasElement.ownerDocument.body);
      await userEvent.type(dialog.getByTestId('enable-2fa-password'), 'demo-password-long');
      await userEvent.click(dialog.getByTestId('enable-2fa'));
      await dialog.findByTestId('totp-uri');
    }
  },
});
export const ProfileDefaultLightDesktop1440: Story = scenarioStory('ProfileDefault', 'light', 'desktop');
export const ProfileDefaultLightMobile390: Story = scenarioStory('ProfileDefault', 'light', 'mobile');
export const ProfileDefaultDarkDesktop1440: Story = scenarioStory('ProfileDefault', 'dark', 'desktop');
export const ProfileDefaultDarkMobile390: Story = scenarioStory('ProfileDefault', 'dark', 'mobile');
export const ProfileWithAvatarAndDetailsLightDesktop1440: Story = scenarioStory('ProfileWithAvatarAndDetails', 'light', 'desktop');
export const ProfileWithAvatarAndDetailsLightMobile390: Story = scenarioStory('ProfileWithAvatarAndDetails', 'light', 'mobile');
export const ProfileWithAvatarAndDetailsDarkDesktop1440: Story = scenarioStory('ProfileWithAvatarAndDetails', 'dark', 'desktop');
export const ProfileWithAvatarAndDetailsDarkMobile390: Story = scenarioStory('ProfileWithAvatarAndDetails', 'dark', 'mobile');
export const ProfileErasureOpenLightDesktop1440: Story = scenarioStory('ProfileErasureOpen', 'light', 'desktop');
export const ProfileErasureOpenLightMobile390: Story = scenarioStory('ProfileErasureOpen', 'light', 'mobile');
export const ProfileErasureOpenDarkDesktop1440: Story = scenarioStory('ProfileErasureOpen', 'dark', 'desktop');
export const ProfileErasureOpenDarkMobile390: Story = scenarioStory('ProfileErasureOpen', 'dark', 'mobile');
export const ProfileErasureResolvedLightDesktop1440: Story = scenarioStory('ProfileErasureResolved', 'light', 'desktop');
export const ProfileErasureResolvedLightMobile390: Story = scenarioStory('ProfileErasureResolved', 'light', 'mobile');
export const ProfileErasureResolvedDarkDesktop1440: Story = scenarioStory('ProfileErasureResolved', 'dark', 'desktop');
export const ProfileErasureResolvedDarkMobile390: Story = scenarioStory('ProfileErasureResolved', 'dark', 'mobile');
export const SecurityVerifiedWithPasswordLightDesktop1440: Story = scenarioStory('SecurityVerifiedWithPassword', 'light', 'desktop');
export const SecurityVerifiedWithPasswordLightMobile390: Story = scenarioStory('SecurityVerifiedWithPassword', 'light', 'mobile');
export const SecurityVerifiedWithPasswordDarkDesktop1440: Story = scenarioStory('SecurityVerifiedWithPassword', 'dark', 'desktop');
export const SecurityVerifiedWithPasswordDarkMobile390: Story = scenarioStory('SecurityVerifiedWithPassword', 'dark', 'mobile');
export const SecurityUnverifiedWithoutPasswordLightDesktop1440: Story = scenarioStory('SecurityUnverifiedWithoutPassword', 'light', 'desktop');
export const SecurityUnverifiedWithoutPasswordLightMobile390: Story = scenarioStory('SecurityUnverifiedWithoutPassword', 'light', 'mobile');
export const SecurityUnverifiedWithoutPasswordDarkDesktop1440: Story = scenarioStory('SecurityUnverifiedWithoutPassword', 'dark', 'desktop');
export const SecurityUnverifiedWithoutPasswordDarkMobile390: Story = scenarioStory('SecurityUnverifiedWithoutPassword', 'dark', 'mobile');
export const SecurityPasskeysAndTwoFactorOnLightDesktop1440: Story = scenarioStory('SecurityPasskeysAndTwoFactorOn', 'light', 'desktop');
export const SecurityPasskeysAndTwoFactorOnLightMobile390: Story = scenarioStory('SecurityPasskeysAndTwoFactorOn', 'light', 'mobile');
export const SecurityPasskeysAndTwoFactorOnDarkDesktop1440: Story = scenarioStory('SecurityPasskeysAndTwoFactorOn', 'dark', 'desktop');
export const SecurityPasskeysAndTwoFactorOnDarkMobile390: Story = scenarioStory('SecurityPasskeysAndTwoFactorOn', 'dark', 'mobile');
export const SecuritySessionsExpandedLightDesktop1440: Story = scenarioStory('SecuritySessionsExpanded', 'light', 'desktop');
export const SecuritySessionsExpandedLightMobile390: Story = scenarioStory('SecuritySessionsExpanded', 'light', 'mobile');
export const SecuritySessionsExpandedDarkDesktop1440: Story = scenarioStory('SecuritySessionsExpanded', 'dark', 'desktop');
export const SecuritySessionsExpandedDarkMobile390: Story = scenarioStory('SecuritySessionsExpanded', 'dark', 'mobile');
export const SecurityTwoFactorSetupLightDesktop1440: Story = scenarioStory('SecurityTwoFactorSetup', 'light', 'desktop');
export const SecurityTwoFactorSetupLightMobile390: Story = scenarioStory('SecurityTwoFactorSetup', 'light', 'mobile');
export const SecurityTwoFactorSetupDarkDesktop1440: Story = scenarioStory('SecurityTwoFactorSetup', 'dark', 'desktop');
export const SecurityTwoFactorSetupDarkMobile390: Story = scenarioStory('SecurityTwoFactorSetup', 'dark', 'mobile');
export const NotificationsDefaultLightDesktop1440: Story = scenarioStory('NotificationsDefault', 'light', 'desktop');
export const NotificationsDefaultLightMobile390: Story = scenarioStory('NotificationsDefault', 'light', 'mobile');
export const NotificationsDefaultDarkDesktop1440: Story = scenarioStory('NotificationsDefault', 'dark', 'desktop');
export const NotificationsDefaultDarkMobile390: Story = scenarioStory('NotificationsDefault', 'dark', 'mobile');
export const NotificationsCustomizedLightDesktop1440: Story = scenarioStory('NotificationsCustomized', 'light', 'desktop');
export const NotificationsCustomizedLightMobile390: Story = scenarioStory('NotificationsCustomized', 'light', 'mobile');
export const NotificationsCustomizedDarkDesktop1440: Story = scenarioStory('NotificationsCustomized', 'dark', 'desktop');
export const NotificationsCustomizedDarkMobile390: Story = scenarioStory('NotificationsCustomized', 'dark', 'mobile');
export const PlaybackOffLightDesktop1440: Story = scenarioStory('PlaybackOff', 'light', 'desktop');
export const PlaybackOffLightMobile390: Story = scenarioStory('PlaybackOff', 'light', 'mobile');
export const PlaybackOffDarkDesktop1440: Story = scenarioStory('PlaybackOff', 'dark', 'desktop');
export const PlaybackOffDarkMobile390: Story = scenarioStory('PlaybackOff', 'dark', 'mobile');
export const PlaybackOnLightDesktop1440: Story = scenarioStory('PlaybackOn', 'light', 'desktop');
export const PlaybackOnLightMobile390: Story = scenarioStory('PlaybackOn', 'light', 'mobile');
export const PlaybackOnDarkDesktop1440: Story = scenarioStory('PlaybackOn', 'dark', 'desktop');
export const PlaybackOnDarkMobile390: Story = scenarioStory('PlaybackOn', 'dark', 'mobile');
export const PlaybackInheritedOnLightDesktop1440: Story = scenarioStory('PlaybackInheritedOn', 'light', 'desktop');
export const PlaybackInheritedOnLightMobile390: Story = scenarioStory('PlaybackInheritedOn', 'light', 'mobile');
export const PlaybackInheritedOnDarkDesktop1440: Story = scenarioStory('PlaybackInheritedOn', 'dark', 'desktop');
export const PlaybackInheritedOnDarkMobile390: Story = scenarioStory('PlaybackInheritedOn', 'dark', 'mobile');
export const AccountWithoutMembershipLightDesktop1440: Story = scenarioStory('AccountWithoutMembership', 'light', 'desktop');
export const AccountWithoutMembershipLightMobile390: Story = scenarioStory('AccountWithoutMembership', 'light', 'mobile');
export const AccountWithoutMembershipDarkDesktop1440: Story = scenarioStory('AccountWithoutMembership', 'dark', 'desktop');
export const AccountWithoutMembershipDarkMobile390: Story = scenarioStory('AccountWithoutMembership', 'dark', 'mobile');
export const AccountWithoutMembershipPreferencesLightDesktop1440: Story = scenarioStory('AccountWithoutMembershipPreferences', 'light', 'desktop');
export const AccountWithoutMembershipPreferencesLightMobile390: Story = scenarioStory('AccountWithoutMembershipPreferences', 'light', 'mobile');
export const AccountWithoutMembershipPreferencesDarkDesktop1440: Story = scenarioStory('AccountWithoutMembershipPreferences', 'dark', 'desktop');
export const AccountWithoutMembershipPreferencesDarkMobile390: Story = scenarioStory('AccountWithoutMembershipPreferences', 'dark', 'mobile');
export const AccountImpersonatedLightDesktop1440: Story = scenarioStory('AccountImpersonated', 'light', 'desktop');
export const AccountImpersonatedLightMobile390: Story = scenarioStory('AccountImpersonated', 'light', 'mobile');
export const AccountImpersonatedDarkDesktop1440: Story = scenarioStory('AccountImpersonated', 'dark', 'desktop');
export const AccountImpersonatedDarkMobile390: Story = scenarioStory('AccountImpersonated', 'dark', 'mobile');
export const AccountPlaybackUnavailableLightDesktop1440: Story = scenarioStory('AccountPlaybackUnavailable', 'light', 'desktop');
export const AccountPlaybackUnavailableLightMobile390: Story = scenarioStory('AccountPlaybackUnavailable', 'light', 'mobile');
export const AccountPlaybackUnavailableDarkDesktop1440: Story = scenarioStory('AccountPlaybackUnavailable', 'dark', 'desktop');
export const AccountPlaybackUnavailableDarkMobile390: Story = scenarioStory('AccountPlaybackUnavailable', 'dark', 'mobile');

export const SecurityLayoutBoundary1024: Story = { ...scenarioStory('SecuritySessionsExpanded', 'light', 'desktop'), parameters: { ...scenarioStory('SecuritySessionsExpanded', 'light', 'desktop').parameters, viewport: { defaultViewport: 'boundary' } }, globals: { viewport: { value: 'boundary' } } };
export const SecurityEnglishLongCopy: Story = scenarioStory('SecuritySessionsExpanded', 'dark', 'mobile');
export const SecurityPolishLongCopy: Story = { ...scenarioStory('SecuritySessionsExpanded', 'dark', 'mobile'), parameters: { ...scenarioStory('SecuritySessionsExpanded', 'dark', 'mobile').parameters, locale: 'pl' } };
export const NotificationsAutomaticAppearance: Story = { parameters: { fixture: accountFixture('NotificationsDefault'), colorScheme: 'auto' } };
