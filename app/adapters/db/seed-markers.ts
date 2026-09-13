import pg from 'pg';

import {
  SMOKE_TENANT_CREATOR_EMAIL,
  SMOKE_TENANT_ID,
  SMOKE_TENANT_MEMBER_EMAIL,
} from '#core/domain/index.js';

import { normalizeDatabaseConnectionString } from './client.js';

interface SeedMarkerRow {
  present: boolean;
}

export const seedMarkersPresent = async (connectionString: string): Promise<boolean> => {
  const pool = new pg.Pool({ connectionString: normalizeDatabaseConnectionString(connectionString) });
  try {
    const result = await pool.query<SeedMarkerRow>(
      `
        select exists (
          select 1 from tenants where id = $1
          union all
          select 1 from "user" where email = any($2::text[])
        ) as present
      `,
      [SMOKE_TENANT_ID, [SMOKE_TENANT_CREATOR_EMAIL, SMOKE_TENANT_MEMBER_EMAIL]],
    );
    return result.rows[0]?.present === true;
  } finally {
    await pool.end();
  }
};
