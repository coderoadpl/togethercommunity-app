import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

const erasedPersonalization = (line: SQL, display: string): SQL => sql`(${line}->'personalization')
  || jsonb_build_object('text', ${display}::text)
  || case when (${line}->'personalization') ? 'originalText' then jsonb_build_object('originalText', ${display}::text) else '{}'::jsonb end`;

export const erasedPersonalizationLines = (lines: AnyPgColumn, display: string): SQL => sql`(
  select coalesce(jsonb_agg(
    case when jsonb_typeof(entry.line->'personalization') = 'object'
      then jsonb_set(entry.line, '{personalization}', ${erasedPersonalization(sql`entry.line`, display)})
      else entry.line
    end order by entry.position), '[]'::jsonb)
  from jsonb_array_elements(${lines}) with ordinality as entry(line, position)
)`;

export const linesHavePersonalization = (lines: AnyPgColumn): SQL => sql`jsonb_typeof(${lines}) = 'array' and exists (
  select 1 from jsonb_array_elements(${lines}) as entry(line) where jsonb_typeof(entry.line->'personalization') = 'object'
)`;

export const erasedPurchasePersonalizations = (payload: AnyPgColumn, display: string): SQL => sql`jsonb_set(${payload}, '{purchase,personalizations}', (
  select coalesce(jsonb_agg(entry.item || jsonb_build_object('text', ${display}::text) order by entry.position), '[]'::jsonb)
  from jsonb_array_elements(${payload}#>'{purchase,personalizations}') with ordinality as entry(item, position)
))`;

export const purchaseHasPersonalizations = (payload: AnyPgColumn): SQL =>
  sql`jsonb_typeof(${payload}#>'{purchase,personalizations}') = 'array'`;
