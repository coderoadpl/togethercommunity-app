import { IMAGE_ASSET_MAX_BYTES } from '#core/domain/index.js';

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0): boolean =>
  signature.every((value, index) => bytes[offset + index] === value);

const isIcon = (bytes: Uint8Array): boolean => {
  if (bytes.byteLength < 22) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(4, true);
  const directoryEnd = 6 + count * 16;
  if (view.getUint16(0, true) !== 0 || view.getUint16(2, true) !== 1
    || count === 0 || directoryEnd > bytes.byteLength) return false;
  for (let index = 0; index < count; index += 1) {
    const entry = 6 + index * 16;
    const size = view.getUint32(entry + 8, true);
    const offset = view.getUint32(entry + 12, true);
    if (bytes[entry + 3] !== 0 || size === 0 || offset < directoryEnd
      || offset + size > bytes.byteLength) return false;
  }
  return true;
};

const svgOpeningTagEnd = (document: string): number => {
  let quote: string | null = null;
  for (let index = 4; index < document.length; index += 1) {
    const character = document[index];
    if (character === '<') return -1;
    if (quote !== null) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index;
    }
  }
  return -1;
};

const isSvg = (bytes: Uint8Array): boolean => {
  try {
    let document = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim();
    document = document.replace(/^<\?xml\s[^?]*\?>\s*/u, '');
    let seenDoctype = false;
    while (document.startsWith('<!--') || (!seenDoctype && document.startsWith('<!DOCTYPE svg'))) {
      const comment = document.startsWith('<!--');
      const end = document.indexOf(comment ? '-->' : '>');
      if (end === -1) return false;
      if (!comment) seenDoctype = true;
      document = document.slice(end + (comment ? 3 : 1)).trimStart();
    }
    while (document.endsWith('-->')) {
      const start = document.lastIndexOf('<!--');
      if (start === -1) return false;
      document = document.slice(0, start).trimEnd();
    }
    if (!/^<svg(?:\s|\/|>)/u.test(document)) return false;
    const openingEnd = svgOpeningTagEnd(document);
    if (openingEnd === -1) return false;
    if (document[openingEnd - 1] === '/') return openingEnd === document.length - 1;
    return /<\/svg\s*>$/u.test(document);
  } catch {
    return false;
  }
};

export const imageContentMatches = (bytes: Uint8Array, extension: string): boolean => {
  if (bytes.byteLength === 0 || bytes.byteLength > IMAGE_ASSET_MAX_BYTES) return false;
  switch (extension) {
    case 'png': return startsWith(bytes, [137, 80, 78, 71, 13, 10, 26, 10]);
    case 'jpg': return startsWith(bytes, [255, 216, 255]);
    case 'webp': return bytes.byteLength >= 12 && startsWith(bytes, [82, 73, 70, 70])
      && startsWith(bytes, [87, 69, 66, 80], 8);
    case 'gif': return startsWith(bytes, [71, 73, 70, 56, 55, 97])
      || startsWith(bytes, [71, 73, 70, 56, 57, 97]);
    case 'ico': return isIcon(bytes);
    case 'svg': return isSvg(bytes);
    default: return false;
  }
};
