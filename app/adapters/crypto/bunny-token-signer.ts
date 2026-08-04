import { createHash } from 'node:crypto';

import type { BunnyTokenSigner } from '#core/server/index.js';

const base64Url = (buffer: Buffer): string =>
  buffer.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

export const createBunnyTokenSigner = (): BunnyTokenSigner => ({
  signEmbedToken: ({ securityKey, videoId, expires }) =>
    createHash('sha256').update(`${securityKey}${videoId}${expires}`).digest('hex'),
  signHlsPlaylistUrl: ({ securityKey, cdnHostname, videoId, expires }) => {
    const signaturePath = `/${videoId}/`;
    const parameterData = `token_path=${signaturePath}`;
    const token = base64Url(
      createHash('sha256').update(`${securityKey}${signaturePath}${expires}${parameterData}`).digest(),
    );
    return `https://${cdnHostname}/${videoId}/playlist.m3u8?token=${token}&token_path=${encodeURIComponent(signaturePath)}&expires=${expires}&token_ver=2`;
  },
});
