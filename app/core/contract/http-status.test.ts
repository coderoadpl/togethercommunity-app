import { describe, expect, it } from 'vitest';

import { ERROR_CODES } from '#core/domain/index.js';

import { EXIT_CODE_BY_ERROR_CODE, HTTP_STATUS_BY_ERROR_CODE } from './http-status.js';

describe('error taxonomy mappings', () => {
  it('maps every error code to an HTTP status', () => {
    for (const code of ERROR_CODES) {
      expect(HTTP_STATUS_BY_ERROR_CODE[code], `missing HTTP status for "${code}"`).toBeTypeOf('number');
    }
    expect(Object.keys(HTTP_STATUS_BY_ERROR_CODE).sort()).toEqual([...ERROR_CODES].sort());
  });

  it('maps every error code to a CLI exit code', () => {
    for (const code of ERROR_CODES) {
      expect(EXIT_CODE_BY_ERROR_CODE[code], `missing exit code for "${code}"`).toBeTypeOf('number');
    }
    expect(Object.keys(EXIT_CODE_BY_ERROR_CODE).sort()).toEqual([...ERROR_CODES].sort());
  });

  it('keeps auth failures on 401 and forbidden on 403', () => {
    expect(HTTP_STATUS_BY_ERROR_CODE.unauthorized).toBe(401);
    expect(HTTP_STATUS_BY_ERROR_CODE.invalid_credentials).toBe(401);
    expect(HTTP_STATUS_BY_ERROR_CODE.forbidden).toBe(403);
    expect(HTTP_STATUS_BY_ERROR_CODE.not_found).toBe(404);
    expect(HTTP_STATUS_BY_ERROR_CODE.tenant_not_found).toBe(404);
    expect(HTTP_STATUS_BY_ERROR_CODE.validation).toBe(400);
    expect(HTTP_STATUS_BY_ERROR_CODE.conflict).toBe(409);
  });

  it('maps integration failures to distinct 5xx/412 statuses', () => {
    expect(HTTP_STATUS_BY_ERROR_CODE.integration_not_configured).toBe(412);
    expect(HTTP_STATUS_BY_ERROR_CODE.integration_auth).toBe(502);
    expect(HTTP_STATUS_BY_ERROR_CODE.integration_unavailable).toBe(503);
    expect(HTTP_STATUS_BY_ERROR_CODE.unavailable).toBe(503);
    expect(HTTP_STATUS_BY_ERROR_CODE.internal).toBe(500);
  });

  it('assigns non-zero exit codes and shares one only for the two auth failures', () => {
    const codes = Object.values(EXIT_CODE_BY_ERROR_CODE);
    expect(codes.every((code) => code >= 2)).toBe(true);
    expect(EXIT_CODE_BY_ERROR_CODE.unauthorized).toBe(3);
    expect(EXIT_CODE_BY_ERROR_CODE.invalid_credentials).toBe(3);
    expect(EXIT_CODE_BY_ERROR_CODE.validation).toBe(2);
    expect(EXIT_CODE_BY_ERROR_CODE.unavailable).toBe(20);
    const withoutAuthAlias = codes.filter((_, index) => index !== codes.indexOf(3, codes.indexOf(3) + 1));
    expect(new Set(withoutAuthAlias).size).toBe(withoutAuthAlias.length);
  });
});
