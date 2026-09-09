import { FormControl, FormHelperText, FormLabel, OutlinedInput } from '@mui/material';

import { useTranslations } from '../../../i18n/index.js';

export const CampaignTextSection = ({ bodyText, replyTo, disabled, onBodyTextChange, onReplyToChange }: {
  bodyText: string;
  replyTo: string;
  disabled: boolean;
  onBodyTextChange(value: string): void;
  onReplyToChange(value: string): void;
}) => {
  const t = useTranslations();
  return <>
    <FormControl fullWidth>
      <FormLabel htmlFor="marketing-campaign-text">{t.marketing.bodyTextLabel}</FormLabel>
      <OutlinedInput id="marketing-campaign-text" value={bodyText} onChange={(event) => onBodyTextChange(event.target.value)} disabled={disabled} multiline minRows={6} />
      <FormHelperText>{t.marketing.bodyTextHint}</FormHelperText>
    </FormControl>
    <FormControl fullWidth>
      <FormLabel htmlFor="marketing-campaign-reply-to">{t.marketing.replyToLabel}</FormLabel>
      <OutlinedInput id="marketing-campaign-reply-to" type="email" value={replyTo} onChange={(event) => onReplyToChange(event.target.value)} disabled={disabled} />
      <FormHelperText>{t.marketing.replyToHint}</FormHelperText>
    </FormControl>
  </>;
};
