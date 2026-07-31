export const BUILD_VERSION = __APP_VERSION__;
export const BUILD_SHA = __APP_COMMIT_SHA__;

const UNKNOWN_SHA = 'unknown';

export const shortSha = (sha: string): string =>
  sha === UNKNOWN_SHA ? sha : sha.slice(0, 7);

export const buildStampText = (): string =>
  BUILD_SHA === UNKNOWN_SHA
    ? `v${BUILD_VERSION}`
    : `v${BUILD_VERSION} (${BUILD_SHA})`;

export const isBuildMismatch = (server: { version: string; sha: string }): boolean =>
  server.version !== BUILD_VERSION ||
  shortSha(server.sha) !== BUILD_SHA;
