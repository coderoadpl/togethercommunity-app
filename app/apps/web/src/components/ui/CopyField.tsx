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

export const COPIED_FEEDBACK_MS = 2_000;

export const CopyGlyph = () => (
  <SvgIcon fontSize="small" aria-hidden viewBox="0 0 24 24">
    <path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z" />
  </SvgIcon>
);

export const selectCopyTarget = (target: HTMLInputElement | HTMLTextAreaElement | HTMLElement | null) => {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    target.select();
    return;
  }
  if (target === null) return;
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(target);
  selection?.removeAllRanges();
  selection?.addRange(range);
};

export const CopyButton = ({
  value,
  label,
  testId,
  edge = false,
  minTouchTarget = false,
  selectFallback,
  manualFallback = false,
}: {
  value: string;
  label: string;
  testId?: string | undefined;
  edge?: false | 'end';
  minTouchTarget?: boolean;
  selectFallback?: () => void;
  manualFallback?: boolean;
}) => {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);
  const [manualVisible, setManualVisible] = useState(false);
  const manualRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (manualVisible) selectCopyTarget(manualRef.current);
  }, [manualVisible]);

  const copy = async () => {
    if (await copyText(value)) {
      setCopied(true);
      return;
    }
    if (selectFallback !== undefined) {
      selectFallback();
      return;
    }
    if (manualFallback) {
      if (manualVisible) selectCopyTarget(manualRef.current);
      else setManualVisible(true);
    }
  };

  return (
    <Stack direction="row" useFlexGap sx={{ gap: '0.4rem', alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
      {manualFallback && manualVisible ? (
        <CopyFieldText
          ref={manualRef}
          data-testid={testId === undefined ? undefined : `${testId}-manual-value`}
          sx={{ flex: '1 1 12rem', minWidth: 0 }}
        >
          {value}
        </CopyFieldText>
      ) : null}
      <Typography
        variant="caption"
        role="status"
        data-testid={testId === undefined ? undefined : `${testId}-copied`}
      >
        {copied ? t.copyField.copied : ''}
      </Typography>
      <Tooltip title={label}>
        <IconButton
          type="button"
          size="small"
          edge={edge}
          aria-label={label}
          data-testid={testId === undefined ? undefined : `${testId}-copy`}
          onClick={() => void copy()}
          sx={minTouchTarget ? { minWidth: 44, minHeight: 44 } : undefined}
        >
          <CopyGlyph />
        </IconButton>
      </Tooltip>
    </Stack>
  );
};

export const CopyField = ({
  value,
  label,
  hint,
  editable = false,
  onChange,
  mono = false,
  multiline = false,
  size = 'medium',
  testId,
}: {
  value: string;
  label?: string;
  hint?: string;
  editable?: boolean;
  onChange?: (next: string) => void;
  mono?: boolean;
  multiline?: boolean;
  size?: 'small' | 'medium';
  testId?: string;
}) => {
  const t = useTranslations();
  const inputRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLElement>(null);
  const inputId = useId();
  const labelId = `${inputId}-label`;
  const hintId = `${inputId}-hint`;

  const copyAction = (
    <CopyButton
      value={value}
      label={t.copyField.copy}
      testId={testId}
      edge={editable ? 'end' : false}
      minTouchTarget={!editable}
      selectFallback={() => selectCopyTarget(editable ? inputRef.current : textRef.current)}
    />
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
          multiline={multiline}
          minRows={multiline ? 8 : undefined}
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
            alignItems: multiline ? 'flex-start' : 'center',
            pl: '0.875rem',
            pr: '0.25rem',
            py: size === 'small' ? '0.125rem' : '0.375rem',
          }}
        >
          <CopyFieldText
            ref={textRef}
            data-testid={testId}
            style={multiline ? { whiteSpace: 'pre-wrap' } : undefined}
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
