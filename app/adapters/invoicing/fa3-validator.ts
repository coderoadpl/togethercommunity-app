import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  err,
  integrationUnavailable,
  ok,
  validation,
  type AppError,
  type Result,
} from '@core/domain/index.js';
import type { Fa3Validator } from '@core/server/index.js';

const schemaPath = fileURLToPath(
  new URL('./xsd/schemat_FA(3)_v1-0E.xsd', import.meta.url),
);

const validate = (executable: string, xml: string): Promise<Result<void, AppError>> =>
  new Promise((resolve) => {
    const process = spawn(
      executable,
      ['--noout', '--schema', schemaPath, '-'],
      { stdio: ['pipe', 'ignore', 'pipe'], timeout: 10_000 },
    );
    let diagnostic = '';
    process.stderr.setEncoding('utf8');
    process.stderr.on('data', (chunk: string) => {
      diagnostic += chunk;
    });
    process.stdin.on('error', () => undefined);
    process.on('error', (cause) => {
      resolve(err(integrationUnavailable(`FA(3) XSD validator is unavailable: ${cause.message}`)));
    });
    process.on('close', (code) => {
      resolve(code === 0
        ? ok(undefined)
        : err(validation('Generated FA(3) failed XSD validation', diagnostic.trim())));
    });
    process.stdin.end(xml, 'utf8');
  });

export const createFa3XsdValidator = (
  options: { executable?: string } = {},
): Fa3Validator => ({
  validate: (xml) => validate(options.executable ?? 'xmllint', xml),
});
