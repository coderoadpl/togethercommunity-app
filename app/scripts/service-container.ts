import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

type Env = Readonly<Record<string, string | undefined>>;

export interface CommandResult {
  code: number;
  output: string;
}

export interface ServiceSpec {
  name: string;
  image: string;
  port: string;
  env: string[];
  healthCmd: string;
  healthInterval: string;
  healthTimeout: string;
  healthRetries: string;
}

export interface ServiceDeps {
  docker: (args: string[]) => Promise<CommandResult>;
  sleep: (milliseconds: number) => Promise<void>;
  now: () => number;
  random: () => number;
  log: (line: string) => void;
}

export interface StartFailure {
  infrastructure: boolean;
  problem: string;
  lastMessage: string;
}

export type StartResult =
  | { ok: true; pullAttempts: number }
  | ({ ok: false } & StartFailure);

export const MAX_PULL_ATTEMPTS = 6;
export const HEALTH_WAIT_MS = 180_000;
export const HEALTH_POLL_MS = 2_000;

export const isTransientPullFailure = (output: string): boolean =>
  /toomanyrequests|Rate exceeded|TLS handshake timeout|unexpected EOF|connection reset/i.test(output);

export const backoffDelayMs = (attempt: number, random: () => number): number =>
  Math.min(2000 * 2 ** (attempt - 1), 30_000) + Math.floor(random() * 1000);

const required = (env: Env, key: string): string => {
  const value = env[key]?.trim() ?? '';
  if (value === '') throw new Error(`service-container: ${key} is not set`);
  return value;
};

const matching = (value: string, key: string, pattern: RegExp): string => {
  if (!pattern.test(value)) throw new Error(`service-container: ${key} "${value}" must match ${String(pattern)}`);
  return value;
};

const duration = /^[1-9][0-9]*(ms|s|m)$/;

