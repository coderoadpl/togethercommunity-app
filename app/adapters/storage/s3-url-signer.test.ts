import { describe, expect, it } from 'vitest';

import { createS3UrlSigner } from './s3-url-signer.js';

const DOCS_EXAMPLE = {
  url: 'https://examplebucket.s3.amazonaws.com/test.txt',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  expiresInSeconds: 86400,
};

describe('createS3UrlSigner', () => {
  it('reproduces the AWS documentation presign example byte for byte', () => {
    const signer = createS3UrlSigner(() => new Date('2013-05-24T00:00:00.000Z'));
    const result = signer.presignGet(DOCS_EXAMPLE);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toBe(
      'https://examplebucket.s3.amazonaws.com/test.txt' +
        '?X-Amz-Algorithm=AWS4-HMAC-SHA256' +
        '&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request' +
        '&X-Amz-Date=20130524T000000Z' +
        '&X-Amz-Expires=86400' +
        '&X-Amz-SignedHeaders=host' +
        '&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
  });

  it('extracts the region from regional virtual-hosted hosts', () => {
    const signer = createS3UrlSigner(() => new Date('2026-07-20T12:00:00.000Z'));
    const result = signer.presignGet({
      url: 'https://legacy-pdf-bucket-example.s3.eu-central-1.amazonaws.com/pdf-files/handout.pdf',
      accessKeyId: 'AKIA-TEST',
      secretAccessKey: 'secret',
      expiresInSeconds: 3600,
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toContain('%2Feu-central-1%2Fs3%2Faws4_request');
    expect(result.value).toContain('X-Amz-Date=20260720T120000Z');
    expect(result.value.startsWith('https://legacy-pdf-bucket-example.s3.eu-central-1.amazonaws.com/pdf-files/handout.pdf?')).toBe(true);
  });

  it('percent-encodes path segments into the canonical URI', () => {
    const signer = createS3UrlSigner(() => new Date('2026-07-20T12:00:00.000Z'));
    const result = signer.presignGet({
      url: 'https://bucket.s3.eu-central-1.amazonaws.com/pdf files/no(1)*.pdf',
      accessKeyId: 'AKIA-TEST',
      secretAccessKey: 'secret',
      expiresInSeconds: 60,
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toContain('/pdf%20files/no%281%29%2A.pdf?');
  });

  it('rejects URLs that are not virtual-hosted S3', () => {
    const signer = createS3UrlSigner();
    const result = signer.presignGet({
      url: 'https://cdn.example.com/file.pdf',
      accessKeyId: 'AKIA-TEST',
      secretAccessKey: 'secret',
      expiresInSeconds: 60,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('validation');
  });

  it('rejects unparsable URLs', () => {
    const signer = createS3UrlSigner();
    const result = signer.presignGet({
      url: 'not a url',
      accessKeyId: 'AKIA-TEST',
      secretAccessKey: 'secret',
      expiresInSeconds: 60,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('validation');
  });
});
