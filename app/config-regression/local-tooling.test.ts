import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const compose: {
  services: {
    mailpit: {
      profiles: string[];
      ports: string[];
    };
  };
} = parse(readFileSync(join(import.meta.dirname, '..', 'docker-compose.dev.yml'), 'utf8'));

describe('optional local Mailpit', () => {
  it('stays out of db:up and uses Together-specific ports', () => {
    expect(compose.services.mailpit.profiles).toEqual(['mailpit']);
    expect(compose.services.mailpit.ports).toEqual([
      '${MAILPIT_SMTP_PORT:-48925}:1025',
      '${MAILPIT_API_PORT:-48980}:8025',
    ]);
  });
});
