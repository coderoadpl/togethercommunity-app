import { AccountCard } from '../features/member/AccountCard.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import { ActiveSessions } from '../components/ui/ActiveSessions.js';
import { accountSessions } from './account-fixtures.js';
import { withAccountPreview, idleOperation, previewFailure } from './page-decorators.js';
const meta = { title: 'Account/ActiveSessions', component: ActiveSessions, decorators: [withAccountPreview] } satisfies Meta<typeof ActiveSessions>;
export default meta;
type Story = StoryObj<typeof meta>;
const stateStory = (state: string, colorScheme: 'light' | 'dark', viewport: 'desktop' | 'mobile'): Story => ({
  parameters: { colorScheme }, globals: { viewport: { value: viewport } },
  args: {
    Card: AccountCard,
    sessions: { data: state === 'Loading' || state === 'FailureRetry' ? undefined : state === 'Empty' ? [] : state === 'CurrentOnly' ? accountSessions.filter((row) => row.current) : accountSessions, pending: state === 'Loading', error: state === 'FailureRetry' ? previewFailure : null, retry: () => undefined },
    revokeSession: { ...idleOperation, pending: state === 'RevokePending', success: state === 'RevokeSuccess', error: state === 'RevokeError' ? previewFailure : null },
    revokeOtherSessions: { ...idleOperation, success: state === 'BulkSuccess' },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    if (state === 'Collapsed' || state === 'Loading' || state === 'FailureRetry') return;
    await userEvent.click(canvas.getByTestId('active-sessions-disclosure'));
    if (state === 'IndividualConfirmation') await userEvent.click(within(canvas.getByTestId('session-desktop')).getByRole('button'));
    if (state === 'BulkConfirmation' || state === 'Cancellation') await userEvent.click(canvas.getByTestId('revoke-other-sessions'));
    if (state === 'Cancellation') await userEvent.click(within(canvasElement.ownerDocument.body).getByTestId('revoke-sessions-confirm-cancel'));
  },
});
export const CollapsedLightDesktop1440: Story = stateStory('Collapsed', 'light', 'desktop');
export const CollapsedLightMobile390: Story = stateStory('Collapsed', 'light', 'mobile');
export const CollapsedDarkDesktop1440: Story = stateStory('Collapsed', 'dark', 'desktop');
export const CollapsedDarkMobile390: Story = stateStory('Collapsed', 'dark', 'mobile');
export const ExpandedLightDesktop1440: Story = stateStory('Expanded', 'light', 'desktop');
export const ExpandedLightMobile390: Story = stateStory('Expanded', 'light', 'mobile');
export const ExpandedDarkDesktop1440: Story = stateStory('Expanded', 'dark', 'desktop');
export const ExpandedDarkMobile390: Story = stateStory('Expanded', 'dark', 'mobile');
export const CurrentOnlyLightDesktop1440: Story = stateStory('CurrentOnly', 'light', 'desktop');
export const CurrentOnlyLightMobile390: Story = stateStory('CurrentOnly', 'light', 'mobile');
export const CurrentOnlyDarkDesktop1440: Story = stateStory('CurrentOnly', 'dark', 'desktop');
export const CurrentOnlyDarkMobile390: Story = stateStory('CurrentOnly', 'dark', 'mobile');
export const SeveralSessionsLightDesktop1440: Story = stateStory('SeveralSessions', 'light', 'desktop');
export const SeveralSessionsLightMobile390: Story = stateStory('SeveralSessions', 'light', 'mobile');
export const SeveralSessionsDarkDesktop1440: Story = stateStory('SeveralSessions', 'dark', 'desktop');
export const SeveralSessionsDarkMobile390: Story = stateStory('SeveralSessions', 'dark', 'mobile');
export const LoadingLightDesktop1440: Story = stateStory('Loading', 'light', 'desktop');
export const LoadingLightMobile390: Story = stateStory('Loading', 'light', 'mobile');
export const LoadingDarkDesktop1440: Story = stateStory('Loading', 'dark', 'desktop');
export const LoadingDarkMobile390: Story = stateStory('Loading', 'dark', 'mobile');
export const EmptyLightDesktop1440: Story = stateStory('Empty', 'light', 'desktop');
export const EmptyLightMobile390: Story = stateStory('Empty', 'light', 'mobile');
export const EmptyDarkDesktop1440: Story = stateStory('Empty', 'dark', 'desktop');
export const EmptyDarkMobile390: Story = stateStory('Empty', 'dark', 'mobile');
export const FailureRetryLightDesktop1440: Story = stateStory('FailureRetry', 'light', 'desktop');
export const FailureRetryLightMobile390: Story = stateStory('FailureRetry', 'light', 'mobile');
export const FailureRetryDarkDesktop1440: Story = stateStory('FailureRetry', 'dark', 'desktop');
export const FailureRetryDarkMobile390: Story = stateStory('FailureRetry', 'dark', 'mobile');
export const IndividualConfirmationLightDesktop1440: Story = stateStory('IndividualConfirmation', 'light', 'desktop');
export const IndividualConfirmationLightMobile390: Story = stateStory('IndividualConfirmation', 'light', 'mobile');
export const IndividualConfirmationDarkDesktop1440: Story = stateStory('IndividualConfirmation', 'dark', 'desktop');
export const IndividualConfirmationDarkMobile390: Story = stateStory('IndividualConfirmation', 'dark', 'mobile');
export const BulkConfirmationLightDesktop1440: Story = stateStory('BulkConfirmation', 'light', 'desktop');
export const BulkConfirmationLightMobile390: Story = stateStory('BulkConfirmation', 'light', 'mobile');
export const BulkConfirmationDarkDesktop1440: Story = stateStory('BulkConfirmation', 'dark', 'desktop');
export const BulkConfirmationDarkMobile390: Story = stateStory('BulkConfirmation', 'dark', 'mobile');
export const CancellationLightDesktop1440: Story = stateStory('Cancellation', 'light', 'desktop');
export const CancellationLightMobile390: Story = stateStory('Cancellation', 'light', 'mobile');
export const CancellationDarkDesktop1440: Story = stateStory('Cancellation', 'dark', 'desktop');
export const CancellationDarkMobile390: Story = stateStory('Cancellation', 'dark', 'mobile');
export const RevokePendingLightDesktop1440: Story = stateStory('RevokePending', 'light', 'desktop');
export const RevokePendingLightMobile390: Story = stateStory('RevokePending', 'light', 'mobile');
export const RevokePendingDarkDesktop1440: Story = stateStory('RevokePending', 'dark', 'desktop');
export const RevokePendingDarkMobile390: Story = stateStory('RevokePending', 'dark', 'mobile');
export const RevokeSuccessLightDesktop1440: Story = stateStory('RevokeSuccess', 'light', 'desktop');
export const RevokeSuccessLightMobile390: Story = stateStory('RevokeSuccess', 'light', 'mobile');
export const RevokeSuccessDarkDesktop1440: Story = stateStory('RevokeSuccess', 'dark', 'desktop');
export const RevokeSuccessDarkMobile390: Story = stateStory('RevokeSuccess', 'dark', 'mobile');
export const BulkSuccessLightDesktop1440: Story = stateStory('BulkSuccess', 'light', 'desktop');
export const BulkSuccessLightMobile390: Story = stateStory('BulkSuccess', 'light', 'mobile');
export const BulkSuccessDarkDesktop1440: Story = stateStory('BulkSuccess', 'dark', 'desktop');
export const BulkSuccessDarkMobile390: Story = stateStory('BulkSuccess', 'dark', 'mobile');
export const RevokeErrorLightDesktop1440: Story = stateStory('RevokeError', 'light', 'desktop');
export const RevokeErrorLightMobile390: Story = stateStory('RevokeError', 'light', 'mobile');
export const RevokeErrorDarkDesktop1440: Story = stateStory('RevokeError', 'dark', 'desktop');
export const RevokeErrorDarkMobile390: Story = stateStory('RevokeError', 'dark', 'mobile');
export const EnglishMobile: Story = { ...stateStory('Collapsed', 'dark', 'mobile'), parameters: { colorScheme: 'dark', locale: 'en' } };
