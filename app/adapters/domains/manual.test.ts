import { describe, expect, it } from 'vitest';

import { createManualDomainProvisioner } from './manual.js';

describe('manual domain provisioner', () => {
  it('records the domain without contacting anything and leaves verification to an operator', async () => {
    const subject = createManualDomainProvisioner();

    expect(subject.provider).toBe('manual');
    expect(await subject.add('kurs.coderoad.example')).toEqual({
      ok: true,
      value: { verification: [], verified: false },
    });
    expect(await subject.status('kurs.coderoad.example')).toEqual({
      ok: true,
      value: { verified: false, misconfigured: false, verification: [] },
    });
    expect(await subject.verify('kurs.coderoad.example')).toEqual({
      ok: true,
      value: { verified: false, misconfigured: false, verification: [] },
    });
    expect(await subject.remove('kurs.coderoad.example')).toEqual({ ok: true, value: undefined });
  });
});
