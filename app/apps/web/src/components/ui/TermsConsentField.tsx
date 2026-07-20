import { Checkbox, FormControlLabel, Link, Typography } from '@mui/material';

import { useTranslations } from '../../i18n/index.js';

interface LegalUrls {
  termsUrl: string | null;
  privacyUrl: string | null;
}

const DocumentLink = ({ href, label }: { href: string; label: string }) => (
  <Link href={href} target="_blank" rel="noreferrer">
    {label}
  </Link>
);

/**
 * Required terms/privacy acceptance for register and checkout. Renders only
 * when the tenant configured at least one document URL; native `required`
 * blocks form submission until checked.
 */
export const TermsConsentField = ({
  legal,
  checked,
  onChange,
}: {
  legal: LegalUrls;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) => {
  const t = useTranslations();
  if (legal.termsUrl === null && legal.privacyUrl === null) return null;
  return (
    <FormControlLabel
      sx={{ alignItems: 'flex-start', mr: 0 }}
      control={
        <Checkbox
          required
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          data-testid="terms-consent"
          sx={{ mt: '-0.45rem' }}
        />
      }
      label={
        <Typography variant="body2" component="span">
          {t.consent.accept}{' '}
          {legal.termsUrl !== null ? <DocumentLink href={legal.termsUrl} label={t.consent.terms} /> : null}
          {legal.termsUrl !== null && legal.privacyUrl !== null ? <> {t.consent.and} </> : null}
          {legal.privacyUrl !== null ? (
            <DocumentLink href={legal.privacyUrl} label={t.consent.privacy} />
          ) : null}
        </Typography>
      }
    />
  );
};