export const parseServiceSpec = (env: Env): ServiceSpec => {
  const pairs = (env['SERVICE_CONTAINER_ENV'] ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  for (const pair of pairs) matching(pair, 'SERVICE_CONTAINER_ENV entry', /^[A-Za-z_][A-Za-z0-9_]*=/);
  return {
    name: matching(required(env, 'SERVICE_CONTAINER_NAME'), 'SERVICE_CONTAINER_NAME', /^[a-z0-9][a-z0-9_.-]*$/),
    image: required(env, 'SERVICE_CONTAINER_IMAGE'),
    port: matching(required(env, 'SERVICE_CONTAINER_PORT'), 'SERVICE_CONTAINER_PORT', /^[0-9]{1,5}:[0-9]{1,5}$/),
    env: pairs,
    healthCmd: required(env, 'SERVICE_CONTAINER_HEALTH_CMD'),
    healthInterval: matching(required(env, 'SERVICE_CONTAINER_HEALTH_INTERVAL'), 'SERVICE_CONTAINER_HEALTH_INTERVAL', duration),
    healthTimeout: matching(required(env, 'SERVICE_CONTAINER_HEALTH_TIMEOUT'), 'SERVICE_CONTAINER_HEALTH_TIMEOUT', duration),
    healthRetries: matching(required(env, 'SERVICE_CONTAINER_HEALTH_RETRIES'), 'SERVICE_CONTAINER_HEALTH_RETRIES', /^[1-9][0-9]*$/),
  };
};

export const runArguments = (spec: ServiceSpec): string[] => [
  'run',
  '--detach',
  '--pull',
  'never',
  '--name',
  spec.name,
  '--publish',
  spec.port,
  ...spec.env.flatMap((pair) => ['--env', pair]),
  '--health-cmd',
  spec.healthCmd,
  '--health-interval',
  spec.healthInterval,
  '--health-timeout',
  spec.healthTimeout,
  '--health-retries',
  spec.healthRetries,
  spec.image,
];

export const lastMessage = (output: string): string => {
  const lines = output.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  return lines.filter((line) => !line.includes('--help')).at(-1) ?? lines.at(-1) ?? '(no output)';
};

const logFailedCommand = (deps: ServiceDeps, args: string[], result: CommandResult): void => {
  deps.log(`docker ${args[0] ?? ''} exited with ${String(result.code)}:\n${result.output}`);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

interface ContainerState {
  status: string;
  health: string | null;
  lastProbe: string | null;
}

export const parseContainerState = (output: string): ContainerState | null => {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    return null;
  }
  if (!isRecord(value) || typeof value['Status'] !== 'string') return null;
  const health = value['Health'];
  if (!isRecord(health)) return { status: value['Status'], health: null, lastProbe: null };
  const probes = Array.isArray(health['Log']) ? health['Log'] : [];
  const last: unknown = probes.at(-1);
  return {
    status: value['Status'],
    health: typeof health['Status'] === 'string' ? health['Status'] : null,
    lastProbe: isRecord(last) && typeof last['Output'] === 'string' ? lastMessage(last['Output']) : null,
  };
};

const pullImage = async (spec: ServiceSpec, deps: ServiceDeps): Promise<StartResult> => {
  for (let attempt = 1; ; attempt += 1) {
    const args = ['pull', spec.image];
    const result = await deps.docker(args);
    if (result.code === 0) return { ok: true, pullAttempts: attempt };
    const transient = isTransientPullFailure(result.output);
    if (!transient || attempt === MAX_PULL_ATTEMPTS) {
      logFailedCommand(deps, args, result);
      return {
        ok: false,
        infrastructure: transient,
        problem: `could not pull ${spec.image} after ${String(attempt)} attempt(s)${transient ? ' (registry throttling or a network error)' : ''}`,
        lastMessage: lastMessage(result.output),
      };
    }
    const wait = backoffDelayMs(attempt, deps.random);
    deps.log(`docker pull failed with a transient error (attempt ${String(attempt)}/${String(MAX_PULL_ATTEMPTS)}): ${lastMessage(result.output)}; retrying in ${String(Math.round(wait / 1000))} s`);
    await deps.sleep(wait);
  }
};

const waitHealthy = async (spec: ServiceSpec, deps: ServiceDeps): Promise<StartResult | null> => {
  const deadline = deps.now() + HEALTH_WAIT_MS;
  let state: ContainerState | null = null;
  for (;;) {
    const inspected = await deps.docker(['inspect', '--format', '{{json .State}}', spec.name]);
    state = inspected.code === 0 ? parseContainerState(inspected.output) : null;
    if (state?.health === 'healthy') return null;
    if (state !== null && (state.health === 'unhealthy' || state.status === 'exited' || state.status === 'dead')) break;
    if (deps.now() >= deadline) break;
    await deps.sleep(HEALTH_POLL_MS);
  }
  const logs = await deps.docker(['logs', '--tail', '50', spec.name]);
  deps.log(logs.output);
  const observed = state === null ? 'unknown' : `${state.status}, health ${state.health ?? 'none'}`;
  return {
    ok: false,
    infrastructure: false,
    problem: `container ${spec.name} did not become healthy within ${String(HEALTH_WAIT_MS / 1000)} s (state: ${observed})`,
    lastMessage: state?.lastProbe ?? lastMessage(logs.output),
  };
};

export const startServiceContainer = async (spec: ServiceSpec, deps: ServiceDeps): Promise<StartResult> => {
  const pulled = await pullImage(spec, deps);
  if (!pulled.ok) return pulled;
  const args = runArguments(spec);
  const started = await deps.docker(args);
  if (started.code !== 0) {
    logFailedCommand(deps, args, started);
    return {
      ok: false,
      infrastructure: false,
      problem: `could not start container ${spec.name}`,
      lastMessage: lastMessage(started.output),
    };
  }
  return await waitHealthy(spec, deps) ?? pulled;
};

const annotation = (value: string): string =>
  value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

export const failureAnnotation = (failure: StartFailure): string =>
  failure.infrastructure
    ? `::error title=CI infrastructure::${annotation(
      `CI infrastructure failure (image pull), not a test failure: ${failure.problem}. Last message: ${failure.lastMessage}`,
    )}`
    : `::error title=Service container::${annotation(
      `Service container failure: ${failure.problem}. Last message: ${failure.lastMessage}. If this pull request changed the image reference, the container environment or the health command, check them.`,
    )}`;

const runDocker = (args: string[]): Promise<CommandResult> =>
  new Promise((resolve) => {
    const child = spawn('docker', args);
    let output = '';
    child.stdout.on('data', (chunk) => { output += String(chunk); });
    child.stderr.on('data', (chunk) => { output += String(chunk); });
    child.once('error', (error) => resolve({ code: 1, output: `${output}${String(error)}` }));
    child.once('close', (code) => resolve({ code: code ?? 1, output }));
  });

const main = async (env: Env): Promise<number> => {
  const spec = parseServiceSpec(env);
  const result = await startServiceContainer(spec, {
    docker: runDocker,
    sleep: async (milliseconds) => { await delay(milliseconds); },
    now: Date.now,
    random: Math.random,
    log: (line) => { process.stdout.write(`${line}\n`); },
  });
  if (!result.ok) {
    process.stdout.write(`${failureAnnotation(result)}\n`);
    return 1;
  }
  process.stdout.write(`${spec.name} is healthy, published on localhost as ${spec.port} (${spec.image})\n`);
  return 0;
};

const invokedDirectly =
  process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main(process.env).then((code) => {
    process.exitCode = code;
  }, (cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    process.stdout.write(`::error title=service-container::${annotation(message)}\n`);
    process.exitCode = 1;
  });
}
