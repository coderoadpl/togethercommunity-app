import { describe, expect, it } from 'vitest';

import { IMAGE_ASSET_MAX_BYTES } from '#core/domain/index.js';

import { imageContentMatches } from './image-content.js';

const icon = (): Uint8Array => {
  const bytes = new Uint8Array(30);
  bytes.set([0, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 0, 32, 0, 8, 0, 0, 0, 22, 0, 0, 0]);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 22);
  return bytes;
};

const text = (value: string) => new TextEncoder().encode(value);

describe('image format validation', () => {
  it.each([
    ['png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
    ['jpg', new Uint8Array([255, 216, 255, 224])],
    ['webp', new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80])],
    ['gif', text('GIF87a')],
    ['gif', text('GIF89a')],
    ['ico', icon()],
    ['svg', text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ['svg', text('﻿<?xml version="1.0"?>\n<!-- logo --><svg xmlns="http://www.w3.org/2000/svg"/>')],
    ['svg', text('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg/>')],
  ])('recognizes %s bytes without decoding the image', (extension, bytes) => {
    expect(imageContentMatches(bytes, extension)).toBe(true);
  });

  it.each(['png', 'jpg', 'webp', 'gif', 'ico'])('rejects SVG disguised as %s', (extension) => {
    expect(imageContentMatches(text('<svg><script>alert(1)</script></svg>'), extension)).toBe(false);
  });

  it.each([
    '', '<html><svg/></html>', '<svgish/>', '<svg>', '<svg/><html/>', 'prefix<svg/>',
    '<!-- <svg/> -->', '<svg/><!-- unterminated',
  ])('rejects a non-SVG document %s', (source) => {
    expect(imageContentMatches(text(source), 'svg')).toBe(false);
  });

  it.each([
    [0, 1], [2, 2], [4, 0], [4, 2], [9, 1], [14, 0], [14, 9], [18, 21], [18, 23],
  ])('rejects malformed ICO field at %s', (offset, value) => {
    const bytes = icon();
    bytes[offset] = value;
    expect(imageContentMatches(bytes, 'ico')).toBe(false);
  });

  it('rejects truncated headers, invalid UTF-8 and excessive text', () => {
    expect(imageContentMatches(icon().subarray(0, 21), 'ico')).toBe(false);
    expect(imageContentMatches(new Uint8Array([255, 216]), 'jpg')).toBe(false);
    expect(imageContentMatches(text('RIFF'), 'webp')).toBe(false);
    expect(imageContentMatches(new Uint8Array([255, 254]), 'svg')).toBe(false);
    expect(imageContentMatches(new Uint8Array(IMAGE_ASSET_MAX_BYTES + 1), 'svg')).toBe(false);
  });
});
