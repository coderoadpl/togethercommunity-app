import { Box, Button, List, ListItem, ListItemText, Paper, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { actions } from '../../api.js';
import { useLanguage, useTranslations } from '../../i18n/index.js';
import { formatDate } from '../../lib/format.js';
import { EntryDate, StatTileButton, StatTileIcon, StatTileLabel, StatTileValue } from '../../theme.js';
import { MutationError } from './courses/feedback.js';
import {
  COURSES_ICON_PATH,
  MEMBERS_ICON_PATH,
  PRODUCTS_ICON_PATH,
  SALES_ICON_PATH,
} from './panel-icons.js';

const RECENT_MEMBERS_LIMIT = 5;

const DashboardTile = ({
  iconPath,
  label,
  value,
  detail,
  to,
  testId,
}: {
  iconPath: string;
  label: string;
  value: number;
  detail?: string | undefined;
  to: string;
  testId: string;
}) => {
  const t = useTranslations();
  const navigate = useNavigate();

  return (
    <StatTileButton
      data-testid={testId}
      aria-label={t.dashboard.openSection({ section: label })}
      onClick={() => void navigate({ to })}
    >
      <StatTileIcon aria-hidden viewBox="0 0 24 24">
        <path d={iconPath} />
      </StatTileIcon>
      <Box sx={{ display: 'grid' }}>
        <StatTileValue component="span">{value}</StatTileValue>
        <StatTileLabel component="span">{label}</StatTileLabel>
        {detail === undefined ? null : <Typography variant="caption">{detail}</Typography>}
      </Box>
    </StatTileButton>
  );
};

export const DashboardPanel = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const navigate = useNavigate();
  const products = useQuery(actions.products);
  const courses = useQuery(actions.courses);
  const members = useQuery(actions.members);

  if (products.isPending || courses.isPending || members.isPending) {
    return <Typography variant="body1">{t.dashboard.loading}</Typography>;
  }
  if (products.isError) return <MutationError error={products.error} />;
  if (courses.isError) return <MutationError error={courses.error} />;
  if (members.isError) return <MutationError error={members.error} />;

  const published = products.data.products.filter((product) => product.published).length;
  const draft = products.data.products.length - published;
  const activeGrants = members.data.members.reduce(
    (sum, member) => sum + member.activeProductIds.length,
    0,
  );
  const recentMembers = members.data.members
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, RECENT_MEMBERS_LIMIT);

  return (
    <Stack useFlexGap spacing="1.5rem">
      <Typography variant="h2" component="h2">
        {t.dashboard.heading}
      </Typography>

      <Box
        data-testid="dashboard-tiles"
        sx={{
          display: 'grid',
          gap: '0.9rem',
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(4, 1fr)' },
        }}
      >
        <DashboardTile
          iconPath={PRODUCTS_ICON_PATH}
          label={t.sections.products}
          value={products.data.products.length}
          detail={t.dashboard.publishedDraft({ published, draft })}
          to="/panel/products"
          testId="dashboard-tile-products"
        />
        <DashboardTile
          iconPath={COURSES_ICON_PATH}
          label={t.sections.courses}
          value={courses.data.courses.length}
          to="/panel/courses"
          testId="dashboard-tile-courses"
        />
        <DashboardTile
          iconPath={MEMBERS_ICON_PATH}
          label={t.sections.members}
          value={members.data.members.length}
          to="/panel/members"
          testId="dashboard-tile-members"
        />
        <DashboardTile
          iconPath={SALES_ICON_PATH}
          label={t.dashboard.activeGrants}
          value={activeGrants}
          to="/panel/members"
          testId="dashboard-tile-grants"
        />
      </Box>

      <Paper elevation={1} sx={{ p: '1.25rem' }} data-testid="dashboard-recent-members">
        <Stack
          direction="row"
          useFlexGap
          sx={{ flexWrap: 'wrap', alignItems: 'baseline', columnGap: '1rem', rowGap: '0.5rem' }}
        >
          <Typography variant="h2" component="h3">
            {t.dashboard.recentMembers}
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Button variant="text" onClick={() => void navigate({ to: '/panel/members' })}>
            {t.dashboard.viewAllMembers}
          </Button>
        </Stack>
        {recentMembers.length === 0 ? (
          <Typography variant="body1" sx={{ mt: '0.75rem' }}>
            {t.members.empty}
          </Typography>
        ) : (
          <List disablePadding>
            {recentMembers.map((member) => (
              <ListItem
                key={member.id}
                data-testid="dashboard-member-row"
                disableGutters
                secondaryAction={
                  <Button
                    size="small"
                    variant="text"
                    onClick={() =>
                      void navigate({ to: '/panel/members/$memberId', params: { memberId: member.id } })
                    }
                  >
                    {t.members.manage}
                  </Button>
                }
              >
                <ListItemText
                  primary={member.displayName ?? member.email}
                  slotProps={{ secondary: { component: 'div' } }}
                  secondary={
                    <Box sx={{ display: 'grid', gap: '0.1rem' }}>
                      {member.displayName === null ? null : <span>{member.email}</span>}
                      <EntryDate component="time" dateTime={member.createdAt}>
                        {formatDate(member.createdAt, language)}
                      </EntryDate>
                    </Box>
                  }
                />
              </ListItem>
            ))}
          </List>
        )}
      </Paper>
    </Stack>
  );
};
