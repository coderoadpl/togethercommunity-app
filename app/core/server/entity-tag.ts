const STRONG_ENTITY_TAG = /^"[\x21\x23-\x7e\x80-\xff]*"$/u;

export const strongEntityTag = (etag: string | null | undefined): string | null =>
  etag !== null && etag !== undefined && STRONG_ENTITY_TAG.test(etag) ? etag : null;
