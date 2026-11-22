import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { Box, Paper, Stack, Typography } from '@mui/material';
import { Link } from '@tanstack/react-router';

import type { CourseStructureWithAccess } from '#core/domain/index.js';

import { Cover } from '../../components/ui/Cover.js';
import { useLanguage, useTranslations } from '../../i18n/index.js';
import { formatOfferPrice } from '../../lib/format.js';
import { EmberCtaLink } from '../../theme.js';
import { courseTotals, formatTotalDuration } from './CourseRail.js';
import { StatClockIcon, StatLessonsIcon } from './overview-icons.js';
import { useLoginLinkWithReturn } from './use-login-redirect.js';
import { RouterTextLink } from './visitor-actions.js';

interface GuestOffer {
  purchasable: boolean;
  price: string | null;
  cta: (testId: string) => ReactNode;
}

const useGuestOffer = (course: CourseStructureWithAccess): GuestOffer => {
  const t = useTranslations();
  const { language } = useLanguage();
  const offer = course.offer;
  const product = offer?.product;
  const salesUrl = offer?.salesUrl;
  const amount = product ? formatOfferPrice(product.priceCents, product.currency, language, t.common.free) : null;
  const price = amount === null ? null : product?.interval === 'month'
    ? t.anon.monthlyPrice({ price: amount })
    : product?.interval === 'year' ? t.anon.yearlyPrice({ price: amount }) : amount;
  const cta = (testId: string) => product ? (
    <EmberCtaLink component={Link} to={`/checkout/${encodeURIComponent(product.id)}`} variant="contained" data-testid={testId} fullWidth>
      {t.anon.unlockCta}
    </EmberCtaLink>
  ) : salesUrl ? (
    <EmberCtaLink href={salesUrl} variant="contained" data-testid={testId} fullWidth>
      {t.anon.salesCta}
    </EmberCtaLink>
  ) : null;
  return { purchasable: Boolean(product) || Boolean(salesUrl), price, cta };
};

const NEW_TAB = { target: '_blank', rel: 'noopener noreferrer' } as const;

