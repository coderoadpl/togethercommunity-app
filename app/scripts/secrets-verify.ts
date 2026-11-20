import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { secretFingerprint } from '#adapters/crypto/secret-fingerprint.js';
import { createApiClient } from '#core/client/index.js';
import { SECRET_FINGERPRINT_NAMES, type SecretFingerprint } from '#core/contract/index.js';
import { secureApiBaseUrl } from '#core/domain/network.js';

type LocalEnv = Readonly<Record<string, string | undefined>>;

export type SecretVerdict =
  | { name: string; outcome: 'MATCH' | 'NOT SET ON SERVER' | 'NOT IN LOCAL ENV' | 'NOT LISTED BY SERVER' }
  | { name: string; outcome: 'MISMATCH'; trimmedMatches: boolean; serverAddsLineBreak: boolean };

const USAGE = 'usage: pnpm --silent run secrets:verify -- --base-url <https://host>';

const present = (value: string | undefined): value is string => value !== undefined && value !== '';

const compareListed = (entry: SecretFingerprint, local: LocalEnv): SecretVerdict => {
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
};

export const compareSecretFingerprints = (
  server: readonly SecretFingerprint[],
  local: LocalEnv,
): SecretVerdict[] => {
  const listed = new Set(server.map((entry) => entry.name));
  const unlisted = SECRET_FINGERPRINT_NAMES
    .filter((name) => present(local[name]) && !listed.has(name))
    .map((name): SecretVerdict => ({ name, outcome: 'NOT LISTED BY SERVER' }));
  return [...server.map((entry) => compareListed(entry, local)), ...unlisted];
};

export const verificationPassed = (verdicts: readonly SecretVerdict[]): boolean =>
  verdicts.some((verdict) => verdict.outcome === 'MATCH')
  && verdicts.every((verdict) => verdict.outcome === 'MATCH' || verdict.outcome === 'NOT IN LOCAL ENV');

export const formatVerdict = (verdict: SecretVerdict): string => {
  const line = `${verdict.outcome.padEnd(20)} ${verdict.name}`;
  if (verdict.outcome !== 'MISMATCH') return line;
  const trimmed = verdict.trimmedMatches
    ? 'trimmed local value matches (whitespace difference)'
    : 'trimmed local value does not match either';
  return verdict.serverAddsLineBreak
    ? `${line}  ${trimmed}; the server value is the local value followed by a line break`
    : `${line}  ${trimmed}`;
};

const ARGUMENT_ERRORS: Readonly<Record<string, string>> = {
  ERR_PARSE_ARGS_INVALID_OPTION_VALUE: '--base-url needs a value',
  ERR_PARSE_ARGS_UNKNOWN_OPTION: 'unknown option; only --base-url is accepted',
  ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL: 'unexpected argument; pass a value only to --base-url',
};

const argumentErrorMessage = (error: unknown): string => {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  return (typeof code === 'string' ? ARGUMENT_ERRORS[code] : undefined) ?? 'invalid arguments';
};

const parseOptions = (
  argv: readonly string[],
): { ok: true; baseUrl: string } | { ok: false; message: string } => {
  let values: { 'base-url'?: string };
  try {
    ({ values } = parseArgs({
      args: argv[0] === '--' ? argv.slice(1) : [...argv],
      options: { 'base-url': { type: 'string' } },
      strict: true,
    }));
  } catch (error) {
    return { ok: false, message: argumentErrorMessage(error) };
  }
  const raw = values['base-url'];
  const baseUrl = raw === undefined ? null : secureApiBaseUrl(raw);
  return baseUrl === null
    ? { ok: false, message: '--base-url must be an https URL, or http on a local host, without a query or fragment' }
    : { ok: true, baseUrl };
};

const READ_SECRET_NAME = 'SECRET_FINGERPRINT_READ_SECRET';

export const runSecretsVerify = async (input: {
  argv: readonly string[];
  env: LocalEnv;
  write: (line: string) => void;
  fetchImpl?: typeof fetch;
}): Promise<number> => {
  const options = parseOptions(input.argv);
  if (!options.ok) {
    input.write(USAGE);
    input.write(`secrets:verify: ${options.message}`);
    return 2;
  }
  const readSecret = input.env[READ_SECRET_NAME];
  if (!present(readSecret)) {
    input.write(`secrets:verify: ${READ_SECRET_NAME} is required in the environment`);
    return 2;
  }
  const { baseUrl } = options;
  const api = createApiClient({ baseUrl, ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }) });
  const result = await api.getSecretFingerprints(readSecret);
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
