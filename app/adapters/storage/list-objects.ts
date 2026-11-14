import {
  err,
  integrationUnavailable,
  ok,
  storageListPageSchema,
  type AppError,
  type Result,
  type StorageListPage,
} from '#core/domain/index.js';

const decodeXmlText = (text: string): string => text.replace(
  /&([^;]+);/g,
  (_match: string, entity: string): string => {
    switch (entity) {
      case 'amp': return '&';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case 'apos': return "'";
      default: {
        const code = /^#x[\da-f]+$/i.test(entity)
          ? Number.parseInt(entity.slice(2), 16)
          : /^#\d+$/.test(entity) ? Number(entity.slice(1)) : NaN;
        if (!Number.isSafeInteger(code) || code < 1 || code > 0x10ffff) {
          throw new Error('Invalid XML entity');
        }
        return String.fromCodePoint(code);
      }
    }
  },
);

const field = (xml: string, name: string): string => {
  const matches = [...xml.matchAll(new RegExp(`<${name}>([^<]*)</${name}>`, 'g'))];
  const value = matches[0]?.[1];
  if (matches.length !== 1 || value === undefined) throw new Error('Missing or duplicate XML field');
  return decodeXmlText(value);
};

export const parseListObjectsPage = (xml: string): Result<StorageListPage, AppError> => {
  try {
    if (/<!|&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);)/i.test(xml)
      || !/^\s*(?:<\?xml[^?]*\?>\s*)?<ListBucketResult(?:\s+xmlns="[^"]*")?>[\s\S]*<\/ListBucketResult>\s*$/.test(xml)) {
      throw new Error('Invalid listing envelope');
    }
    if (field(xml, 'EncodingType') !== 'url') throw new Error('Unsupported key encoding');
    const objects = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((match) => {
      const contents = match[1] ?? '';
      const size = field(contents, 'Size');
      if (!/^\d+$/.test(size)) throw new Error('Invalid object size');
      return {
        key: decodeURIComponent(field(contents, 'Key')),
        sizeBytes: Number(size),
        lastModified: field(contents, 'LastModified'),
      };
    });
    const count = field(xml, 'KeyCount');
    if (!/^\d+$/.test(count) || Number(count) !== objects.length) throw new Error('Invalid object count');
    const truncated = field(xml, 'IsTruncated');
    if (truncated !== 'true' && truncated !== 'false') throw new Error('Invalid pagination state');
    const page = storageListPageSchema.safeParse({
      objects,
      continuationToken: truncated === 'true' ? field(xml, 'NextContinuationToken') : null,
    });
    if (!page.success) throw new Error('Invalid listing metadata');
    return ok(page.data);
  } catch {
    return err(integrationUnavailable('S3 returned an invalid object listing.'));
  }
};
