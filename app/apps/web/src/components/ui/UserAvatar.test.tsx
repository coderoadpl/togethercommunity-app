import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { contrastRatio } from '../../theme-branding.js';
import { UserAvatar, userAvatarPalette, userInitials } from './UserAvatar.js';

const AA_MIN = 4.5;

describe('userInitials', () => {
  it('takes the first letter of the first two words', () => {
    expect(userInitials('Ada Lovelace Byron')).toBe('AL');
  });

  it('ignores extra whitespace and uppercases the result', () => {
    expect(userInitials('  ada   lovelace ')).toBe('AL');
  });

  it('returns an empty string for a blank name', () => {
    expect(userInitials('   ')).toBe('');
  });
});

describe('userAvatarPalette', () => {
  it('gives the same seed the same colours and different seeds different ones', () => {
    expect(userAvatarPalette('ada@together.dev', 'light')).toEqual(
      userAvatarPalette('ada@together.dev', 'light'),
    );
    expect(userAvatarPalette('ada@together.dev', 'light')).not.toEqual(
      userAvatarPalette('grace@together.dev', 'light'),
    );
  });

  it('reads the initials at AA in both schemes for every hue a seed can produce', () => {
    for (const scheme of ['light', 'dark'] as const) {
      for (let code = 0; code < 360; code += 1) {
        const { background, ink } = userAvatarPalette(String.fromCodePoint(65 + code), scheme);
        expect([scheme, code, contrastRatio(ink, background) >= AA_MIN]).toEqual([
          scheme,
          code,
          true,
        ]);
      }
    }
  });
});

describe('UserAvatar', () => {
  it('renders initials only when no image url is given', () => {
    render(<UserAvatar name="Ada Lovelace" email="ada@together.dev" />);

    expect(screen.getByTestId('user-avatar')).toHaveTextContent('AL');
    expect(screen.queryByTestId('user-avatar-image')).toBeNull();
  });

  it('tints the initials from the e-mail rather than the display name', () => {
    const { rerender } = render(<UserAvatar name="Ada Lovelace" email="ada@together.dev" />);
    const first = getComputedStyle(screen.getByTestId('user-avatar')).backgroundColor;

    rerender(<UserAvatar name="Grace Hopper" email="ada@together.dev" />);

    expect(getComputedStyle(screen.getByTestId('user-avatar')).backgroundColor).toBe(first);
  });

  it('renders the image visibly and eagerly as soon as a url is given', () => {
    render(
      <UserAvatar
        name="Ada Lovelace"
        email="ada@together.dev"
        imageUrl="/api/public/assets/avatar/avatar.webp"
      />,
    );

    const image = screen.getByTestId('user-avatar-image');
    expect(image).toBeVisible();
    expect(getComputedStyle(image).display).not.toBe('none');
    expect(image).not.toHaveAttribute('loading');
    expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(image).toHaveAttribute('alt', '');
    expect(screen.getByTestId('user-avatar')).toHaveTextContent('AL');
  });

  it('drops the image and falls back to initials when the load fails', () => {
    render(
      <UserAvatar
        name="Ada Lovelace"
        imageUrl="/api/public/assets/avatar/avatar.webp"
      />,
    );

    fireEvent.error(screen.getByTestId('user-avatar-image'));

    expect(screen.queryByTestId('user-avatar-image')).toBeNull();
    expect(screen.getByTestId('user-avatar')).toHaveTextContent('AL');
  });

  it('retries loading when the image url changes', () => {
    const { rerender } = render(
      <UserAvatar name="Ada Lovelace" imageUrl="https://cdn.test/first.png" />,
    );

    fireEvent.error(screen.getByTestId('user-avatar-image'));
    expect(screen.queryByTestId('user-avatar-image')).toBeNull();

    rerender(<UserAvatar name="Ada Lovelace" imageUrl="https://cdn.test/second.png" />);

    expect(screen.getByTestId('user-avatar-image')).toHaveAttribute(
      'src',
      'https://cdn.test/second.png',
    );
  });
});
