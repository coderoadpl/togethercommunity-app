import { PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { strToU8, unzipSync, zipSync, Zip, ZipDeflate } from 'fflate';
import { describe, expect, it } from 'vitest';

import encryptedPdf from './fixtures/encrypted-pdf.json' with { type: 'json' };

import { createDownloadPersonaliser } from './index.js';
import { parseXml } from './xml.js';

const copyIdentifier = 'copy_AAAAAAAAAAAAAAAAAAAAAAAAAA';
const context = { maxBytes: 20 * 1024 * 1024 };
const adapter = createDownloadPersonaliser();

describe('download personalisation', () => {
  it('adds PDF Info, Keywords and XMP while preserving pages and existing metadata', async () => {
    const original = await PDFDocument.create();
    original.addPage([200, 300]);
    original.addPage([400, 500]);
    original.setTitle('Workbook');
    original.setKeywords(['original']);
    const result = await adapter.personalise({ contentType: 'application/pdf', bytes: await original.save(), copyIdentifier, context });
    if (!result.ok) throw new Error(result.error.message);
    const document = await PDFDocument.load(result.value.bytes);
    expect(document.getPageCount()).toBe(2);
    expect(document.getPages().map((page) => page.getSize())).toEqual(original.getPages().map((page) => page.getSize()));
    expect(document.getTitle()).toBe('Workbook');
    expect(document.getKeywords()).toContain('original');
    expect(document.getKeywords()).toContain(copyIdentifier);
    const info = document.context.lookup(document.context.trailerInfo.Info, PDFDict);
    expect(info.get(PDFName.of('together:copy'))?.toString()).toContain(copyIdentifier.split('').map((char) => char.charCodeAt(0).toString(16).padStart(4, '0')).join('').toUpperCase());
    const stream = document.catalog.lookup(PDFName.of('Metadata'));
    if (!(stream instanceof PDFRawStream)) throw new Error('Missing metadata');
    const xml = parseXml(new TextDecoder().decode(decodePDFRawStream(stream).decode()));
    expect(xml.getElementsByTagNameNS('https://togethercommunity.app/ns/copy/1.0/', 'copy').item(0)?.textContent).toBe(copyIdentifier);
    expect(xml.getElementsByTagNameNS('http://ns.adobe.com/pdf/1.3/', 'Keywords').item(0)?.textContent).toBe(document.getKeywords());
  });

  it.each(['element', 'attribute'])('synchronizes existing XMP Keywords stored as an %s with Info', async (kind) => {
    const original = await PDFDocument.create();
    original.addPage();
    original.setKeywords(['info-keyword']);
    const description = kind === 'element'
      ? '<rdf:Description rdf:about=""><pdf:Keywords>xmp-keyword</pdf:Keywords></rdf:Description>'
      : '<rdf:Description rdf:about="" pdf:Keywords="xmp-keyword"/>';
    const metadata = original.context.stream(strToU8(`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">${description}</rdf:RDF></x:xmpmeta>`), { Type: 'Metadata', Subtype: 'XML' });
    original.catalog.set(PDFName.of('Metadata'), original.context.register(metadata));
    const result = await adapter.personalise({ contentType: 'application/pdf', bytes: await original.save(), copyIdentifier, context });
    if (!result.ok) throw new Error(result.error.message);
    const document = await PDFDocument.load(result.value.bytes);
    const stream = document.catalog.lookup(PDFName.of('Metadata'));
    if (!(stream instanceof PDFRawStream)) throw new Error('Missing metadata');
    const xml = parseXml(new TextDecoder().decode(decodePDFRawStream(stream).decode()));
    const keywords = kind === 'element'
      ? xml.getElementsByTagNameNS('http://ns.adobe.com/pdf/1.3/', 'Keywords').item(0)?.textContent
      : xml.getElementsByTagNameNS('http://www.w3.org/1999/02/22-rdf-syntax-ns#', 'Description').item(0)?.getAttributeNS('http://ns.adobe.com/pdf/1.3/', 'Keywords');
    expect(keywords).toBe(document.getKeywords());
    expect(keywords).toBe(`info-keyword xmp-keyword ${copyIdentifier}`);
  });

  it('falls back for encrypted PDFs without changing their bytes', async () => {
    const bytes = new Uint8Array(Buffer.from(encryptedPdf.base64, 'base64'));
    const before = bytes.slice();
    await expect(PDFDocument.load(bytes)).rejects.toThrow(/encrypted/);
    expect(await adapter.personalise({ contentType: 'application/pdf', bytes, copyIdentifier, context })).toMatchObject({ ok: false });
    expect(bytes).toEqual(before);
  });

  it.each(['signature flags and field', 'signature field', 'permissions'])(
    'falls back for PDFs with structural %s markers', async (marker) => {
      const original = await PDFDocument.create();
      original.addPage();
      if (marker !== 'permissions') {
        const signatureValue = original.context.obj({ Type: 'Sig' });
        const signatureField = original.context.obj({ FT: 'Sig', V: original.context.register(signatureValue) });
        const parentField = original.context.obj({ Kids: [original.context.register(signatureField)] });
        const acroForm = original.context.obj({
          ...(marker === 'signature flags and field' ? { SigFlags: 1 } : {}),
          Fields: [original.context.register(parentField)],
        });
        original.catalog.set(PDFName.of('AcroForm'), original.context.register(acroForm));
      } else {
        const permissions = original.context.obj({ DocMDP: original.context.register(original.context.obj({ Type: 'Sig' })) });
        original.catalog.set(PDFName.of('Perms'), original.context.register(permissions));
      }

      expect(await adapter.personalise({
        contentType: 'application/pdf', bytes: await original.save(), copyIdentifier, context,
      })).toMatchObject({ ok: false });
    },
  );

  it.each([false, true])('only replaces EPUB metadata with data descriptors=%s and normalizes deflated mimetype', async (descriptors) => {
    const files = {
      mimetype: strToU8('application/epub+zip'),
      'META-INF/container.xml': strToU8('<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>'),
      'OEBPS/book.opf': strToU8('<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="book"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book">original-book</dc:identifier><dc:title>Workbook</dc:title></metadata><manifest/></package>'),
      'OEBPS/chapter.xhtml': strToU8('<html><body>Original chapter</body></html>'),
      'OEBPS/image.bin': new Uint8Array([1, 3, 5, 7]),
    };
    const chunks: Uint8Array[] = [];
    const zip = new Zip((error, data) => {
      if (error) throw error;
      chunks.push(data);
    });
    for (const [name, bytes] of Object.entries(files)) {
      const entry = new ZipDeflate(name, { level: 6 });
      zip.add(entry);
      entry.push(bytes, true);
    }
    zip.end();
    const streamed = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
    let position = 0;
    for (const chunk of chunks) { streamed.set(chunk, position); position += chunk.length; }
    const bytes = descriptors ? streamed : zipSync(files, { level: 6 });
    expect(new DataView(bytes.buffer).getUint16(8, true)).toBe(8);
    expect(new DataView(bytes.buffer).getUint16(6, true) & 8).toBe(descriptors ? 8 : 0);
    const result = await adapter.personalise({ contentType: 'application/epub+zip', bytes, copyIdentifier, context });
    if (!result.ok) throw new Error(result.error.message);
    const output = unzipSync(result.value.bytes);
    for (const [name, value] of Object.entries(files)) if (name !== 'OEBPS/book.opf') expect(output[name]).toEqual(value);
    const xml = parseXml(new TextDecoder().decode(output['OEBPS/book.opf']));
    const identifiers = xml.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'identifier');
    expect(identifiers.item(0)?.textContent).toBe('original-book');
    expect(identifiers.item(1)?.getAttributeNS('http://www.idpf.org/2007/opf', 'scheme')).toBe('together-copy');
    expect(identifiers.item(1)?.textContent).toBe(copyIdentifier);
    expect(xml.getElementsByTagNameNS('http://www.idpf.org/2007/opf', 'meta').item(0)?.textContent).toBe(copyIdentifier);
    const data = new DataView(result.value.bytes.buffer);
    expect(data.getUint16(8, true)).toBe(0);
    expect(new TextDecoder().decode(result.value.bytes.subarray(30, 38))).toBe('mimetype');
    const locals = (zip: Uint8Array) => {
      const entries = new Map<string, Uint8Array>();
      const data = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
      let cursor = data.getUint32(zip.length - 6, true);
      const directoryStart = cursor;
      const records: { name: string; offset: number }[] = [];
      while (data.getUint32(cursor, true) === 0x02014b50) {
        const nameLength = data.getUint16(cursor + 28, true);
        records.push({ name: new TextDecoder().decode(zip.subarray(cursor + 46, cursor + 46 + nameLength)), offset: data.getUint32(cursor + 42, true) });
        cursor += 46 + nameLength + data.getUint16(cursor + 30, true) + data.getUint16(cursor + 32, true);
      }
      records.sort((a, b) => a.offset - b.offset);
      for (const [index, record] of records.entries()) entries.set(record.name, zip.slice(record.offset, records[index + 1]?.offset ?? directoryStart));
      return entries;
    };
    for (const [name, local] of locals(bytes)) if (name !== 'mimetype' && name !== 'OEBPS/book.opf') expect(locals(result.value.bytes).get(name)).toEqual(local);
  });

  it('preserves an already compliant mimetype local record byte for byte', async () => {
    const bytes = zipSync({
      mimetype: [strToU8('application/epub+zip'), { level: 0, mtime: new Date('2001-02-03T04:05:06Z') }],
      'META-INF/container.xml': strToU8('<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>'),
      'book.opf': strToU8('<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata/></package>'),
    });
    const result = await adapter.personalise({ contentType: 'application/epub+zip', bytes, copyIdentifier, context });
    if (!result.ok) throw new Error(result.error.message);
    const length = 30 + 'mimetype'.length + 'application/epub+zip'.length;
    expect(result.value.bytes.slice(0, length)).toEqual(bytes.slice(0, length));
    expect(unzipSync(result.value.bytes).mimetype).toEqual(strToU8('application/epub+zip'));
  });

  it('falls back without changing an EPUB that already reserves the together prefix', async () => {
    const bytes = zipSync({
      mimetype: strToU8('application/epub+zip'),
      'META-INF/container.xml': strToU8('<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>'),
      'book.opf': strToU8('<package xmlns="http://www.idpf.org/2007/opf" prefix="together: https://example.test/existing/"><metadata><meta property="together:copy">existing-value</meta></metadata></package>'),
    });
    const before = bytes.slice();
    expect(await adapter.personalise({ contentType: 'application/epub+zip', bytes, copyIdentifier, context })).toMatchObject({ ok: false });
    expect(bytes).toEqual(before);
    expect(unzipSync(bytes)).toEqual(unzipSync(before));
  });

  it.each(['application/pdf', 'application/epub+zip', 'text/plain'])('returns a safe fallback for malformed %s', async (contentType) => {
    expect(await adapter.personalise({ contentType, bytes: strToU8('invalid'), copyIdentifier, context })).toMatchObject({ ok: false });
  });

  it('rejects files exceeding the ceiling before parsing', async () => {
    expect(await adapter.personalise({ contentType: 'application/pdf', bytes: new Uint8Array(2), copyIdentifier, context: { maxBytes: 1 } })).toMatchObject({ ok: false });
  });
});
