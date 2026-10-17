import pg from 'pg';

import type { Db } from './client.js';

export const testPoolOf = (db: Db): pg.Pool => {
  if (!('$client' in db) || !(db.$client instanceof pg.Pool)) {
    throw new Error('Expected a node-postgres pool');
  }
  return db.$client;
};
