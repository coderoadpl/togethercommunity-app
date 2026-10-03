import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

export const parseXml = (value: string) => {
  if (/<!DOCTYPE|<!ENTITY/i.test(value)) throw new Error('External declarations are unsupported');
  return new DOMParser({ onError: () => { throw new Error('Invalid XML'); } }).parseFromString(value, 'application/xml');
};

export const serializeXml = (document: ReturnType<typeof parseXml>): string => new XMLSerializer().serializeToString(document);
