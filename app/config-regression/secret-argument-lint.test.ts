import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { collectSecretArgumentProblems } from '../scripts/secret-argument-lint.js';

const surfaces = ['app/docs/shop-management-keys.md', 'app/docs/cli.md'];
const appRoot = join(import.meta.dirname, '..');

const lint = (shell: string, language = 'bash') =>
  collectSecretArgumentProblems(new Map([['app/docs/guide.md', `Intro\n\n\`\`\`${language}\n${shell}\n\`\`\`\n`]]), ['app/docs/guide.md']);

describe('secret argument lint', () => {
  it('finds no secret in a process argument in the shop key guide or the CLI guide', () => {
    const files = new Map(surfaces.map((rel) => [rel, readFileSync(join(appRoot, '..', rel), 'utf8')]));
    expect(collectSecretArgumentProblems(files, surfaces)).toEqual([]);
  });

  it.each([
    'KEY="x-api-key: $TOGETHER_SHOP_KEY"',
    'curl -s -H "x-api-key: ${SHOP_KEY}" "$SHOP/products"',
    'curl -s -H "Authorization: Bearer $OWNER_TOKEN" "$API/api-keys"',
    'curl -s -H "$KEY" -H "$JSON" -d "{\\"key\\":\\"ksef.token\\",\\"value\\":\\"$KSEF_TOKEN\\"}" "$SHOP/integrations/secrets"',
    'curl -s -H "$KEY" -H "$JSON" -d "{\\"mode\\":\\"test\\",\\"restrictedKey\\":\\"$STRIPE_RESTRICTED_KEY\\"}" "$SHOP/integrations/stripe/configure"',
    'curl -s -H "$KEY" --data-raw "$STORAGE_SECRET" "$SHOP/integrations/storage/configure"',
    'pnpm --silent run cli shop integrations shipx configure --token "$SHIPX_TOKEN"',
    'pnpm --silent run cli shop integrations storage configure --secret-access-key=$STORAGE_SECRET',
    "curl -s -X PUT -H 'content-type: image/png' --data-binary @cover.png '<signed-storage-url>'",
    'curl -s -X PUT -H \'content-type: image/png\' --data-binary @cover.png "$UPLOAD_URL"',
    'curl -s -X PUT --data-binary @cover.png "$(jq -r .data.upload.url cover-upload.json)"',
  ])('rejects %s', (line) => {
    expect(lint(line)).toEqual([expect.stringMatching(/^\[secret-argument\] app\/docs\/guide\.md:4 /)]);
  });

  it.each([
    'curl -s -H @shop-key.header "$SHOP/products"',
    "printf 'x-api-key: %s\\n' \"$TOGETHER_SHOP_KEY\" > shop-key.header",
    'curl -s -H "$KEY" -H "$JSON" -d \'{"id":"<product-id>"}\' "$SHOP/products/publish"',
    'jq -Rs \'{key:"ksef.token",value:rtrimstr("\\n")}\' < ksef-token.txt | curl -s -H "$KEY" -H "$JSON" --data-binary @- "$SHOP/integrations/secrets"',
    'pnpm --silent run cli shop integrations stripe configure --mode test --restricted-key-env STRIPE_RESTRICTED_KEY',
    'pnpm --silent run cli shop integrations storage configure --access-key-id "$STORAGE_KEY_ID" --secret-access-key-env STORAGE_SECRET',
    'pnpm --silent run cli shop products list --api-key-env CATALOG_KEY',
    'jq -r \'"url = \\"\\(.data.upload.url)\\""\' cover-upload.json | curl -s -K - -X PUT -H \'content-type: image/png\' --data-binary @cover.png',
  ])('accepts %s', (line) => {
    expect(lint(line)).toEqual([]);
  });

  it('reads only shell code blocks', () => {
    expect(lint('Authorization: Bearer $OWNER_TOKEN', 'http')).toEqual([]);
  });

  it('reports a surface that is not tracked markdown', () => {
    expect(collectSecretArgumentProblems(new Map(), ['app/docs/missing.md'])).toEqual(['[secret-argument] app/docs/missing.md is not tracked markdown']);
  });
});
