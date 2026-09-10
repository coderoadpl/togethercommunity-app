import type { Meta, StoryObj } from '@storybook/react-vite';
import { AccountAvatar } from '../features/member/AccountAvatar.js';
import { AccountCard } from '../features/member/AccountCard.js';
import { withAccountPreview, previewFailure } from './page-decorators.js';
import { pl } from '../i18n/pl.js';
const meta = { title: 'Account/Avatar', component: AccountAvatar, decorators: [withAccountPreview], render: (args) => <AccountCard title="Profile"><AccountAvatar {...args} /></AccountCard> } satisfies Meta<typeof AccountAvatar>;
export default meta;
type Story = StoryObj<typeof meta>;
const stateStory = (state: string, colorScheme: 'light' | 'dark', viewport: 'desktop' | 'mobile'): Story => ({
  parameters: { colorScheme }, globals: { viewport: { value: viewport } },
  args: { name: 'Demo Member', email: 'demo@example.com', avatarUrl: state === 'Fallback' ? 'data:image/png;base64,broken' : null, uploadPending: state === 'Pending', removePending: false, uploadError: state === 'Failure' ? previewFailure : null, removeError: null, avatarError: state === 'Oversize' ? pl.account.avatarTooLarge : null, onUpload: () => undefined, onRemove: () => undefined },
});
export const PendingLightDesktop1440: Story = stateStory('Pending', 'light', 'desktop');
export const PendingLightMobile390: Story = stateStory('Pending', 'light', 'mobile');
export const PendingDarkDesktop1440: Story = stateStory('Pending', 'dark', 'desktop');
export const PendingDarkMobile390: Story = stateStory('Pending', 'dark', 'mobile');
export const OversizeLightDesktop1440: Story = stateStory('Oversize', 'light', 'desktop');
export const OversizeLightMobile390: Story = stateStory('Oversize', 'light', 'mobile');
export const OversizeDarkDesktop1440: Story = stateStory('Oversize', 'dark', 'desktop');
export const OversizeDarkMobile390: Story = stateStory('Oversize', 'dark', 'mobile');
export const FailureLightDesktop1440: Story = stateStory('Failure', 'light', 'desktop');
export const FailureLightMobile390: Story = stateStory('Failure', 'light', 'mobile');
export const FailureDarkDesktop1440: Story = stateStory('Failure', 'dark', 'desktop');
export const FailureDarkMobile390: Story = stateStory('Failure', 'dark', 'mobile');
export const FallbackLightDesktop1440: Story = stateStory('Fallback', 'light', 'desktop');
export const FallbackLightMobile390: Story = stateStory('Fallback', 'light', 'mobile');
export const FallbackDarkDesktop1440: Story = stateStory('Fallback', 'dark', 'desktop');
export const FallbackDarkMobile390: Story = stateStory('Fallback', 'dark', 'mobile');
export const EnglishMobile: Story = { ...stateStory('Pending', 'dark', 'mobile'), parameters: { colorScheme: 'dark', locale: 'en' } };
