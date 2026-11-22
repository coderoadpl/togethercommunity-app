import { Button, Link as MuiLink, Stack, type SxProps, type Theme } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { createLink, Link } from '@tanstack/react-router';

import { PUBLIC_OFFER_ANCHOR, type PublicOfferOutput } from '#core/contract/index.js';
import type { PublicNavigation } from '#core/domain/index.js';

import { actions } from '../../api.js';
import { useTranslations } from '../../i18n/index.js';
import { EmberCtaLink } from '../../theme.js';
import { anonHomePath } from './shell/member-nav.js';
import { offerProductPrices, uniqueOfferProducts, useOfferPriceFormatter } from './AnonOfferSection.js';
import { useLoginLinkWithReturn } from './use-login-redirect.js';

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

export type VisitorJoinTarget =
  | { kind: 'checkout'; productId: string }
  | { kind: 'offer' }
  | { kind: 'none' }
  | { kind: 'pending' };

type JoinSpace = Pick<PublicNavigation['spaces'][number], 'visibility' | 'products'>;

export const visitorJoinTarget = ({
  space,
  offer,
  lockedSpaceCount,
  settled,
}: {
  space: JoinSpace | undefined;
  offer: Pick<PublicOfferOutput, 'products' | 'salesLinks'> | undefined;
  lockedSpaceCount: number | undefined;
  settled: boolean;
}): VisitorJoinTarget => {
  const products = space?.visibility === 'product' ? space.products ?? [] : [];
  const [onlyProduct] = products;
  if (products.length === 1 && onlyProduct !== undefined) return { kind: 'checkout', productId: onlyProduct.id };
  if (!settled) return { kind: 'pending' };
  const nothingForSale =
    offer !== undefined &&
    lockedSpaceCount === 0 &&
    uniqueOfferProducts(offer.products).length === 0 &&
    offer.salesLinks.length === 0;
  return nothingForSale ? { kind: 'none' } : { kind: 'offer' };
};

export const useVisitorJoin = (spaceId: string) => {
  const navigation = useQuery(actions.publicNavigation);
  const offer = useQuery(actions.publicOffer);
  const me = useQuery(actions.me);
  const visitorNavigation = navigation.data?.navigation;
  return {
    target: visitorJoinTarget({
      space: visitorNavigation?.spaces.find((candidate) => candidate.id === spaceId),
      offer: offer.data,
      lockedSpaceCount: visitorNavigation?.lockedSpaces.length,
      settled: !navigation.isPending && !offer.isPending,
    }),
    supportUrl: offer.data?.tenant.support.url ?? null,
    signedIn: me.data?.tenantAccess === 'none',
  };
};

export const VisitorJoinButton = ({
  target,
  testId = 'anon-join-cta',
  sx,
}: {
  target: VisitorJoinTarget;
  testId?: string;
  sx?: SxProps<Theme>;
}) => {
  const t = useTranslations();
  if (target.kind === 'none' || target.kind === 'pending') return null;
  const link = target.kind === 'checkout'
    ? { to: `/checkout/${encodeURIComponent(target.productId)}` }
    : { to: anonHomePath(), hash: PUBLIC_OFFER_ANCHOR };
  return (
    <EmberCtaLink component={Link} {...link} variant="contained" data-testid={testId} sx={sx}>
      {target.kind === 'checkout' ? t.anon.unlockCta : t.anon.salesCta}
    </EmberCtaLink>
  );
};

export const VisitorContactLink = ({ supportUrl }: { supportUrl: string }) => {
  const t = useTranslations();
  const external = !supportUrl.toLowerCase().startsWith('mailto:');
  return (
    <MuiLink
      href={supportUrl}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      data-testid="anon-visitor-contact"
    >
      {t.anon.contactCreator}
    </MuiLink>
  );
};

export const VisitorContactLinks = ({
  supportUrl,
  signedIn,
}: {
  supportUrl: string | null;
  signedIn: boolean;
}) => {
  const t = useTranslations();
  const loginLink = useLoginLinkWithReturn();
  if (signedIn && supportUrl === null) return null;
  return (
    <Stack
      direction="row"
      useFlexGap
      sx={{ flexWrap: 'wrap', columnGap: '1rem', rowGap: '0.4rem', ml: 'auto' }}
      data-testid="anon-visitor-links"
    >
      {signedIn ? null : (
        <RouterTextLink {...loginLink} data-testid="anon-visitor-sign-in">
          {t.auth.signInLink}
        </RouterTextLink>
      )}
      {supportUrl === null ? null : <VisitorContactLink supportUrl={supportUrl} />}
    </Stack>
  );
};
