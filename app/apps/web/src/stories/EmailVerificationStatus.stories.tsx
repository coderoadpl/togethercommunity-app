import { MailCheckIcon } from '../components/ui/account-icons.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { EmailVerificationStatus } from '../components/ui/EmailVerificationStatus.js';
import { AccountCard } from '../features/member/AccountCard.js';
import { withAccountPreview } from './page-decorators.js';
const meta = { title: 'Account/EmailVerificationStatus', component: EmailVerificationStatus, decorators: [withAccountPreview], render: (args) => <AccountCard icon={<MailCheckIcon />} title="Email"><EmailVerificationStatus {...args} /></AccountCard> } satisfies Meta<typeof EmailVerificationStatus>;
export default meta;
type Story = StoryObj<typeof meta>;
const stateStory = (state: string, colorScheme: 'light' | 'dark', viewport: 'desktop' | 'mobile'): Story => ({
  parameters: { colorScheme }, globals: { viewport: { value: viewport } },
  args: { email: 'alexandra.long.email.address@example.com', emailVerified: state === 'Verified', resendPending: state === 'ResendPending', onResend: () => undefined },
});
export const VerifiedLightDesktop1440: Story = stateStory('Verified', 'light', 'desktop');
export const VerifiedLightMobile390: Story = stateStory('Verified', 'light', 'mobile');
export const VerifiedDarkDesktop1440: Story = stateStory('Verified', 'dark', 'desktop');
export const VerifiedDarkMobile390: Story = stateStory('Verified', 'dark', 'mobile');
export const UnverifiedLightDesktop1440: Story = stateStory('Unverified', 'light', 'desktop');
export const UnverifiedLightMobile390: Story = stateStory('Unverified', 'light', 'mobile');
export const UnverifiedDarkDesktop1440: Story = stateStory('Unverified', 'dark', 'desktop');
export const UnverifiedDarkMobile390: Story = stateStory('Unverified', 'dark', 'mobile');
export const ResendPendingLightDesktop1440: Story = stateStory('ResendPending', 'light', 'desktop');
export const ResendPendingLightMobile390: Story = stateStory('ResendPending', 'light', 'mobile');
export const ResendPendingDarkDesktop1440: Story = stateStory('ResendPending', 'dark', 'desktop');
export const ResendPendingDarkMobile390: Story = stateStory('ResendPending', 'dark', 'mobile');
export const EnglishMobile: Story = { ...stateStory('Verified', 'dark', 'mobile'), parameters: { colorScheme: 'dark', locale: 'en' } };
