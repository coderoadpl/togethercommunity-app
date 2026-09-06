import { useEffect, useId, useRef, useState } from 'react';
import {
  FormControl,
  FormHelperText,
  FormLabel,
  IconButton,
  InputAdornment,
  OutlinedInput,
  Stack,
  SvgIcon,
  Tooltip,
  Typography,
} from '@mui/material';

import { useTranslations } from '../../i18n/index.js';
import { copyText } from '../../lib/clipboard.js';
import { FONT_MONO } from '../../theme.js';

const COPIED_FEEDBACK_MS = 2_000;

const CopyGlyph = () => (
  <SvgIcon fontSize="small" aria-hidden viewBox="0 0 24 24">
    <path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z" />
  </SvgIcon>
);

export const CopyField = ({
  value,
  label,
  hint,
  editable = false,
  onChange,
  mono = false,
  size = 'medium',
  testId,
}: {
  value: string;
  label?: string;
  hint?: string;
  editable?: boolean;
  onChange?: (next: string) => void;
  mono?: boolean;
  size?: 'small' | 'medium';
  testId?: string;
}) => {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const hintId = `${inputId}-hint`;

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    if (await copyText(value)) {
      setCopied(true);
      return;
    }
    inputRef.current?.select();
  };

  return (
    <FormControl fullWidth>
      {label === undefined ? null : <FormLabel htmlFor={inputId}>{label}</FormLabel>}
      <OutlinedInput
        id={inputId}
        size={size}
        value={value}
        readOnly={!editable}
        inputRef={inputRef}
        onChange={(event) => onChange?.(event.target.value)}
        onFocus={editable ? undefined : (event) => event.currentTarget.select()}
        inputProps={{
          'aria-describedby': hint === undefined ? undefined : hintId,
          'data-testid': testId,
          ...(mono ? { style: { fontFamily: FONT_MONO } } : {}),
        }}
        endAdornment={(
          <InputAdornment position="end">
            <Stack direction="row" useFlexGap sx={{ gap: '0.4rem', alignItems: 'center' }}>
              <Typography
                variant="caption"
                role="status"
                data-testid={testId === undefined ? undefined : `${testId}-copied`}
              >
                {copied ? t.copyField.copied : ''}
              </Typography>
              <Tooltip title={t.copyField.copy}>
                <IconButton
                  type="button"
                  size="small"
                  edge="end"
                  aria-label={t.copyField.copy}
                  data-testid={testId === undefined ? undefined : `${testId}-copy`}
                  onClick={() => void copy()}
                >
                  <CopyGlyph />
                </IconButton>
              </Tooltip>
            </Stack>
          </InputAdornment>
        )}
      />
      {hint === undefined ? null : <FormHelperText id={hintId}>{hint}</FormHelperText>}
    </FormControl>
  );
};
