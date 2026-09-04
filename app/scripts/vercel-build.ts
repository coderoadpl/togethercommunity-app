import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { isProductionEnvironment, resettableEnvironment } from '#core/domain/index.js';

const appRoot = join(import.meta.dirname, '..');

const run = (command: string, args: readonly string[]): void => {
  const result = spawnSync(command, [...args], { cwd: appRoot, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

const reseedOnDeploy =
  process.env['STAGING_RESEED_ON_DEPLOY'] === 'true'
  && resettableEnvironment(process.env['APP_ENV']) !== null
  && !isProductionEnvironment(process.env);

run('pnpm', ['run', 'db:migrate']);
if (reseedOnDeploy) run('pnpm', ['exec', 'tsx', 'adapters/db/reseed.ts']);
run('pnpm', ['run', 'build']);
