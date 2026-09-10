import { LockKeyholeIcon } from '../components/ui/account-icons.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import { ApiError } from '#core/client/index.js';
import { ChangePasswordForm } from '../components/ui/ChangePasswordForm.js';
import { AccountCard } from '../features/member/AccountCard.js';
import { withAccountPreview } from './page-decorators.js';
const meta = { title: 'Account/ChangePasswordForm', component: ChangePasswordForm, decorators: [withAccountPreview], render: (args) => <AccountCard icon={<LockKeyholeIcon />} title="Password"><ChangePasswordForm {...args} /></AccountCard> } satisfies Meta<typeof ChangePasswordForm>;
export default meta;
type Story = StoryObj<typeof meta>;
const stateStory = (state: string, colorScheme: 'light' | 'dark', viewport: 'desktop' | 'mobile'): Story => ({
  parameters: { colorScheme }, globals: { viewport: { value: viewport } },
  args: { dialog: true, showHeading: false, pending: state === 'Pending', success: state === 'Success', error: state === 'WrongCurrentPassword' || state === 'NoCredentialAccount' ? new ApiError({ code: 'unauthorized', message: 'Authentication failed', details: { providerCode: state === 'WrongCurrentPassword' ? 'INVALID_PASSWORD' : 'CREDENTIAL_ACCOUNT_NOT_FOUND' } }) : null, onSubmit: () => undefined },
  play: async ({ canvasElement }) => {
    if (state === 'Success') return;
    await userEvent.click(within(canvasElement).getByTestId('change-password-open'));
    if (state !== 'TooShort' && state !== 'Mismatch' && state !== 'Pending') return;
    const canvas = within(canvasElement.ownerDocument.body);
    await userEvent.type(canvas.getByTestId('change-current-password'), 'current-password');
    await userEvent.type(canvas.getByTestId('change-new-password'), state === 'TooShort' ? 'short' : 'valid-password-long');
    await userEvent.type(canvas.getByTestId('change-confirm-password'), state === 'Mismatch' ? 'different-password' : state === 'TooShort' ? 'short' : 'valid-password-long');
    if (state !== 'Pending') await userEvent.click(canvas.getByTestId('change-password-submit'));
  },
});
export const IdleLightDesktop1440: Story = stateStory('Idle', 'light', 'desktop');
export const IdleLightMobile390: Story = stateStory('Idle', 'light', 'mobile');
export const IdleDarkDesktop1440: Story = stateStory('Idle', 'dark', 'desktop');
export const IdleDarkMobile390: Story = stateStory('Idle', 'dark', 'mobile');
export const PendingLightDesktop1440: Story = stateStory('Pending', 'light', 'desktop');
export const PendingLightMobile390: Story = stateStory('Pending', 'light', 'mobile');
export const PendingDarkDesktop1440: Story = stateStory('Pending', 'dark', 'desktop');
export const PendingDarkMobile390: Story = stateStory('Pending', 'dark', 'mobile');
export const TooShortLightDesktop1440: Story = stateStory('TooShort', 'light', 'desktop');
export const TooShortLightMobile390: Story = stateStory('TooShort', 'light', 'mobile');
export const TooShortDarkDesktop1440: Story = stateStory('TooShort', 'dark', 'desktop');
export const TooShortDarkMobile390: Story = stateStory('TooShort', 'dark', 'mobile');
export const MismatchLightDesktop1440: Story = stateStory('Mismatch', 'light', 'desktop');
export const MismatchLightMobile390: Story = stateStory('Mismatch', 'light', 'mobile');
export const MismatchDarkDesktop1440: Story = stateStory('Mismatch', 'dark', 'desktop');
export const MismatchDarkMobile390: Story = stateStory('Mismatch', 'dark', 'mobile');
export const WrongCurrentPasswordLightDesktop1440: Story = stateStory('WrongCurrentPassword', 'light', 'desktop');
export const WrongCurrentPasswordLightMobile390: Story = stateStory('WrongCurrentPassword', 'light', 'mobile');
export const WrongCurrentPasswordDarkDesktop1440: Story = stateStory('WrongCurrentPassword', 'dark', 'desktop');
export const WrongCurrentPasswordDarkMobile390: Story = stateStory('WrongCurrentPassword', 'dark', 'mobile');
export const NoCredentialAccountLightDesktop1440: Story = stateStory('NoCredentialAccount', 'light', 'desktop');
export const NoCredentialAccountLightMobile390: Story = stateStory('NoCredentialAccount', 'light', 'mobile');
export const NoCredentialAccountDarkDesktop1440: Story = stateStory('NoCredentialAccount', 'dark', 'desktop');
export const NoCredentialAccountDarkMobile390: Story = stateStory('NoCredentialAccount', 'dark', 'mobile');
export const SuccessLightDesktop1440: Story = stateStory('Success', 'light', 'desktop');
export const SuccessLightMobile390: Story = stateStory('Success', 'light', 'mobile');
export const SuccessDarkDesktop1440: Story = stateStory('Success', 'dark', 'desktop');
export const SuccessDarkMobile390: Story = stateStory('Success', 'dark', 'mobile');
export const EnglishMobile: Story = { ...stateStory('Idle', 'dark', 'mobile'), parameters: { colorScheme: 'dark', locale: 'en' } };
