import { describe, expect, it } from 'vitest';

import { summarizeUserAgent } from './user-agent.js';

describe('summarizeUserAgent', () => {
  it('names the browser before the operating system', () => {
    expect(summarizeUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    )).toBe('Chrome · macOS');
  });

  it('prefers the most specific browser token over the compatibility ones', () => {
    expect(summarizeUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
    )).toBe('Edge · Windows');
    expect(summarizeUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
    )).toBe('Safari · iOS');
  });

  it('falls back to a truncated raw value when nothing is recognised', () => {
    expect(summarizeUserAgent('together-cli/1.0')).toBe('together-cli/1.0');
    expect(summarizeUserAgent('x'.repeat(80))).toBe(`${'x'.repeat(60)}…`);
  });

  it('treats missing and blank agents as unknown', () => {
    expect(summarizeUserAgent(null)).toBeNull();
    expect(summarizeUserAgent('   ')).toBeNull();
  });
});
