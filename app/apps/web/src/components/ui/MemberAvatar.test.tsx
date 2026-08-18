import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MemberAvatar, memberInitials } from './MemberAvatar.js';

describe('memberInitials', () => {
  it('takes the first letter of the first two words', () => {
    expect(memberInitials('Ada Lovelace Byron')).toBe('AL');
  });

  it('ignores extra whitespace and uppercases the result', () => {
    expect(memberInitials('  ada   lovelace ')).toBe('AL');
  });

  it('returns an empty string for a blank name', () => {
    expect(memberInitials('   ')).toBe('');
  });
});

describe('MemberAvatar', () => {
  it('renders initials only when no avatar url is given', () => {
    render(<MemberAvatar name="Ada Lovelace" />);

    expect(screen.getByTestId('member-avatar')).toHaveTextContent('AL');
    expect(screen.queryByTestId('member-avatar-image')).toBeNull();
  });

  it('renders the image visibly and eagerly as soon as a url is given', () => {
    render(
      <MemberAvatar name="Ada Lovelace" avatarUrl="https://www.gravatar.com/avatar/abc?d=404&s=160" />,
    );

    const image = screen.getByTestId('member-avatar-image');
    expect(image).toBeVisible();
    expect(getComputedStyle(image).display).not.toBe('none');
    expect(image).not.toHaveAttribute('loading');
    expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(image).toHaveAttribute('alt', '');
    expect(screen.getByTestId('member-avatar')).toHaveTextContent('AL');
  });

  it('drops the image and falls back to initials when the load fails', () => {
    render(
      <MemberAvatar name="Ada Lovelace" avatarUrl="https://www.gravatar.com/avatar/abc?d=404&s=160" />,
    );

    fireEvent.error(screen.getByTestId('member-avatar-image'));

    expect(screen.queryByTestId('member-avatar-image')).toBeNull();
    expect(screen.getByTestId('member-avatar')).toHaveTextContent('AL');
  });

  it('retries loading when the avatar url changes', () => {
    const { rerender } = render(
      <MemberAvatar name="Ada Lovelace" avatarUrl="https://cdn.test/first.png" />,
    );

    fireEvent.error(screen.getByTestId('member-avatar-image'));
    expect(screen.queryByTestId('member-avatar-image')).toBeNull();

    rerender(<MemberAvatar name="Ada Lovelace" avatarUrl="https://cdn.test/second.png" />);

    expect(screen.getByTestId('member-avatar-image')).toHaveAttribute(
      'src',
      'https://cdn.test/second.png',
    );
  });
});
