import { useParams } from '@tanstack/react-router';

import { CheckoutPage } from '../features/checkout/CheckoutPage.js';

export const CheckoutRoute = () => {
  const params = useParams({ strict: false });
  return <CheckoutPage productRef={params.productRef ?? ''} />;
};
