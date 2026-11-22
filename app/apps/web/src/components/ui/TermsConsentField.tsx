import type { Ref } from 'react';
import { Checkbox, FormControlLabel, FormHelperText, Link, Typography } from '@mui/material';

import { useTranslations } from '../../i18n/index.js';

interface LegalUrls {
  termsUrl: string | null;
  privacyUrl: string | null;
}

const CONSENT_ERROR_ID = 'terms-consent-error';

const DocumentLink = ({ href, label }: { href: string; label: string }) => (
  <Link href={href} target="_blank" rel="noreferrer">
    {label}
  </Link>
);

/**
 * Required terms/privacy acceptance for register and checkout. Renders only
 * when the tenant configured at least one document URL; native `required`
 * blocks form submission until checked, and a `noValidate` form passes
 * `error` instead.
 */
export const TermsConsentField = ({
  legal,
  checked,
  onChange,
  error = null,
  inputRef,
}: {
  legal: LegalUrls;
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string | null;
  inputRef?: Ref<HTMLInputElement>;
}) => {
  const t = useTranslations();
  if (legal.termsUrl === null && legal.privacyUrl === null) return null;
  const field = (
    <FormControlLabel
      sx={{ alignItems: 'flex-start', minHeight: 44, mr: 0 }}
      control={
        <Checkbox
          required
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          data-testid="terms-consent"
          slotProps={{
            input: {
              ref: inputRef,
              ...(error === null ? {} : { 'aria-invalid': true, 'aria-describedby': CONSENT_ERROR_ID }),
            },
          }}
          sx={{ mt: '-0.75rem', minHeight: 44, minWidth: 44 }}
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
  return (
    <>
      {field}
      {error === null ? null : <FormHelperText error id={CONSENT_ERROR_ID}>{error}</FormHelperText>}
    </>
  );
};
