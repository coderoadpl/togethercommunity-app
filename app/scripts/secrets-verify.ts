import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { secretFingerprint } from '#adapters/crypto/secret-fingerprint.js';
import { createApiClient } from '#core/client/index.js';
import type { SecretFingerprint } from '#core/contract/index.js';
import { secureApiOrigin } from '#core/domain/network.js';

type LocalEnv = Readonly<Record<string, string | undefined>>;

export type SecretVerdict =
  | { name: string; outcome: 'MATCH' | 'NOT SET ON SERVER' | 'NOT IN LOCAL ENV' }
  | { name: string; outcome: 'MISMATCH'; trimmedMatches: boolean; serverAddsLineBreak: boolean };

const USAGE = 'usage: pnpm --silent run secrets:verify -- --base-url <https://host> [--auth-with <NAME>]';

const present = (value: string | undefined): value is string => value !== undefined && value !== '';

export const compareSecretFingerprints = (
  server: readonly SecretFingerprint[],
  local: LocalEnv,
): SecretVerdict[] =>
  server.map((entry): SecretVerdict => {
    const value = local[entry.name];
    if (!present(value)) return { name: entry.name, outcome: 'NOT IN LOCAL ENV' };
    if (!entry.set) return { name: entry.name, outcome: 'NOT SET ON SERVER' };
    const matches = (candidate: string): boolean => secretFingerprint(entry.name, candidate) === entry.fingerprint;
    if (matches(value)) return { name: entry.name, outcome: 'MATCH' };
    return {
      name: entry.name,
      outcome: 'MISMATCH',
      trimmedMatches: matches(value.trim()),
      serverAddsLineBreak: matches(`${value}\n`) || matches(`${value}\r\n`),
    };
  });

export const verificationPassed = (verdicts: readonly SecretVerdict[]): boolean =>
  verdicts.some((verdict) => verdict.outcome === 'MATCH')
  && verdicts.every((verdict) => verdict.outcome === 'MATCH' || verdict.outcome === 'NOT IN LOCAL ENV');

export const formatVerdict = (verdict: SecretVerdict): string => {
  const line = `${verdict.outcome.padEnd(17)} ${verdict.name}`;
  if (verdict.outcome !== 'MISMATCH') return line;
  const trimmed = verdict.trimmedMatches
    ? 'trimmed local value matches (whitespace difference)'
    : 'trimmed local value does not match either';
  return verdict.serverAddsLineBreak
    ? `${line}  ${trimmed}; the server value is the local value followed by a line break`
    : `${line}  ${trimmed}`;
};

const OPERATOR_SECRET_NAMES: readonly string[] = ['OPERATOR_SECRET', 'PROD_OPERATOR_SECRET', 'STAGING_OPERATOR_SECRET'];

const parseOptions = (argv: readonly string[]): { baseUrl: string; authWith: string | undefined } | null => {
  try {
    const { values } = parseArgs({
      args: argv[0] === '--' ? argv.slice(1) : [...argv],
      options: { 'base-url': { type: 'string' }, 'auth-with': { type: 'string' } },
      strict: true,
    });
    const raw = values['base-url'];
    const baseUrl = raw === undefined ? null : secureApiOrigin(raw);
    return baseUrl === null ? null : { baseUrl, authWith: values['auth-with'] };
  } catch {
    return null;
  }
};

const selectOperatorSecret = (
  local: LocalEnv,
  authWith: string | undefined,
): { ok: true; secret: string } | { ok: false; message: string } => {
  const presentSecrets = OPERATOR_SECRET_NAMES.flatMap((name) => {
    const value = local[name];
    return present(value) ? [{ name, value }] : [];
  });
  if (authWith !== undefined) {
    if (!OPERATOR_SECRET_NAMES.includes(authWith)) {
      return { ok: false, message: `--auth-with must be one of ${OPERATOR_SECRET_NAMES.join(', ')}` };
    }
    const chosen = presentSecrets.find((entry) => entry.name === authWith);
    return chosen === undefined
      ? { ok: false, message: `--auth-with ${authWith} is not set in the local environment` }
      : { ok: true, secret: chosen.value };
  }
  const [only, ...others] = presentSecrets;
  if (only === undefined) {
    return { ok: false, message: `one of ${OPERATOR_SECRET_NAMES.join(', ')} is required in the environment` };
  }
  if (others.length > 0) {
    const names = presentSecrets.map((entry) => entry.name).join(', ');
    return { ok: false, message: `${names} are all set; choose the one the target host accepts with --auth-with <NAME>` };
  }
  return { ok: true, secret: only.value };
};

export const runSecretsVerify = async (input: {
  argv: readonly string[];
  env: LocalEnv;
  write: (line: string) => void;
  fetchImpl?: typeof fetch;
}): Promise<number> => {
  const options = parseOptions(input.argv);
  if (options === null) {
    input.write(USAGE);
    input.write('secrets:verify: --base-url must be an https URL, or http on a local host');
    return 2;
  }
  const operatorSecret = selectOperatorSecret(input.env, options.authWith);
  if (!operatorSecret.ok) {
    input.write(`secrets:verify: ${operatorSecret.message}`);
    return 2;
  }
  const { baseUrl } = options;
  const api = createApiClient({ baseUrl, ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }) });
  const result = await api.getSecretFingerprints(operatorSecret.secret);
  if (!result.ok) {
    input.write(`secrets:verify: FAIL ${result.error.code}: ${result.error.message}`);
    return 1;
  }
  const verdicts = compareSecretFingerprints(result.value.secrets, input.env);
  for (const verdict of verdicts) input.write(formatVerdict(verdict));
  const passed = verificationPassed(verdicts);
  const matched = verdicts.filter((verdict) => verdict.outcome === 'MATCH').length;
  input.write(`secrets:verify: ${passed ? 'PASS' : 'FAIL'} (${String(matched)} of ${String(verdicts.length)} matched)`);
  return passed ? 0 : 1;
};

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  process.exitCode = await runSecretsVerify({
    argv: process.argv.slice(2),
    env: process.env,
    write: (line) => { process.stdout.write(`${line}\n`); },
  });
}
