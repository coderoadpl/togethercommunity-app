import { describe, expect, it } from 'vitest';

import { createBunnyTokenSigner } from './bunny-token-signer.js';

const input = {
  securityKey: 'test-security-key',
  videoId: '9f3a1c2e-1111-2222-3333-444455556666',
  expires: 1_700_000_000,
};

describe('Bunny token signer', () => {
  it('signs embed tokens with the fixed Bunny vector', () => {
    const signer = createBunnyTokenSigner();

    expect(signer.signEmbedToken(input)).toBe(
      '3d4ccc7b28a00a8f659e10cbb9e2dceb044ccfe44dad5c8e82f46a581df826f1',
    );
    expect(signer.signEmbedToken({ ...input, videoId: 'video-2' })).not.toBe(
      signer.signEmbedToken(input),
    );
    expect(signer.signEmbedToken({ ...input, expires: input.expires + 1 })).not.toBe(
      signer.signEmbedToken(input),
    );
  });

  it('signs HLS playlists with the fixed Bunny V2 directory-token vector', () => {
    const signer = createBunnyTokenSigner();
    const url = signer.signHlsPlaylistUrl({
      ...input,
      cdnHostname: 'vz-demo-123.b-cdn.net',
    });

    expect(url).toBe(
      'https://vz-demo-123.b-cdn.net/9f3a1c2e-1111-2222-3333-444455556666/playlist.m3u8?token=tEq3C9Me70JeyQ3uuKs0mwfOrPdo3zh0poGv-40EMdI&token_path=%2F9f3a1c2e-1111-2222-3333-444455556666%2F&expires=1700000000&token_ver=2',
    );
    const token = new URL(url).searchParams.get('token');
    expect(token).not.toMatch(/[+/=]/);
    expect(url).toContain(
      'token_path=%2F9f3a1c2e-1111-2222-3333-444455556666%2F',
    );
  });
});
