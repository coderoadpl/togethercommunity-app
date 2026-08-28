import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

const appRoot = join(import.meta.dirname, '..');
const read = (path: string): string => readFileSync(join(appRoot, path), 'utf8');

const globalOptions = (caddyfile: string): string =>
  /^\{$\n(?<body>[\s\S]*?)^\}$/mu.exec(caddyfile)?.groups?.body ?? '';

const dockerAvailable = ((): boolean => {
  try {
    execFileSync('docker', ['version'], { stdio: 'ignore', timeout: 30_000 });
    return true;
  } catch {
    return false;
  }
})();

const execFailureSchema = z.object({ stderr: z.string() });

const docker = (args: string[]): string => {
  try {
    return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    const failure = execFailureSchema.safeParse(error);
    throw new Error(
      `docker ${args.join(' ')} failed:\n${failure.success ? failure.data.stderr : String(error)}`,
      { cause: error },
    );
  }
};

const dependencySchema = z.object({ condition: z.string() });
const portSchema = z.union([
  z.string(),
  z.object({ target: z.coerce.number().int().positive() }).passthrough(),
]);
const composeSchema = z.object({
  services: z.object({
    postgres: z.object({
      image: z.string(),
      healthcheck: z.object({ test: z.array(z.string()) }),
      volumes: z.array(z.string()),
      ports: z.array(portSchema).optional(),
    }),
    app: z.object({
      build: z.object({ context: z.string(), dockerfile: z.string() }),
      depends_on: z.object({ postgres: dependencySchema }),
      env_file: z.array(z.string()),
      environment: z.record(z.string()),
      ports: z.array(portSchema).optional(),
    }),
    caddy: z.object({
      image: z.string(),
      depends_on: z.object({ app: dependencySchema }),
      ports: z.array(portSchema),
      volumes: z.array(z.string()),
    }),
  }),
  volumes: z.record(z.unknown()),
});

describe('production self-host stack', () => {
  it('boots Postgres, the app, and Caddy from one Compose file', () => {
    const compose = composeSchema.parse(parse(read('docker-compose.yml')));

    expect(Object.keys(compose.services)).toEqual(['postgres', 'app', 'caddy']);
    expect(compose.services.postgres.image).toBe('postgres:16-bookworm');
    expect(compose.services.postgres.healthcheck.test).toContain('pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}');
    expect(compose.services.postgres.volumes).toContain('postgres_data:/var/lib/postgresql/data');
    expect(compose.services.app.build).toEqual({ context: '.', dockerfile: 'Dockerfile' });
    expect(compose.services.app.depends_on.postgres.condition).toBe('service_healthy');
    expect(compose.services.app.env_file).toEqual(['.env']);
    expect(compose.services.app.environment.INTERNAL_PORT).toBe('48732');
    expect(compose.services.app.ports).toBeUndefined();
    expect(compose.services.caddy.depends_on.app.condition).toBe('service_healthy');
    expect(compose.services.caddy.ports).toEqual([
      '${SELF_HOST_HTTP_PORT:-80}:80',
      '${SELF_HOST_HTTPS_PORT:-443}:443',
      '${SELF_HOST_HTTPS_PORT:-443}:443/udp',
    ]);
    expect(Object.keys(compose.volumes)).toEqual(['postgres_data', 'caddy_data', 'caddy_config']);
  });

  it('builds a non-root production image and migrates before serving', () => {
    const dockerfile = read('Dockerfile');
    const entrypoint = read('docker-entrypoint.sh');

    expect(dockerfile).toContain('pnpm install --frozen-lockfile --prod');
    expect(dockerfile).toContain('pnpm exec tsc -p tsconfig.docker.json');
    expect(dockerfile).toContain('USER node');
    expect(dockerfile).toContain('/api/health/ready');
    expect(entrypoint).toContain('node adapters/db/migrate.js');
    expect(entrypoint).toContain('exec node apps/server/src/entry.node.js');
  });

  it('keeps certificate issuance behind the private verified-domain check', () => {
    const caddyfile = read('Caddyfile');
    const compose = composeSchema.parse(parse(read('docker-compose.yml')));

    expect(caddyfile).toContain('on_demand_tls');
    expect(caddyfile).toContain('ask http://app:48732/internal/domain-check');
    expect(caddyfile).toContain('on_demand');
    expect(globalOptions(caddyfile)).toMatch(/servers\s*\{[^{}]*\bstrict_sni_host on\b[^{}]*\}/u);
    expect([...caddyfile.matchAll(/strict_sni_host/gu)]).toHaveLength(1);
    expect(caddyfile).toContain('@local host localhost 127.0.0.1');
    expect(caddyfile).toContain('redir https://{host}{uri} permanent');
    const publishedPorts = Object.values(compose.services).flatMap((service) => service.ports ?? []);
    const targets = publishedPorts.map((port) => {
      if (typeof port !== 'string') return port.target;
      const withoutProtocol = port.split('/')[0] ?? port;
      return Number(withoutProtocol.split(':').at(-1));
    });
    expect(targets).not.toContain(48732);
  });

  it.skipIf(!dockerAvailable)('adapts the Caddyfile with the image the stack ships', () => {
    const compose = composeSchema.parse(parse(read('docker-compose.yml')));
    const output = docker([
      'run', '--rm', '--network', 'none',
      '--volume', `${join(appRoot, 'Caddyfile')}:/etc/caddy/Caddyfile:ro`,
      compose.services.caddy.image,
      'caddy', 'validate', '--adapter', 'caddyfile', '--config', '/etc/caddy/Caddyfile',
    ]);

    expect(output).toContain('Valid configuration');
  }, 300_000);

  it('runs the executable clone-to-panel probe in CI', () => {
    const workflowSchema = z.object({
      jobs: z.object({
        smoke: z.object({
          steps: z.array(z.object({ run: z.string().optional() })),
        }),
      }),
    });
    const workflow = workflowSchema.parse(parse(read('../.github/workflows/ci.yml')));
    const probe = read('scripts/quickstart-probe.ts');

    expect(workflow.jobs.smoke.steps.some((step) => step.run === 'pnpm run quickstart:probe')).toBe(true);
    expect(probe).toContain("'NODE_ENV=production'");
    expect(probe).toContain("'APP_ENV=self-host'");
    expect(probe).toContain("'SECURE_COOKIES=true'");
    expect(probe).toContain("'PAYMENT_PROVIDER=stripe'");
    expect(probe).toContain("'EMAIL_PROVIDER=smtp'");
  });
});
