import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { TelemetryStoreView } from '#core/domain/telemetry.js';

import { en } from '../../../i18n/en.js';
import { renderWithProviders } from '../../../test/render.js';
import { TelemetryStoreForm, TelemetryUnavailable } from './TelemetryTab.js';

const view: TelemetryStoreView = {
  settings: { provider: null, region: '', connectedAt: null, lastProbeAt: null, lastProbeResult: null, egressMode: 'unknown' },
  egress: { mode: 'unknown', ip: null },
  sync: { lastAcknowledgedSequence: 0, lastAcknowledgedAt: null, pendingBytes: 0, oldestPendingAt: null, gapCount: 0, admissionPaused: false },
  hidesStatistics: true,
};
const props = { view, pending: false, failed: false, onConnect: vi.fn(), onProbe: vi.fn(), onDisconnect: vi.fn() };
describe('statistics integration', () => {
  it('submits credentials and clears the password field', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TelemetryStoreForm {...props} />);
    await user.type(screen.getByLabelText(en.telemetryStore.connection), 'mongodb://user:password@example.test/analytics');
    await user.type(screen.getByLabelText(en.telemetryStore.region), 'EU');
    await user.click(screen.getByRole('button', { name: en.telemetryStore.connect }));
    expect(props.onConnect).toHaveBeenCalledWith({ connectionString: 'mongodb://user:password@example.test/analytics', region: 'EU' });
    expect(screen.getByLabelText(en.telemetryStore.connection)).toHaveValue('');
  });
  it('requires the explicit existing-copies warning before disconnecting', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TelemetryStoreForm {...props} view={{ ...view, settings: { ...view.settings, provider: 'mongodb' } }} />);
    await user.click(screen.getByRole('button', { name: en.telemetryStore.disconnect }));
    expect(props.onDisconnect).not.toHaveBeenCalled();
    expect(screen.getByText(en.telemetryStore.disconnectWarning)).toBeVisible();
    await user.click(screen.getByRole('button', { name: en.telemetryStore.confirmDisconnect }));
    expect(props.onDisconnect).toHaveBeenCalledOnce();
  });
  it.each(['stable', 'dynamic', 'unknown'] as const)('shows %s egress guidance', (mode) => {
    renderWithProviders(<TelemetryStoreForm {...props} view={{ ...view, egress: { mode, ip: mode === 'stable' ? '192.0.2.1' : null } }} />);
    expect(screen.getByTestId(`telemetry-egress-${mode}`)).toBeVisible();
  });
  it('renders synchronization state as localized values', () => {
    const connected = { ...view, settings: { ...view.settings, provider: 'mongodb' as const }, sync: { ...view.sync, lastAcknowledgedAt: '2026-09-13T10:00:00.000Z', oldestPendingAt: '2026-09-13T09:00:00.000Z', pendingBytes: 4096 } };
    renderWithProviders(<TelemetryStoreForm {...props} view={connected} />);
    expect(screen.queryByText('2026-09-13T10:00:00.000Z')).not.toBeInTheDocument();
    expect(screen.queryByText('4096')).not.toBeInTheDocument();
    expect(screen.getByText('4 KB')).toBeVisible();
    expect(screen.queryByTestId('telemetry-admission-paused')).not.toBeInTheDocument();
  });
  it('shows the admission threshold state while the buffer reserves headroom', () => {
    renderWithProviders(<TelemetryStoreForm {...props} view={{ ...view, settings: { ...view.settings, provider: 'mongodb' }, sync: { ...view.sync, admissionPaused: true } }} />);
    expect(screen.getByTestId('telemetry-admission-paused')).toHaveTextContent(en.telemetryStore.pause);
  });
  it('renders an unavailable state without zero statistics', () => {
    renderWithProviders(<TelemetryUnavailable />);
    expect(screen.getByText(en.telemetryStore.unavailable)).toBeVisible();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});
