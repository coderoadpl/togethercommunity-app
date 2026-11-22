import type { ReactNode } from 'react';
import { Box, Typography } from '@mui/material';
import { Link } from '@tanstack/react-router';

import type { PublicOfferOutput } from '#core/contract/index.js';

import { useLanguage, useTranslations } from '../../i18n/index.js';
import { formatOfferPriceTerms, formatPrice, type OfferPriceTerms } from '../../lib/format.js';
import { CourseCardRoot, DataValue, EmberCtaLink } from '../../theme.js';
import { TileSection } from './StartPage.js';

type OfferProduct = PublicOfferOutput['products'][number];
type OfferSalesLink = PublicOfferOutput['salesLinks'][number];

export const offerProductPrices = (product: OfferProduct): OfferPriceTerms[] =>
  product.prices.length > 0
    ? product.prices
    : [{ kind: 'one_time', interval: null, amountCents: product.priceCents, currency: product.currency }];

export const useOfferPriceFormatter = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const labels = {
    free: t.common.free,
    oneTime: t.common.priceOneTime,
    monthly: t.common.priceMonthly,
    yearly: t.common.priceYearly,
  };
  return (price: OfferPriceTerms) => formatOfferPriceTerms(price, language, labels);
};

export const uniqueOfferProducts = (products: readonly OfferProduct[]): OfferProduct[] => {
  const seen = new Set<string>();
  return products.filter((product) => {
    if (seen.has(product.id)) return false;
    seen.add(product.id);
    return true;
  });
};

const OfferCard = ({
  testId,
  heading,
  description,
  price,
  action,
}: {
  testId: string;
  heading: string;
  description?: string | undefined;
  price: string;
  action: ReactNode;
}) => (
  <CourseCardRoot data-testid={testId}>
    <Box sx={{ p: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.6rem', flexGrow: 1 }}>
      <Typography variant="h3" component="h3" color="text.primary">
        {heading}
      </Typography>
      {description ? (
        <Typography variant="body2" color="text.secondary">
          {description}
        </Typography>
      ) : null}
      <Typography variant="body1" component="p" data-testid={`${testId}-price`}>
        <DataValue>{price}</DataValue>
      </Typography>
      <Box sx={{ mt: 'auto', pt: '0.25rem' }}>{action}</Box>
    </Box>
  </CourseCardRoot>
);

const ProductOfferCard = ({ product }: { product: OfferProduct }) => {
  const t = useTranslations();
  const formatTerms = useOfferPriceFormatter();
  const prices = offerProductPrices(product);
  const free = prices.every((price) => price.amountCents === 0);
  return (
    <OfferCard
      testId={`offer-product-${product.id}`}
      heading={product.title}
      price={prices.map(formatTerms).join(' · ')}
      action={(
        <EmberCtaLink
          component={Link}
          to={`/checkout/${encodeURIComponent(product.id)}`}
          variant="contained"
          size="small"
          data-testid={`offer-product-cta-${product.id}`}
        >
          {free ? t.checkout.freeOrderIdle : t.anon.offerBuyCta}
        </EmberCtaLink>
      )}
    />
  );
};

const SalesLinkOfferCard = ({ salesLink }: { salesLink: OfferSalesLink }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  return (
    <OfferCard
      testId={`offer-sales-link-${salesLink.id}`}
      heading={salesLink.heading}
      description={salesLink.description}
      price={formatPrice(salesLink.totalCents, salesLink.currency, language)}
      action={(
        <EmberCtaLink
          component="a"
          href={`/offer/${encodeURIComponent(salesLink.slug)}`}
          variant="contained"
          size="small"
          data-testid={`offer-sales-link-cta-${salesLink.id}`}
        >
          {t.salesLinks.buyBundle}
        </EmberCtaLink>
      )}
    />
  );
};

export const AnonOfferSection = ({
  id,
  products,
  salesLinks,
}: {
  id: string;
  products: readonly OfferProduct[];
  salesLinks: readonly OfferSalesLink[];
}) => {
  const t = useTranslations();
  return (
    <TileSection title={t.anon.offersSection} id={id} testId="anon-offer">
      {products.map((product) => (
        <ProductOfferCard key={product.id} product={product} />
      ))}
      {salesLinks.map((salesLink) => (
        <SalesLinkOfferCard key={salesLink.id} salesLink={salesLink} />
      ))}
    </TileSection>
  );
};
