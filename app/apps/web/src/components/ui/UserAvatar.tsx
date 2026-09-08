import { useState } from 'react';
import { styled } from '@mui/material/styles';

import { deterministicHue } from '../../lib/hue.js';
import { hslToHex } from '../../theme-branding.js';

export type UserAvatarSize = 'sm' | 'md' | 'lg';

const DIAMETERS: Record<UserAvatarSize, string> = {
  sm: '1.5rem',
  md: '2rem',
  lg: '2.5rem',
};

const FONT_SIZES: Record<UserAvatarSize, string> = {
  sm: '0.625rem',
  md: '0.75rem',
  lg: '0.875rem',
};

export const userInitials = (name: string): string =>
  name
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .slice(0, 2)
    .map((word) => (word[0] ?? '').toLocaleUpperCase())
    .join('');

export interface UserAvatarPalette {
  background: string;
  ink: string;
}

export const userAvatarPalette = (seed: string, scheme: 'light' | 'dark'): UserAvatarPalette => {
  const hue = deterministicHue(seed);
  return scheme === 'dark'
    ? { background: hslToHex(hue, 0.32, 0.3), ink: hslToHex(hue, 0.6, 0.9) }
    : { background: hslToHex(hue, 0.5, 0.86), ink: hslToHex(hue, 0.6, 0.22) };
};

const AvatarCircle = styled('span', {
  shouldForwardProp: (prop) => prop !== 'avatarSize' && prop !== 'seed',
})<{ avatarSize: UserAvatarSize; seed: string }>(({ theme, avatarSize, seed }) => {
  const palette = userAvatarPalette(seed, theme.palette.mode === 'dark' ? 'dark' : 'light');
  return {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    overflow: 'hidden',
    width: DIAMETERS[avatarSize],
    height: DIAMETERS[avatarSize],
    borderRadius: '999px',
    backgroundColor: palette.background,
    color: palette.ink,
    fontSize: FONT_SIZES[avatarSize],
    fontWeight: 600,
  };
});

const AvatarImage = styled('img')({
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
});

export const UserAvatar = ({ name, email, imageUrl = null, size = 'md' }: {
  name: string;
  email?: string | null;
  imageUrl?: string | null;
  size?: UserAvatarSize;
}) => {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  const source = imageUrl === null || imageUrl === '' || imageUrl === failedUrl ? null : imageUrl;
  const seed = email === null || email === undefined || email === '' ? name : email.toLowerCase();

  return (
    <AvatarCircle aria-hidden avatarSize={size} seed={seed} data-testid="user-avatar">
      {userInitials(name)}
      {source === null ? null : (
        <AvatarImage
          src={source}
          alt=""
          aria-hidden
          referrerPolicy="no-referrer"
          data-testid="user-avatar-image"
          onError={() => setFailedUrl(source)}
        />
      )}
    </AvatarCircle>
  );
};
