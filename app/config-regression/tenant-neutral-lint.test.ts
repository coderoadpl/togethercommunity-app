import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { lintTenantNeutrality, parseAllowlist, scanFile } from '../scripts/tenant-neutral-lint.js';

const root = join(import.meta.dirname, '..', '..');

describe('tenant-neutral lint', () => {
  it('reports a tenant name, domain, legacy path shape, course title, and legacy slug', () => {
    const source = [
      'const host = "kurs.coderoad.pl";',
      'const legacy = "/courses/656b8fa6e74246956889b096/modules/65a52510b5bd26b9d2ab3aa1";',
      'const title = "Kurs front-end od A do Z";',
      'const bundle = "akademia-samouka";',
    ].join('\n');

    expect(scanFile('probe.ts', source).map((finding) => `${finding.rule}:${finding.line}`)).toEqual([
      'tenant name:1',
      'tenant domain:1',
      'legacy path shape:2',
      'tenant course title:3',
      'legacy tenant slug:4',
    ]);
  });

  it('accepts the organisation name and the platform course routes', () => {
    const source = [
      'https://github.com/coderoadpl/togethercommunity-app',
      "const route = '/panel/courses/$courseId/modules/new';",
      "const member = '/my/courses/course-1/lessons/lesson-1';",
    ].join('\n');

    expect(scanFile('probe.ts', source)).toEqual([]);
  });

  it('reads an allowlist entry with its justification', () => {
    expect(parseAllowlist('# comment\n\nSECURITY.md # licence contact\n')).toEqual([
      { file: 'SECURITY.md', justification: 'licence contact' },
    ]);
  });

  it('keeps the repository free of tenant references', () => {
    expect(lintTenantNeutrality(root)).toEqual([]);
  });
});
