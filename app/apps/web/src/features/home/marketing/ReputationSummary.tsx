import { Alert, Box, Chip, Stack, Typography } from '@mui/material';

import type { EmailReputation, EmailReputationMetric, EmailReputationStatus } from '#core/domain/index.js';

import { useLanguage, useTranslations } from '../../../i18n/index.js';
import { StatTile, StatTileLabel, StatTileValue } from '../../../theme.js';

const chipColor = (status: EmailReputationStatus): 'default' | 'success' | 'warning' | 'error' => {
  if (status === 'ok') return 'success';
  if (status === 'warn') return 'warning';
  if (status === 'critical') return 'error';
  return 'default';
};

const metricValue = (metric: EmailReputationMetric, language: string, insufficientData: string): string =>
  metric.rate === null
    ? insufficientData
    : new Intl.NumberFormat(language, {
      style: 'percent',
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
    }).format(metric.rate);

export const ReputationSummary = ({ reputation }: { reputation: EmailReputation }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const items = [
    {
      label: t.marketing.hardBounceRate,
      explanation: t.marketing.hardBounceExplanation,
      metric: reputation.hardBounce,
    },
    {
      label: t.marketing.complaintRate,
      explanation: t.marketing.complaintExplanation,
      metric: reputation.complaint,
    },
  ];
  const message = reputation.overallStatus === 'critical'
    ? t.marketing.reputationCriticalMessage
    : reputation.overallStatus === 'warn'
      ? t.marketing.reputationWarnMessage
      : reputation.overallStatus === 'ok'
        ? t.marketing.reputationOkMessage
        : t.marketing.reputationInsufficientMessage;
  const severity = reputation.overallStatus === 'critical'
    ? 'error'
    : reputation.overallStatus === 'warn'
      ? 'warning'
      : 'info';

  return (
    <Stack useFlexGap spacing="1rem">
      <Alert severity={severity}>{message}</Alert>
      <Box sx={{ display: 'grid', gap: '0.9rem', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
        {items.map(({ label, explanation, metric }) => (
          <StatTile key={label}>
            <Stack useFlexGap spacing="0.45rem" sx={{ minWidth: 0 }}>
              <Stack direction="row" useFlexGap spacing="0.5rem" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <StatTileLabel component="p">{label}</StatTileLabel>
                <Chip
                  size="small"
                  color={chipColor(metric.status)}
                  label={t.marketing.reputationStatus[metric.status]}
                />
              </Stack>
              <StatTileValue component="p">
                {metricValue(metric, language, t.marketing.reputationTooLittleData)}
              </StatTileValue>
              <Typography variant="caption">
                {t.marketing.reputationCounts({ count: metric.count, sends: metric.sends })}
              </Typography>
              <Typography variant="body2">{explanation}</Typography>
            </Stack>
          </StatTile>
        ))}
      </Box>
      <Typography variant="body2">{t.marketing.reputationAction}</Typography>
    </Stack>
  );
};
