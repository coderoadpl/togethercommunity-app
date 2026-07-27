import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  err,
  ok,
  validation,
  type AppError,
  type Result,
} from '@core/domain/index.js';
import type { Fa3Validator } from '@core/server/index.js';

const schemaPath = fileURLToPath(
  new URL('./xsd/schemat_FA(3)_v1-0E.xsd', import.meta.url),
);

const validate = (xml: string): Promise<Result<void, AppError>> =>
  new Promise((resolve) => {
    const process = spawn(
      'xmllint',
      ['--noout', '--schema', schemaPath, '-'],
      { stdio: ['pipe', 'ignore', 'pipe'], timeout: 10_000 },
    );
    let diagnostic = '';
    process.stderr.setEncoding('utf8');
    process.stderr.on('data', (chunk: string) => {
      diagnostic += chunk;
    });
    process.on('error', () => {
      resolve(ok(undefined));
    });
    process.on('close', (code) => {
      resolve(code === 0
        ? ok(undefined)
        : err(validation('Generated FA(3) failed XSD validation', diagnostic.trim())));
    });
    process.stdin.end(xml, 'utf8');
  });

export const createFa3XsdValidator = (): Fa3Validator => ({ validate });
