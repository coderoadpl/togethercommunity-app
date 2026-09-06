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
import { CopyFieldSurface, CopyFieldText, FONT_MONO } from '../../theme.js';

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
  const textRef = useRef<HTMLElement>(null);
  const inputId = useId();
  const labelId = `${inputId}-label`;
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
    if (editable) {
      inputRef.current?.select();
    } else if (textRef.current !== null) {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(textRef.current);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  };

  const copyAction = (
    <Stack direction="row" useFlexGap sx={{ gap: '0.4rem', alignItems: 'center', flexShrink: 0 }}>
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
          edge={editable ? 'end' : false}
          aria-label={t.copyField.copy}
          data-testid={testId === undefined ? undefined : `${testId}-copy`}
          onClick={() => void copy()}
          sx={editable ? undefined : { minWidth: 44, minHeight: 44 }}
        >
          <CopyGlyph />
        </IconButton>
      </Tooltip>
    </Stack>
  );

  return (
    <FormControl fullWidth>
      {label === undefined ? null : (
        <FormLabel component={editable ? 'label' : 'span'} id={labelId} htmlFor={editable ? inputId : undefined}>
          {label}
        </FormLabel>
      )}
      {editable ? (
        <OutlinedInput
          id={inputId}
          size={size}
          value={value}
          inputRef={inputRef}
          onChange={(event) => onChange?.(event.target.value)}
          inputProps={{
            'aria-describedby': hint === undefined ? undefined : hintId,
            'data-testid': testId,
            ...(mono ? { style: { fontFamily: FONT_MONO } } : {}),
          }}
          endAdornment={<InputAdornment position="end">{copyAction}</InputAdornment>}
        />
      ) : (
        <CopyFieldSurface
          direction="row"
          role="group"
          aria-labelledby={label === undefined ? undefined : labelId}
          aria-describedby={hint === undefined ? undefined : hintId}
          sx={{
            gap: '0.5rem',
            alignItems: 'center',
            pl: '0.875rem',
            pr: '0.25rem',
            py: size === 'small' ? '0.125rem' : '0.375rem',
          }}
        >
          <CopyFieldText
            ref={textRef}
            data-testid={testId}
            sx={{
              flex: 1,
              minWidth: 0,
            }}
          >
            {value}
          </CopyFieldText>
          {copyAction}
        </CopyFieldSurface>
      )}
      {hint === undefined ? null : <FormHelperText id={hintId}>{hint}</FormHelperText>}
    </FormControl>
  );
};
