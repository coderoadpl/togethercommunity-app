import { describe, expect, it } from 'vitest';

import { API_PATHS } from '#core/contract/index.js';

import {
  CONTENT_BODY_LIMIT,
  DEFAULT_API_BODY_LIMIT,
  M2M_TRANSACTIONAL_BODY_LIMIT,
  PUBLIC_FORM_BODY_LIMIT,
  WEBHOOK_BODY_LIMIT,
  requestBodyLimit,
} from './body-limits.js';

describe('request body limits', () => {
  it('keeps ordinary API requests at the default limit', () => {
    expect(requestBodyLimit('POST', API_PATHS.checkoutSession)).toBe(DEFAULT_API_BODY_LIMIT);
  });

  it('allows bounded content authoring payloads above the default limit', () => {
    expect(requestBodyLimit('POST', API_PATHS.marketingLayouts)).toBe(CONTENT_BODY_LIMIT);
    expect(requestBodyLimit('POST', API_PATHS.marketingDocuments)).toBe(CONTENT_BODY_LIMIT);
    expect(requestBodyLimit('POST', API_PATHS.marketingDocumentUpdate)).toBe(CONTENT_BODY_LIMIT);
    expect(requestBodyLimit('POST', API_PATHS.lessonsCreate)).toBe(CONTENT_BODY_LIMIT);
    expect(requestBodyLimit('POST', API_PATHS.lessonsUpdate)).toBe(CONTENT_BODY_LIMIT);
  });

  it('accepts provider maxima while keeping webhooks bounded', () => {
    expect(requestBodyLimit('POST', '/api/webhooks/stripe/t-acme')).toBe(WEBHOOK_BODY_LIMIT);
    expect(requestBodyLimit('POST', '/api/webhooks/ses/token')).toBe(WEBHOOK_BODY_LIMIT);
  });

  it('allows transactional M2M messages up to their explicit request limit', () => {
    expect(requestBodyLimit('POST', API_PATHS.m2mTransactionalMessagesCreate))
      .toBe(M2M_TRANSACTIONAL_BODY_LIMIT);
  });

  it('caps public HTML mutations outside the API prefix', () => {
    expect(requestBodyLimit('POST', '/u/token/preferences')).toBe(PUBLIC_FORM_BODY_LIMIT);
    expect(requestBodyLimit('POST', '/marketing/confirm/token')).toBe(PUBLIC_FORM_BODY_LIMIT);
    expect(requestBodyLimit('GET', '/u/token')).toBeUndefined();
  });
});
