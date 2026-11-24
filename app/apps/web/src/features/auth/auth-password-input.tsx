import { useState } from 'react';
import { IconButton, InputAdornment, type OutlinedInputProps } from '@mui/material';
import { styled } from '@mui/material/styles';

import { useTranslations } from '../../i18n/index.js';
import { AuthInput } from './auth-chrome.js';
import { HidePasswordIcon, ShowPasswordIcon } from './auth-icons.js';

type AuthPasswordInputProps = Omit<OutlinedInputProps, 'type' | 'endAdornment'> & { id: string };

const RevealButton = styled(IconButton)({ width: 44, height: 44 });

export const AuthPasswordInput = ({ id, ...inputProps }: AuthPasswordInputProps) => {
  const t = useTranslations();
  const [revealed, setRevealed] = useState(false);
  return (
    <AuthInput
      {...inputProps}
      id={id}
      type={revealed ? 'text' : 'password'}
      endAdornment={
        <InputAdornment position="end">
          <RevealButton
            type="button"
            edge="end"
            aria-label={t.auth.showPassword}
            aria-pressed={revealed}
            aria-controls={id}
            onClick={() => setRevealed((current) => !current)}
            data-testid={`${id}-reveal`}
          >
            {revealed ? <HidePasswordIcon /> : <ShowPasswordIcon />}
          </RevealButton>
        </InputAdornment>
      }
    />
  );
};
