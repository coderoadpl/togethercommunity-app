import { Button, Link as MuiLink } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { createLink } from '@tanstack/react-router';

import { actions } from '../../api.js';
import { offerProductPrices, useOfferPriceFormatter } from './AnonOfferSection.js';

export const RouterButton = createLink(Button);

export const RouterTextLink = createLink(MuiLink);

export const usePublicOfferPrice = () => {
  const offer = useQuery(actions.publicOffer);
  const formatTerms = useOfferPriceFormatter();
  return (productId: string | undefined): string | null => {
    const product = offer.data?.products.find((candidate) => candidate.id === productId);
    const lead = product === undefined ? undefined : offerProductPrices(product)[0];
    return lead === undefined ? null : formatTerms(lead);
  };
};
