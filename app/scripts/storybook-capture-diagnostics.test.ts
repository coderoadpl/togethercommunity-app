import { describe, expect, it } from 'vitest';

import { captureDiagnosticFields } from './storybook-capture-diagnostics.js';

describe('Storybook capture diagnostics', () => {
  it('keeps successful captures quiet and records empty fields', () => {
    expect(captureDiagnosticFields({ fixtureErrors: '[]', text: 'Course', pageErrors: [] })).toEqual({
      missingFixtureCalls: [],
      fixtureExpectationIssues: [],
      unreadableFixtureDiagnostics: null,
      errorBoundaryRendered: false,
      pageErrors: [],
      failsGate: false,
      logSuffix: '',
    });
  });

  it('names every silent gate condition in the capture log', () => {
    const result = captureDiagnosticFields({
      fixtureErrors: '["Missing fixture call studentProgress:[\\"course-js\\"] in course"]',
      text: 'Something went wrong!',
      pageErrors: ['First error', 'Second error'],
    });

    expect(result).toEqual({
      missingFixtureCalls: ['Missing fixture call studentProgress:["course-js"] in course'],
      fixtureExpectationIssues: [],
      unreadableFixtureDiagnostics: null,
      errorBoundaryRendered: true,
      pageErrors: ['First error', 'Second error'],
      failsGate: true,
      logSuffix: '; missing fixture calls: ["Missing fixture call studentProgress:[\\"course-js\\"] in course"]; error boundary rendered; page errors: First error; Second error',
    });
  });

  it('separates unexercised fixture expectations from calls the fixture does not hold', () => {
    const result = captureDiagnosticFields({
      fixtureErrors: '["Missing fixture call me:[] in course","Unused fixture expectation studentProgress:[\\"course-js\\"]","No fixture selected"]',
      text: 'Course',
      pageErrors: [],
    });

    expect(result.missingFixtureCalls).toEqual(['Missing fixture call me:[] in course']);
    expect(result.fixtureExpectationIssues).toEqual(['Unused fixture expectation studentProgress:["course-js"]', 'No fixture selected']);
    expect(result.logSuffix).toBe('; missing fixture calls: ["Missing fixture call me:[] in course"]; fixture expectation issues: ["Unused fixture expectation studentProgress:[\\"course-js\\"]","No fixture selected"]');
  });

  it('reports an unreadable dataset value instead of aborting the remaining captures', () => {
    const result = captureDiagnosticFields({ fixtureErrors: '{oops', text: 'Course', pageErrors: [] });

    expect(result.unreadableFixtureDiagnostics).toBe('{oops');
    expect(result.failsGate).toBe(true);
    expect(result.logSuffix).toBe('; unreadable fixture diagnostics: {oops');
  });

  it('handles captures without fixture diagnostics', () => {
    expect(captureDiagnosticFields({ fixtureErrors: undefined, text: 'Component story', pageErrors: [] }).missingFixtureCalls).toEqual([]);
  });
});
