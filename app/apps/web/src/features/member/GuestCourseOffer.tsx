import { Box, Link as MuiLink, Paper, Stack, Typography } from '@mui/material';
import { Link } from '@tanstack/react-router';

import type { CourseStructureWithAccess } from '#core/domain/index.js';

import { Cover } from '../../components/ui/Cover.js';
import { useLanguage, useTranslations } from '../../i18n/index.js';
import { formatOfferPrice } from '../../lib/format.js';
import { EmberCtaLink } from '../../theme.js';

export const GuestCourseOffer = ({ course }: { course: CourseStructureWithAccess }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const offer = course.offer;
  const product = offer?.product;
  const salesUrl = offer?.salesUrl;
  const href = product ? `/checkout/${encodeURIComponent(product.id)}` : salesUrl || '/login';
  const label = product ? t.anon.unlockCta : salesUrl ? t.anon.salesCta : t.auth.signInLink;
  const amount = product ? formatOfferPrice(product.priceCents, product.currency, language, t.common.free) : null;
  const price = amount === null ? null : product?.interval === 'month'
    ? t.anon.monthlyPrice({ price: amount })
    : product?.interval === 'year' ? t.anon.yearlyPrice({ price: amount }) : amount;
  const cta = (testId: string) => product || !salesUrl ? (
    <EmberCtaLink component={Link} to={href} variant="contained" data-testid={testId} fullWidth>
      {label}
    </EmberCtaLink>
  ) : (
    <EmberCtaLink href={href} variant="contained" data-testid={testId} fullWidth>
      {label}
    </EmberCtaLink>
  );

  const desktopCta = cta('public-course-unlock-cta');
  const mobileCta = cta('public-course-unlock-cta-mobile');

  return (
    <>
      <Paper variant="outlined" sx={{ overflow: 'hidden' }} data-testid="guest-course-offer">
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1fr)' } }}>
          <Cover src={offer?.imageUrl ?? null} title={course.name} alt={t.courseOverview.coverAlt({ name: course.name })}
            frame="standalone" testId="course-cover" fallbackTestId="course-cover-fallback" />
          <Stack spacing="1rem" sx={{ p: '1.25rem', minWidth: 0, justifyContent: 'center' }}>
            <Typography component="h2" variant="h3" sx={{ textWrap: 'balance' }}>{course.name}</Typography>
            {offer?.description ? <Typography noWrap title={offer.description} color="text.secondary">{offer.description}</Typography> : null}
            {price ? <Typography variant="h3" component="p" data-testid="guest-course-price">{price}</Typography> : null}
            {desktopCta}
            {!product && !salesUrl && offer?.supportUrl ? (
              <MuiLink href={offer.supportUrl} sx={{ alignSelf: 'center', display: 'inline-flex', alignItems: 'center', minHeight: 44, px: '0.75rem', py: '0.5rem' }}>{t.anon.contactCreator}</MuiLink>
            ) : null}
          </Stack>
        </Box>
      </Paper>
      <Paper square elevation={3} data-testid="guest-course-sticky-offer" sx={{
        display: { xs: 'flex', md: 'none' }, position: 'fixed', bottom: 0, left: 0, right: 0,
        zIndex: (theme) => theme.zIndex.appBar, alignItems: 'center', gap: '1rem',
        p: '0.75rem', pb: 'calc(0.75rem + env(safe-area-inset-bottom))',
      }}>
        {price ? <Typography variant="body2" sx={{ flexShrink: 0 }}>{price}</Typography> : null}
        {mobileCta}
      </Paper>
    </>
  );
};
