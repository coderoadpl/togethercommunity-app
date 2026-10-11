import { z } from 'zod';

export const CHECKOUT_FONTS = [
  'be_vietnam_pro', 'bitter', 'chakra_petch', 'default', 'hahmlet', 'inconsolata',
  'inter', 'lato', 'lora', 'm_plus_1_code', 'montserrat', 'noto_sans', 'noto_sans_jp',
  'noto_serif', 'nunito', 'open_sans', 'pridi', 'pt_sans', 'pt_serif', 'raleway',
  'roboto', 'roboto_slab', 'source_sans_pro', 'titillium_web', 'ubuntu_mono', 'zen_maru_gothic',
] as const;

export const CHECKOUT_CORNERS = ['pill', 'rounded', 'rectangular'] as const;
const imageUrlSchema = z.string().trim().url().regex(/^https:\/\//iu);
const colourSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const clearable = <T extends z.ZodType>(schema: T) => schema.or(z.literal('')).nullable()
  .transform((value) => value === '' ? null : value).optional();

export const checkoutAppearanceSchema = z.object({
  displayName: clearable(z.string().trim().min(1).max(100)),
  logoUrl: clearable(imageUrlSchema),
  iconUrl: clearable(imageUrlSchema),
  backgroundColor: clearable(colourSchema),
  buttonColor: clearable(colourSchema),
  fontFamily: clearable(z.enum(CHECKOUT_FONTS)),
  borderStyle: clearable(z.enum(CHECKOUT_CORNERS)),
});

export type CheckoutAppearance = z.output<typeof checkoutAppearanceSchema>;
export type CheckoutBranding = {
  [Key in keyof CheckoutAppearance]?: Exclude<CheckoutAppearance[Key], null | undefined>;
};

const httpsAsset = (value: string | null | undefined, baseUrl: string): string | undefined => {
  if (!value) return undefined;
  const resolved = new URL(value, baseUrl).toString();
  return imageUrlSchema.safeParse(resolved).success ? resolved : undefined;
};

export const resolveCheckoutBranding = (
  settings: {
    checkoutAppearance?: CheckoutAppearance | null | undefined;
    name: string;
    logoUrl: string | null;
    accentColor: string | null;
    faviconUrl: string | null;
  },
  baseUrl: string,
): CheckoutBranding | undefined => {
  const appearance = settings.checkoutAppearance;
  const displayName = appearance?.displayName || settings.name;
  const logoUrl = httpsAsset(appearance?.logoUrl || settings.logoUrl, baseUrl);
  const iconUrl = httpsAsset(appearance?.iconUrl || settings.faviconUrl, baseUrl);
  const buttonColor = appearance?.buttonColor || settings.accentColor;
  const values: CheckoutBranding = {
    ...(displayName ? { displayName } : {}),
    ...(logoUrl ? { logoUrl } : {}),
    ...(iconUrl ? { iconUrl } : {}),
    ...(appearance?.backgroundColor ? { backgroundColor: appearance.backgroundColor } : {}),
    ...(buttonColor ? { buttonColor } : {}),
    ...(appearance?.fontFamily ? { fontFamily: appearance.fontFamily } : {}),
    ...(appearance?.borderStyle ? { borderStyle: appearance.borderStyle } : {}),
  };
  return Object.keys(values).length === 0 ? undefined : values;
};
