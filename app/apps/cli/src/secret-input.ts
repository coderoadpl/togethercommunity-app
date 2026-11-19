import { err, ok, validation, type AppError, type Result } from '#core/domain/index.js';

export const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString('utf8');
};

export const secretInput = async (envName: string | undefined, label: string): Promise<Result<string, AppError>> => {
  const value = envName === undefined ? (await readStdin()).trim() : process.env[envName]?.trim();
  if (value) return ok(value);
  return err(validation(envName === undefined
    ? `Pipe the ${label} on stdin or name an environment variable holding it`
    : `Environment variable ${envName} must hold the ${label}`));
};
