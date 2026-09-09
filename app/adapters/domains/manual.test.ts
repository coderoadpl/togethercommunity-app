import { describe, expect, it } from 'vitest';

import { createManualDomainProvisioner } from './manual.js';

describe('manual domain provisioner', () => {
  it('records the domain without contacting anything and leaves verification to an operator', async () => {
    const subject = createManualDomainProvisioner();

    expect(subject.provider).toBe('manual');
    expect(await subject.add('course.acme.example')).toEqual({
      ok: true,
      value: { verification: [], records: [], verified: false },
    });
    expect(await subject.status('course.acme.example')).toEqual({
      ok: true,
      value: { verified: false, misconfigured: false, verification: [], records: [] },
    });
    expect(await subject.verify('course.acme.example')).toEqual({
      ok: true,
      value: { verified: false, misconfigured: false, verification: [], records: [] },
    });
    expect(await subject.remove('course.acme.example')).toEqual({ ok: true, value: undefined });
  });
});
