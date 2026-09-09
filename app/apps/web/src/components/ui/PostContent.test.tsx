import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PostContent } from './PostContent.js';

describe('PostContent', () => {
  it('renders server-sanitized Markdown and unmistakable safe links', () => {
    render(
      <PostContent
        data-testid="content"
        format="markdown"
        html={'<p><strong>Read</strong> <a href="https://example.com/very-long-url" target="_blank" rel="noopener noreferrer nofollow ugc">the guide</a></p>'}
      />,
    );

    const content = screen.getByTestId('content');
    expect(within(content).getByText('Read')).toHaveProperty('tagName', 'STRONG');
    const link = within(content).getByRole('link', { name: 'the guide' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow ugc');
    expect(link).toHaveStyle({ textDecoration: 'underline', wordBreak: 'break-word' });
  });

  it('preserves spacing only for server-rendered plain posts', () => {
    const { rerender } = render(
      <PostContent data-testid="content" format="plain" html={'Step 1:    do this<br>\tStep 2: do that'} />,
    );

    expect(screen.getByTestId('content')).toHaveStyle({ whiteSpace: 'pre-wrap' });

    rerender(<PostContent data-testid="content" format="markdown" html={'<p>First</p>\n<p>Second</p>'} />);
    expect(screen.getByTestId('content')).not.toHaveStyle({ whiteSpace: 'pre-wrap' });
  });

  it('renders optimistic plain text as text rather than HTML', () => {
    render(<PostContent data-testid="pending" plainText={'<script>alert(1)</script>\nnext'} />);

    const pending = screen.getByTestId('pending');
    expect(pending).toHaveTextContent('<script>alert(1)</script> next');
    expect(pending.querySelector('script')).toBeNull();
    expect(pending).toHaveStyle({ whiteSpace: 'pre-wrap' });
  });
});