const CourseNotOnSale = ({ supportUrl }: { supportUrl: string | null }) => {
  const t = useTranslations();
  const loginLink = useLoginLinkWithReturn();
  const external = supportUrl !== null && !supportUrl.toLowerCase().startsWith('mailto:');
  return (
    <Stack useFlexGap sx={{ rowGap: '0.75rem' }} data-testid="guest-course-not-on-sale">
      <Typography variant="body1" component="p">
        {t.anon.courseNotOnSale}
      </Typography>
      {supportUrl === null ? null : (
        <EmberCtaLink
          component="a"
          href={supportUrl}
          {...(external ? NEW_TAB : {})}
          variant="contained"
          fullWidth
          data-testid="public-course-contact"
        >
          {t.anon.contactCreator}
        </EmberCtaLink>
      )}
      <RouterTextLink
        {...loginLink}
        sx={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', minHeight: 44 }}
        data-testid="public-course-sign-in"
      >
        {t.anon.courseHaveAccessSignIn}
      </RouterTextLink>
    </Stack>
  );
};

const useScrolledPast = (node: HTMLElement | null): boolean => {
  const [scrolledPast, setScrolledPast] = useState(false);
  useEffect(() => {
    if (node === null || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        setScrolledPast(!entry.isIntersecting && entry.boundingClientRect.top < 0);
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return scrolledPast;
};

const useReservedScrollPadding = (node: HTMLElement | null, active: boolean) => {
  useLayoutEffect(() => {
    if (!active || node === null) return;
    const root = document.documentElement;
    const previous = root.style.scrollPaddingBottom;
    const reserve = () => {
      root.style.scrollPaddingBottom = `${node.offsetHeight}px`;
    };
    reserve();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reserve);
    observer?.observe(node);
    return () => {
      observer?.disconnect();
      root.style.scrollPaddingBottom = previous;
    };
  }, [active, node]);
};

const CourseFacts = ({ course }: { course: CourseStructureWithAccess }) => {
  const t = useTranslations();
  const totals = courseTotals(course);
  return (
    <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', columnGap: '1.25rem', rowGap: '0.5rem' }} data-testid="guest-course-facts">
      <Stack direction="row" useFlexGap sx={{ alignItems: 'center', gap: '0.5rem' }} data-testid="guest-course-lessons">
        <StatLessonsIcon />
        <Typography variant="body2" component="span">
          {`${totals.total} ${t.courseOverview.statLessons({ count: totals.total })}`}
        </Typography>
      </Stack>
      {totals.totalMinutes > 0 ? (
        <Stack direction="row" useFlexGap sx={{ alignItems: 'center', gap: '0.5rem' }} data-testid="guest-course-duration">
          <StatClockIcon />
          <Typography variant="body2" component="span">
            {formatTotalDuration(t, totals.totalMinutes)}
          </Typography>
        </Stack>
      ) : null}
    </Stack>
  );
};

export const GuestCourseOffer = ({ course }: { course: CourseStructureWithAccess }) => {
  const t = useTranslations();
  const { purchasable, price, cta } = useGuestOffer(course);
  const [cardCta, setCardCta] = useState<HTMLElement | null>(null);
  const [bar, setBar] = useState<HTMLElement | null>(null);
  const barShown = useScrolledPast(cardCta);
  useReservedScrollPadding(bar, barShown);
  const cardButton = cta('public-course-unlock-cta');
  const barButton = cta('public-course-unlock-cta-mobile');

  return (
    <>
      <Paper variant="outlined" sx={{ overflow: 'hidden' }} data-testid="guest-course-offer">
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1fr)' } }}>
          <Cover src={course.offer?.imageUrl ?? null} title={course.name} alt={t.courseOverview.coverAlt({ name: course.name })}
            frame="standalone" testId="course-cover" fallbackTestId="course-cover-fallback" />
          <Stack spacing="1rem" sx={{ p: '1.25rem', minWidth: 0, justifyContent: 'center' }}>
            {price ? <Typography variant="h2" component="p" data-testid="guest-course-price">{price}</Typography> : null}
            <CourseFacts course={course} />
            {purchasable
              ? <Box ref={setCardCta}>{cardButton}</Box>
              : <CourseNotOnSale supportUrl={course.offer?.supportUrl ?? null} />}
          </Stack>
        </Box>
      </Paper>
      {purchasable ? (
        <Paper
          ref={setBar}
          square
          elevation={3}
          data-testid="guest-course-sticky-offer"
          data-shown={barShown}
          aria-hidden={barShown ? undefined : true}
          inert={!barShown}
          sx={{
            display: { xs: 'flex', md: 'none' }, position: 'fixed', bottom: 0, left: 0, right: 0,
            zIndex: (theme) => theme.zIndex.appBar, alignItems: 'center', gap: '1rem',
            p: '0.75rem', pb: 'calc(0.75rem + env(safe-area-inset-bottom))',
            transform: barShown ? 'none' : 'translateY(100%)',
            visibility: barShown ? 'visible' : 'hidden',
            transition: 'transform 0.2s ease, visibility 0.2s',
            '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
          }}
        >
          {price ? <Typography variant="body2" sx={{ flexShrink: 0 }}>{price}</Typography> : null}
          {barButton}
        </Paper>
      ) : null}
    </>
  );
};

export const GuestCourseOfferRepeat = ({ course }: { course: CourseStructureWithAccess }) => {
  const { purchasable, price, cta } = useGuestOffer(course);
  if (!purchasable) return null;
  const button = cta('public-course-unlock-cta-repeat');
  return (
    <Paper
      variant="outlined"
      data-testid="guest-course-offer-repeat"
      sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: '1.5rem', p: '1.25rem' }}
    >
      {price ? <Typography variant="h3" component="p">{price}</Typography> : null}
      <Box sx={{ ml: 'auto', minWidth: '14rem' }}>{button}</Box>
    </Paper>
  );
};
