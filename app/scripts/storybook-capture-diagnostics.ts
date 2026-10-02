import { z } from 'zod';

const fixtureDiagnosticsSchema = z.array(z.string());
const missingCallPrefix = 'Missing fixture call ';

export interface CaptureDiagnosticInput {
  fixtureErrors: string | undefined;
  text: string;
  pageErrors: readonly string[];
}

export interface CaptureDiagnosticFields {
  missingFixtureCalls: string[];
  fixtureExpectationIssues: string[];
  unreadableFixtureDiagnostics: string | null;
  errorBoundaryRendered: boolean;
  pageErrors: string[];
  failsGate: boolean;
  logSuffix: string;
}

const readJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

export const captureDiagnosticFields = ({
  fixtureErrors,
  text,
  pageErrors,
}: CaptureDiagnosticInput): CaptureDiagnosticFields => {
  const parsed = fixtureDiagnosticsSchema.safeParse(fixtureErrors === undefined ? [] : readJson(fixtureErrors));
  const entries = parsed.success ? parsed.data : [];
  // The dataset mixes calls the story made without a fixture entry with fixture entries the story never exercised, and those two point at opposite causes.
  const missingFixtureCalls = entries.filter((entry) => entry.startsWith(missingCallPrefix));
  const fixtureExpectationIssues = entries.filter((entry) => !entry.startsWith(missingCallPrefix));
  const unreadableFixtureDiagnostics = parsed.success ? null : fixtureErrors ?? null;
  const errorBoundaryRendered = text.includes('Something went wrong!');
  const capturedPageErrors = [...pageErrors];
  const logParts = [
    ...(missingFixtureCalls.length === 0 ? [] : [`missing fixture calls: ${JSON.stringify(missingFixtureCalls)}`]),
    ...(fixtureExpectationIssues.length === 0 ? [] : [`fixture expectation issues: ${JSON.stringify(fixtureExpectationIssues)}`]),
    ...(unreadableFixtureDiagnostics === null ? [] : [`unreadable fixture diagnostics: ${unreadableFixtureDiagnostics}`]),
    ...(errorBoundaryRendered ? ['error boundary rendered'] : []),
    ...(capturedPageErrors.length === 0 ? [] : [`page errors: ${capturedPageErrors.join('; ')}`]),
  ];

  return {
    missingFixtureCalls,
    fixtureExpectationIssues,
    unreadableFixtureDiagnostics,
    errorBoundaryRendered,
    pageErrors: capturedPageErrors,
    failsGate: logParts.length > 0,
    logSuffix: logParts.map((part) => `; ${part}`).join(''),
  };
};
