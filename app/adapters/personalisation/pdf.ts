import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

import { parseXml, serializeXml } from './xml.js';

const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const PDF = 'http://ns.adobe.com/pdf/1.3/';
const COPY = 'https://togethercommunity.app/ns/copy/1.0/';
const SIGNATURE_FIELD_MAX_DEPTH = 100;

const hasSignatureField = (
  fields: PDFArray,
  visited: Set<PDFDict>,
  depth: number,
): boolean => {
  if (depth > SIGNATURE_FIELD_MAX_DEPTH) return true;
  for (let index = 0; index < fields.size(); index++) {
    const field = fields.lookupMaybe(index, PDFDict);
    if (field === undefined || visited.has(field)) continue;
    visited.add(field);
    const fieldType = field.lookupMaybe(PDFName.of('FT'), PDFName);
    if (fieldType?.asString() === '/Sig' && field.has(PDFName.of('V'))) return true;
    const kids = field.lookupMaybe(PDFName.of('Kids'), PDFArray);
    if (kids !== undefined && hasSignatureField(kids, visited, depth + 1)) return true;
  }
  return false;
};

const isSignedOrCertified = (document: PDFDocument): boolean => {
  if (document.catalog.has(PDFName.of('Perms'))) return true;
  const acroForm = document.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  if (acroForm === undefined) return false;
  const signatureFlags = acroForm.lookupMaybe(PDFName.of('SigFlags'), PDFNumber);
  if (signatureFlags !== undefined && (signatureFlags.asNumber() & 1) !== 0) return true;
  const fields = acroForm.lookupMaybe(PDFName.of('Fields'), PDFArray);
  return fields !== undefined && hasSignatureField(fields, new Set(), 0);
};

export const personalisePdf = async (bytes: Uint8Array, copyIdentifier: string, maxBytes: number): Promise<Uint8Array> => {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  if (isSignedOrCertified(document)) throw new Error('Signed or certified PDFs cannot be personalised');
  const existingInfo = document.context.lookup(document.context.trailerInfo.Info);
  const info = existingInfo instanceof PDFDict ? existingInfo : document.context.obj({});
  if (!(existingInfo instanceof PDFDict)) {
    document.context.trailerInfo.Info = document.context.register(info);
  }
  info.set(PDFName.of('together:copy'), PDFHexString.fromText(copyIdentifier));
  const existing = document.catalog.lookup(PDFName.of('Metadata'));
  let xml = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></x:xmpmeta>';
  if (existing !== undefined) {
    if (!(existing instanceof PDFRawStream)) throw new Error('Unsupported XMP stream');
    const decoded = decodePDFRawStream(existing);
    const metadata = decoded.getBytes(maxBytes + 1);
    if (metadata.length > maxBytes) throw new Error('XMP exceeds the byte ceiling');
    xml = new TextDecoder('utf-8', { fatal: true }).decode(metadata);
  }
  const xmp = parseXml(xml);
  const rdf = xmp.getElementsByTagNameNS(RDF, 'RDF').item(0);
  if (!rdf) throw new Error('Missing XMP RDF');
  const description = xmp.createElementNS(RDF, 'rdf:Description');
  description.setAttributeNS(RDF, 'rdf:about', '');
  const keywordElements = Array.from(xmp.getElementsByTagNameNS(PDF, 'Keywords'));
  const keywordAttributes = Array.from(xmp.getElementsByTagNameNS(RDF, 'Description'))
    .filter((element) => element.hasAttributeNS(PDF, 'Keywords'));
  const keywords = [...new Set([
    document.getKeywords() ?? '',
    ...keywordElements.map((element) => element.textContent ?? ''),
    ...keywordAttributes.map((element) => element.getAttributeNS(PDF, 'Keywords') ?? ''),
    copyIdentifier,
  ].filter(Boolean))].join(' ');
  document.setKeywords([keywords]);
  for (const element of keywordElements) element.textContent = keywords;
  for (const element of keywordAttributes) element.setAttributeNS(PDF, 'pdf:Keywords', keywords);
  if (keywordElements.length === 0 && keywordAttributes.length === 0) {
    const element = xmp.createElementNS(PDF, 'pdf:Keywords');
    element.appendChild(xmp.createTextNode(keywords));
    description.appendChild(element);
  }
  const copy = xmp.createElementNS(COPY, 'together:copy');
  copy.appendChild(xmp.createTextNode(copyIdentifier));
  description.appendChild(copy);
  rdf.appendChild(description);
  const stream = document.context.stream(new TextEncoder().encode(serializeXml(xmp)), { Type: 'Metadata', Subtype: 'XML' });
  document.catalog.set(PDFName.of('Metadata'), document.context.register(stream));
  return document.save();
};
