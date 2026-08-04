import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const [aPath, bPath, diffPath] = process.argv.slice(2);
const require = createRequire(import.meta.url);
const pixelmatchCli = require.resolve('pixelmatch/bin/pixelmatch');
const args = [pixelmatchCli, aPath, bPath];
if (diffPath) args.push(diffPath, '0.1');
const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
if (result.error) throw result.error;
if (result.status !== 0 && result.status !== 66) {
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(1);
}
const match = /different pixels: (\d+)/.exec(result.stdout);
const mismatched = Number(match?.[1] ?? 0);
const header = readFileSync(aPath).subarray(0, 24);
const pixels = header.readUInt32BE(16) * header.readUInt32BE(20);
const pct = ((mismatched / pixels) * 100).toFixed(2);
console.log(`${mismatched} px differ (${pct}%)`);
