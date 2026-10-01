import { describe, expect, it } from 'vitest';
import { renderMemberActivityCsv } from './report-commands.js';

const row = { memberId: 'one', displayName: 'Name, "quoted"\nnext', email: 'one@example.test', signInsBefore: 1, signInsAfter: 0, firstSignIn: null, lastSignIn: null, progressBefore: 0, progressAfter: 0, coursesTouched: 0, lessonsCompletedTotal: 0, lastProgress: null, completionsBefore: 0, completionsAfter: 0 };

describe('report CSV', () => {
  it.each(['=', '+', '-', '@', '\t', '\r'])('neutralises string cells starting with %j', (prefix) => {
    const value = `${prefix}formula`;
    const csv = renderMemberActivityCsv([{ ...row, memberId: value, displayName: value, email: value, firstSignIn: value, lastSignIn: value, lastProgress: value }]);
    expect(csv).toContain(`"'${value}","'${value}","'${value}","1","0","'${value}","'${value}"`);
    expect(csv).toContain(`"'${value}","0","0"\r\n`);
  });
  it('keeps negative numeric cells numeric and nulls empty', () => {
    expect(renderMemberActivityCsv([{ ...row, displayName: 'Reader', signInsBefore: -1, progressBefore: -2, completionsAfter: -3 }])).toContain('"one","Reader","one@example.test","-1","0","","","-2","0","0","0","","0","-3"\r\n');
  });
  it('escapes commas, quotes, newlines and nulls', () => {
    expect(renderMemberActivityCsv([row])).toContain('"one","Name, ""quoted""\nnext","one@example.test","1","0","",""');
    expect(renderMemberActivityCsv([])).toContain('"memberId","displayName","email"');
    expect(renderMemberActivityCsv([row])).toMatch(/\r\n$/);
  });
});
