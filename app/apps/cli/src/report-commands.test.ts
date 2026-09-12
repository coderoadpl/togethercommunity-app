import { describe, expect, it } from 'vitest';
import { renderMemberActivityCsv } from './report-commands.js';

const row = { memberId: 'one', displayName: 'Name, "quoted"\nnext', email: 'one@example.test', signInsBefore: 1, signInsAfter: 0, firstSignIn: null, lastSignIn: null, progressBefore: 0, progressAfter: 0, coursesTouched: 0, lessonsCompletedTotal: 0, lastProgress: null, completionsBefore: 0, completionsAfter: 0 };

describe('report CSV', () => {
  it('escapes commas, quotes, newlines and nulls', () => {
    expect(renderMemberActivityCsv([row])).toContain('"one","Name, ""quoted""\nnext","one@example.test","1","0","",""');
    expect(renderMemberActivityCsv([])).toContain('"memberId","displayName","email"');
    expect(renderMemberActivityCsv([row])).toMatch(/\r\n$/);
  });
});
