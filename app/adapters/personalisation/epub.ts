import { inflateSync, zipSync } from 'fflate';

import { parseXml, serializeXml } from './xml.js';

interface Entry {
  name: string;
  method: number;
  size: number;
  compressedSize: number;
  offset: number;
  central: Uint8Array;
  local: Uint8Array;
}

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const decoder = new TextDecoder('utf-8', { fatal: true });

const entries = (bytes: Uint8Array): Entry[] => {
  const data = view(bytes);
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && data.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0 || end + 22 + data.getUint16(end + 20, true) !== bytes.length) throw new Error('Invalid ZIP directory');
  if (data.getUint32(end + 4, true) !== 0 || data.getUint16(end + 8, true) !== data.getUint16(end + 10, true)) throw new Error('Split ZIP is unsupported');
  const count = data.getUint16(end + 10, true);
  const start = data.getUint32(end + 16, true);
  if (start + data.getUint32(end + 12, true) !== end || count === 65535) throw new Error('Unsupported ZIP directory');
  const result: Entry[] = [];
  const names = new Set<string>();
  let cursor = start;
  for (let index = 0; index < count; index++) {
    if (data.getUint32(cursor, true) !== 0x02014b50) throw new Error('Invalid ZIP entry');
    const length = 46 + data.getUint16(cursor + 28, true) + data.getUint16(cursor + 30, true) + data.getUint16(cursor + 32, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + data.getUint16(cursor + 28, true)));
    const offset = data.getUint32(cursor + 42, true);
    const method = data.getUint16(cursor + 10, true);
    const compressedSize = data.getUint32(cursor + 20, true);
    const size = data.getUint32(cursor + 24, true);
    if (cursor + length > end || names.has(name) || (data.getUint16(cursor + 8, true) & 1) !== 0 ||
      offset >= start || data.getUint32(offset, true) !== 0x04034b50 || size === 0xffffffff || compressedSize === 0xffffffff) throw new Error('Unsupported ZIP entry');
    names.add(name);
    result.push({ name, offset, method, size, compressedSize, central: bytes.slice(cursor, cursor + length), local: new Uint8Array() });
    cursor += length;
  }
  if (cursor !== end) throw new Error('Invalid ZIP directory size');
  const ordered = [...result].sort((a, b) => a.offset - b.offset);
  for (const [index, entry] of ordered.entries()) {
    const next = ordered[index + 1]?.offset ?? start;
    if (entry.offset + 30 + data.getUint16(entry.offset + 26, true) + data.getUint16(entry.offset + 28, true) + entry.compressedSize > next) throw new Error('Overlapping ZIP entries');
    entry.local = bytes.slice(entry.offset, next);
  }
  return result;
};

const extract = (entry: Entry, maxBytes: number): Uint8Array => {
  if (entry.size > maxBytes) throw new Error('EPUB metadata exceeds the byte ceiling');
  const data = view(entry.local);
  const start = 30 + data.getUint16(26, true) + data.getUint16(28, true);
  const compressed = entry.local.subarray(start, start + entry.compressedSize);
  if (entry.method === 0 && entry.size === compressed.length) return compressed;
  if (entry.method !== 8) throw new Error('Unsupported ZIP compression');
  return inflateSync(compressed, { out: new Uint8Array(entry.size) });
};

const replacement = (name: string, bytes: Uint8Array): Entry => {
  const entry = entries(zipSync({ [name]: [bytes, { level: 0 }] }))[0];
  if (!entry) throw new Error('Missing ZIP replacement');
  return entry;
};

const assemble = (items: Entry[], maxBytes: number): Uint8Array => {
  const localSize = items.reduce((size, item) => size + item.local.length, 0);
  const centralSize = items.reduce((size, item) => size + item.central.length, 0);
  if (localSize + centralSize + 22 > maxBytes) throw new Error('Personalised EPUB exceeds the byte ceiling');
  const output = new Uint8Array(localSize + centralSize + 22);
  let offset = 0;
  let directoryOffset = localSize;
  for (const item of items) {
    output.set(item.local, offset);
    view(item.central).setUint32(42, offset, true);
    output.set(item.central, directoryOffset);
    offset += item.local.length;
    directoryOffset += item.central.length;
  }
  const end = view(output.subarray(directoryOffset));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, items.length, true);
  end.setUint16(10, items.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, localSize, true);
  return output;
};

export const personaliseEpub = (bytes: Uint8Array, copyIdentifier: string, maxBytes: number): Uint8Array => {
  const archive = entries(bytes);
  const container = archive.find((entry) => entry.name === 'META-INF/container.xml');
  const mimetype = archive.find((entry) => entry.name === 'mimetype');
  if (!container || !mimetype || decoder.decode(extract(mimetype, 100)) !== 'application/epub+zip') throw new Error('Invalid EPUB container');
  const containerXml = parseXml(decoder.decode(extract(container, maxBytes)));
  const rootfiles = containerXml.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:container', 'rootfile');
  if (rootfiles.length !== 1) throw new Error('Multiple EPUB renditions are unsupported');
  const path = rootfiles.item(0)?.getAttribute('full-path');
  const opf = archive.find((entry) => entry.name === path);
  if (!opf) throw new Error('Missing OPF');
  const xml = parseXml(decoder.decode(extract(opf, maxBytes)));
  const namespace = 'http://www.idpf.org/2007/opf';
  const metadata = xml.getElementsByTagNameNS(namespace, 'metadata').item(0);
  const packageElement = xml.documentElement;
  if (!metadata || !packageElement) throw new Error('Missing EPUB metadata');
  const prefix = packageElement.getAttribute('prefix') ?? '';
  if (/\btogether\s*:/.test(prefix)) throw new Error('Reserved EPUB prefix');
  packageElement.setAttribute('prefix', `${prefix} together: https://togethercommunity.app/ns/copy/1.0/`.trim());
  const identifier = xml.createElementNS('http://purl.org/dc/elements/1.1/', 'dc:identifier');
  identifier.setAttributeNS(namespace, 'opf:scheme', 'together-copy');
  identifier.appendChild(xml.createTextNode(copyIdentifier));
  const meta = xml.createElementNS(namespace, 'meta');
  meta.setAttribute('property', 'together:copy');
  meta.appendChild(xml.createTextNode(copyIdentifier));
  metadata.appendChild(identifier);
  metadata.appendChild(meta);
  return assemble([
    mimetype.offset === 0 && mimetype.method === 0 && view(mimetype.local).getUint16(28, true) === 0
      && view(mimetype.local).getUint16(8, true) === 0 && (view(mimetype.local).getUint16(6, true) & 8) === 0
      ? mimetype : replacement('mimetype', new TextEncoder().encode('application/epub+zip')),
    ...archive.filter((entry) => entry !== mimetype).map((entry) => entry === opf
      ? replacement(opf.name, new TextEncoder().encode(serializeXml(xml))) : entry),
  ], maxBytes);
};
