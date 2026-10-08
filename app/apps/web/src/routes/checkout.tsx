import { useParams } from '@tanstack/react-router';

import { CheckoutPage } from '../features/checkout/CheckoutPage.js';

export const CheckoutRoute = () => {
  const params = useParams({ strict: false });
  return <CheckoutPage productRef={params.productRef ?? ''} />;
};

export const SalesLinkOfferRoute = () => {
  const params = useParams({ strict: false });
  return <CheckoutPage productRef="" salesLinkSlug={params.slug ?? ''} />;
};
