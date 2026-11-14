import { googleFakeConfigFromEnv, installGoogleFetchFake } from './google-fake.js';

installGoogleFetchFake(googleFakeConfigFromEnv(process.env));
await import('../apps/server/src/entry.node.js');
