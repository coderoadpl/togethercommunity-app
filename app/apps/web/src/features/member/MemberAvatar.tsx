import { useEffect, useState } from 'react';
import { styled } from '@mui/material/styles';

export type MemberAvatarSize = 'sm' | 'md' | 'lg';

const DIAMETERS: Record<MemberAvatarSize, string> = {
  sm: '1.5rem',
  md: '2rem',
  lg: '2.5rem',
};

const FONT_SIZES: Record<MemberAvatarSize, string> = {
  sm: '0.625rem',
  md: '0.75rem',
  lg: '0.875rem',
};

export const memberInitials = (name: string): string =>
  name
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .slice(0, 2)
    .map((word) => (word[0] ?? '').toLocaleUpperCase())
    .join('');

const AvatarCircle = styled('span', {
  shouldForwardProp: (prop) => prop !== 'avatarSize',
})<{ avatarSize: MemberAvatarSize }>(({ theme, avatarSize }) => ({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  overflow: 'hidden',
  width: DIAMETERS[avatarSize],
  height: DIAMETERS[avatarSize],
  borderRadius: '999px',
  backgroundColor: theme.palette.action.selected,
  color: theme.palette.text.primary,
  fontSize: FONT_SIZES[avatarSize],
  fontWeight: 600,
}));

const AvatarImage = styled('img')({
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
});

export const MemberAvatar = ({ name, avatarUrl = null, size = 'md' }: {
  name: string;
  avatarUrl?: string | null;
  size?: MemberAvatarSize;
}) => {
  const [status, setStatus] = useState<'pending' | 'loaded' | 'failed'>('pending');

  useEffect(() => setStatus('pending'), [avatarUrl]);

  const source = avatarUrl !== null && avatarUrl !== '' && status !== 'failed' ? avatarUrl : null;

  return (
    <AvatarCircle aria-hidden avatarSize={size} data-testid="member-avatar">
      {status === 'loaded' && source !== null ? null : memberInitials(name)}
      {source === null ? null : (
        <AvatarImage
          src={source}
          alt=""
          aria-hidden
          loading="lazy"
          referrerPolicy="no-referrer"
          data-testid="member-avatar-image"
          sx={{ display: status === 'loaded' ? 'block' : 'none' }}
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('failed')}
        />
      )}
    </AvatarCircle>
  );
};
