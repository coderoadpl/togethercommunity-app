import { describe, expect, it } from 'vitest';
import { surveyInputSchema, surveySubmissionSchema } from './survey.js';

const base = { title: 'Audience feedback', question: 'How was your experience?', slug: 'feedback', type: 'nps', commentEnabled: true, commentPrompt: 'Anything else?', active: true, endings: [{ min: 0, max: 6, body: 'Thank you' }, { min: 7, max: 8, body: 'Thank you' }, { min: 9, max: 10, body: 'Thank you' }] };
describe('survey schemas', () => {
  it('accepts both complete scales and editable thresholds', () => {
    expect(surveyInputSchema.safeParse(base).success).toBe(true);
    expect(surveyInputSchema.safeParse({ ...base, endings: [{ min: 0, max: 4, body: 'Low' }, { min: 5, max: 7, body: 'Middle' }, { min: 8, max: 10, body: 'High' }] }).success).toBe(true);
    expect(surveyInputSchema.safeParse({ ...base, type: 'stars', endings: [{ min: 1, max: 3, body: 'Low' }, { min: 4, max: 4, body: 'Middle' }, { min: 5, max: 5, body: 'High' }] }).success).toBe(true);
  });
  it.each([
    [{ min: 0, max: 5, body: 'Low' }, { min: 7, max: 8, body: 'Middle' }, { min: 9, max: 10, body: 'High' }],
    [{ min: 0, max: 7, body: 'Low' }, { min: 7, max: 8, body: 'Middle' }, { min: 9, max: 10, body: 'High' }],
    [{ min: 1, max: 6, body: 'Low' }, { min: 7, max: 8, body: 'Middle' }, { min: 9, max: 10, body: 'High' }],
    [{ min: 0, max: 6, body: 'Low' }, { min: 7, max: 8, body: 'Middle' }, { min: 9, max: 9, body: 'High' }],
    [{ min: 0, max: 6, body: 'Low' }, { min: 7, max: 6, body: 'Middle' }, { min: 7, max: 10, body: 'High' }],
  ])('rejects gaps, overlaps, omitted endpoints and reversed ranges %#', (...endings) => {
    expect(surveyInputSchema.safeParse({ ...base, endings }).success).toBe(false);
  });
  it('limits plain-text comments and rejects fractional scores', () => {
    expect(surveySubmissionSchema.safeParse({ token: 'token', score: 5, comment: 'a'.repeat(2000) }).success).toBe(true);
    expect(surveySubmissionSchema.safeParse({ token: 'token', score: 5, comment: 'a'.repeat(2001) }).success).toBe(false);
    expect(surveySubmissionSchema.safeParse({ token: 'token', score: 5.5 }).success).toBe(false);
  });
});
