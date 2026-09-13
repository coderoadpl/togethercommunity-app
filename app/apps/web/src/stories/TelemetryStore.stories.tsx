import { Box, ThemeProvider } from '@mui/material';
import { createThemeForMode } from '../theme.js';
import type { Meta, StoryObj } from '@storybook/react-vite';

import type { TelemetryStoreView } from '#core/domain/telemetry.js';

import { TelemetryStoreForm, TelemetryUnavailable } from '../features/home/integrations/TelemetryTab.js';
import { withAccountPreview } from './page-decorators.js';

const view: TelemetryStoreView = {
  settings: { provider: null, region: '', connectedAt: null, lastProbeAt: null, lastProbeResult: null, egressMode: 'unknown' },
  egress: { mode: 'unknown', ip: null },
  sync: { lastAcknowledgedSequence: 125, lastAcknowledgedAt: '2026-09-13T10:00:00.000Z', pendingBytes: 4096, oldestPendingAgeSeconds: 120, oldestPendingAt: '2026-09-13T10:01:00.000Z', gapCount: 0, admissionPaused: false },
  hidesStatistics: true,
};
const connected: TelemetryStoreView = { ...view, settings: { ...view.settings, provider: 'mongodb', region: 'EU', lastProbeResult: 'ok' } };
const paused: TelemetryStoreView = { ...connected, sync: { ...connected.sync, pendingBytes: 50 * 1024 * 1024, gapCount: 12, admissionPaused: true } };
const meta = {
  title: 'Integrations/TelemetryStore', component: TelemetryStoreForm, decorators: [withAccountPreview],
  args: { view, pending: false, failed: false, onConnect: () => undefined, onProbe: () => undefined, onDisconnect: () => undefined },
  parameters: { locale: 'en', colorScheme: 'light' },
} satisfies Meta<typeof TelemetryStoreForm>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Disconnected: Story = {};
export const Probing: Story = { args: { pending: true } };
export const Connected: Story = { args: { view: connected } };
export const Error: Story = { args: { failed: true } };
export const AdmissionPaused: Story = { args: { view: paused } };
export const StableEgress: Story = { args: { view: { ...view, egress: { mode: 'stable', ip: '192.0.2.1' } } } };
export const DynamicEgress: Story = { args: { view: { ...view, egress: { mode: 'dynamic', ip: null } } } };
export const UnknownEgress: Story = {};
export const CampaignUnavailable: Story = { render: () => <TelemetryUnavailable /> };
export const DisconnectedDark: Story = { parameters: { colorScheme: 'dark', locale: 'pl' } };
export const ProbingDark: Story = { ...Probing, parameters: { colorScheme: 'dark', locale: 'pl' } };
export const ConnectedDark: Story = { ...Connected, parameters: { colorScheme: 'dark', locale: 'pl' } };
export const ErrorDark: Story = { ...Error, parameters: { colorScheme: 'dark', locale: 'pl' } };
export const AdmissionPausedDark: Story = { ...AdmissionPaused, parameters: { colorScheme: 'dark', locale: 'pl' } };
export const StableEgressDark: Story = { ...StableEgress, parameters: { colorScheme: 'dark', locale: 'pl' } };
export const DynamicEgressDark: Story = { ...DynamicEgress, parameters: { colorScheme: 'dark', locale: 'pl' } };
export const UnknownEgressDark: Story = { parameters: { colorScheme: 'dark', locale: 'pl' } };
export const CampaignUnavailableDark: Story = { ...CampaignUnavailable, parameters: { colorScheme: 'dark', locale: 'pl' } };

const overviewStates = [
  { name: 'Disconnected', view, pending: false, failed: false },
  { name: 'Probing', view, pending: true, failed: false },
  { name: 'Connected', view: connected, pending: false, failed: false },
  { name: 'Error', view, pending: false, failed: true },
  { name: 'Admission paused', view: paused, pending: false, failed: false },
  { name: 'Stable egress', view: { ...view, egress: { mode: 'stable', ip: '192.0.2.1' } }, pending: false, failed: false },
  { name: 'Dynamic egress', view: { ...view, egress: { mode: 'dynamic', ip: null } }, pending: false, failed: false },
  { name: 'Unknown egress', view, pending: false, failed: false },
] satisfies Array<{ name: string; view: TelemetryStoreView; pending: boolean; failed: boolean }>;
export const Overview: Story = {
  render: () => <Box data-testid="telemetry-overview">
    {(['light', 'dark'] as const).map((mode) => <ThemeProvider key={mode} theme={createThemeForMode('shadcn', undefined, mode, 'member')}>
      <Box sx={{ bgcolor: 'background.default', color: 'text.primary', display: 'grid', gap: '1.5rem', p: '0.5rem' }}>
        {overviewStates.map((state) => <TelemetryStoreForm key={state.name} {...state} onConnect={() => undefined} onProbe={() => undefined} onDisconnect={() => undefined} />)}
        <TelemetryUnavailable />
      </Box>
    </ThemeProvider>)}
  </Box>,
};
