import { sql, type SQL } from 'drizzle-orm';

import { createContentHash } from '#adapters/crypto/content-hash.js';

import type { Db } from './client.js';

type ColumnFact = {
  name: string;
  type: string;
  notNull: boolean;
  default: string | null;
  identity: string;
  generated: string;
};

type TableFact = {
  name: string;
  columns: ColumnFact[];
};

type RelationDefinitionFact = {
  table: string;
  name: string;
  definition: string;
};

type FunctionFact = {
  name: string;
  arguments: string;
  definition: string;
};

type SequenceFact = {
  name: string;
  dataType: string;
  start: string;
  increment: string;
  minimum: string;
  maximum: string;
  cycle: boolean;
};

type ViewFact = {
  name: string;
  definition: string;
};

export type SchemaSnapshot = {
  tables: TableFact[];
  constraints: RelationDefinitionFact[];
  indexes: RelationDefinitionFact[];
  triggers: RelationDefinitionFact[];
  functions: FunctionFact[];
  sequences: SequenceFact[];
  views: ViewFact[];
};

const rowsOf = (result: unknown): unknown[] => {
  if (
    typeof result !== 'object' ||
    result === null ||
    !('rows' in result) ||
    !Array.isArray(result.rows)
  ) {
    throw new Error('Schema introspection query did not return rows');
  }
  return result.rows;
};

const rawField = (row: unknown, field: string): unknown => {
  if (typeof row !== 'object' || row === null || !(field in row)) {
    throw new Error(`Schema introspection query did not return ${field}`);
  }
  return Object.entries(row).find(([key]) => key === field)?.[1];
};

const textField = (row: unknown, field: string): string => {
  const value = rawField(row, field);
  if (typeof value !== 'string') {
    throw new Error(`Schema introspection query returned a non-text ${field}`);
  }
  return value;
};

const nullableTextField = (row: unknown, field: string): string | null => {
  const value = rawField(row, field);
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new Error(`Schema introspection query returned a non-text ${field}`);
  }
  return value;
};

const booleanField = (row: unknown, field: string): boolean => {
  const value = textField(row, field);
  if (value !== 'true' && value !== 'false') {
    throw new Error(`Schema introspection query returned a non-boolean ${field}`);
  }
  return value === 'true';
};

const normalizeDefinition = (definition: string): string =>
  definition.replaceAll(/\s+/g, ' ').trim().replaceAll('public.', '');

const queryRows = async (db: Db, statement: SQL): Promise<unknown[]> =>
  rowsOf(await db.execute(statement));

const tableNames = async (db: Db): Promise<string[]> => {
  const rows = await queryRows(
    db,
    sql`select cls.relname as name
        from pg_class cls
        join pg_namespace nsp on nsp.oid = cls.relnamespace
        where nsp.nspname = 'public' and cls.relkind in ('r', 'p')
        order by cls.relname`,
  );
  return rows.map((row) => textField(row, 'name'));
};

const columnsByTable = async (db: Db): Promise<Map<string, ColumnFact[]>> => {
  const rows = await queryRows(
    db,
    sql`select cls.relname as table_name,
               att.attname as name,
               format_type(att.atttypid, att.atttypmod) as type,
               att.attnotnull::text as not_null,
               pg_get_expr(def.adbin, def.adrelid) as column_default,
               att.attidentity::text as identity,
               att.attgenerated::text as generated
        from pg_attribute att
        join pg_class cls on cls.oid = att.attrelid
        join pg_namespace nsp on nsp.oid = cls.relnamespace
        left join pg_attrdef def on def.adrelid = att.attrelid and def.adnum = att.attnum
        where nsp.nspname = 'public'
          and cls.relkind in ('r', 'p')
          and att.attnum > 0
          and not att.attisdropped
        order by cls.relname, att.attname`,
  );
  const grouped = new Map<string, ColumnFact[]>();
  for (const row of rows) {
    const table = textField(row, 'table_name');
    const columnDefault = nullableTextField(row, 'column_default');
    const column: ColumnFact = {
      name: textField(row, 'name'),
      type: textField(row, 'type'),
      notNull: booleanField(row, 'not_null'),
      default: columnDefault === null ? null : normalizeDefinition(columnDefault),
      identity: textField(row, 'identity'),
      generated: textField(row, 'generated'),
    };
    const columns = grouped.get(table);
    if (columns === undefined) grouped.set(table, [column]);
    else columns.push(column);
  }
  return grouped;
};

const relationDefinitions = async (db: Db, statement: SQL): Promise<RelationDefinitionFact[]> => {
  const rows = await queryRows(db, statement);
  return rows.map((row) => ({
    table: textField(row, 'table_name'),
    name: textField(row, 'name'),
    definition: normalizeDefinition(textField(row, 'definition')),
  }));
};

const constraintsStatement = sql`select rel.relname as table_name,
                                        con.conname as name,
                                        pg_get_constraintdef(con.oid) as definition
                                 from pg_constraint con
                                 join pg_class rel on rel.oid = con.conrelid
                                 join pg_namespace nsp on nsp.oid = con.connamespace
                                 where nsp.nspname = 'public' and con.contype in ('p', 'u', 'f', 'c')
                                 order by rel.relname, con.conname`;

const indexesStatement = sql`select rel.relname as table_name,
                                    idx.relname as name,
                                    pg_get_indexdef(ind.indexrelid) as definition
                             from pg_index ind
                             join pg_class idx on idx.oid = ind.indexrelid
                             join pg_class rel on rel.oid = ind.indrelid
                             join pg_namespace nsp on nsp.oid = idx.relnamespace
                             where nsp.nspname = 'public'
                               and not exists (
                                 select 1 from pg_constraint con where con.conindid = ind.indexrelid
                               )
                             order by rel.relname, idx.relname`;

const triggersStatement = sql`select rel.relname as table_name,
                                     trg.tgname as name,
                                     pg_get_triggerdef(trg.oid) as definition
                              from pg_trigger trg
                              join pg_class rel on rel.oid = trg.tgrelid
                              join pg_namespace nsp on nsp.oid = rel.relnamespace
                              where nsp.nspname = 'public' and not trg.tgisinternal
                              order by rel.relname, trg.tgname`;

const functions = async (db: Db): Promise<FunctionFact[]> => {
  const rows = await queryRows(
    db,
    sql`select pro.proname as name,
               pg_get_function_identity_arguments(pro.oid) as arguments,
               pg_get_functiondef(pro.oid) as definition
        from pg_proc pro
        join pg_namespace nsp on nsp.oid = pro.pronamespace
        where nsp.nspname = 'public' and pro.prokind = 'f'
        order by pro.proname, pg_get_function_identity_arguments(pro.oid)`,
  );
  return rows.map((row) => ({
    name: textField(row, 'name'),
    arguments: normalizeDefinition(textField(row, 'arguments')),
    definition: normalizeDefinition(textField(row, 'definition')),
  }));
};

const sequences = async (db: Db): Promise<SequenceFact[]> => {
  const rows = await queryRows(
    db,
    sql`select sequence_name::text as name,
               data_type::text as data_type,
               start_value::text as start_value,
               increment::text as increment,
               minimum_value::text as minimum_value,
               maximum_value::text as maximum_value,
               (cycle_option = 'YES')::text as cycle
        from information_schema.sequences
        where sequence_schema = 'public'
        order by sequence_name`,
  );
  return rows.map((row) => ({
    name: textField(row, 'name'),
    dataType: textField(row, 'data_type'),
    start: textField(row, 'start_value'),
    increment: textField(row, 'increment'),
    minimum: textField(row, 'minimum_value'),
    maximum: textField(row, 'maximum_value'),
    cycle: booleanField(row, 'cycle'),
  }));
};

const views = async (db: Db): Promise<ViewFact[]> => {
  const rows = await queryRows(
    db,
    sql`select cls.relname as name, pg_get_viewdef(cls.oid, true) as definition
        from pg_class cls
        join pg_namespace nsp on nsp.oid = cls.relnamespace
        where nsp.nspname = 'public' and cls.relkind in ('v', 'm')
        order by cls.relname`,
  );
  return rows.map((row) => ({
    name: textField(row, 'name'),
    definition: normalizeDefinition(textField(row, 'definition')),
  }));
};

export const introspectSchema = async (db: Db): Promise<SchemaSnapshot> => {
  const [names, columns] = await Promise.all([tableNames(db), columnsByTable(db)]);
  return {
    tables: names.map((name) => ({ name, columns: columns.get(name) ?? [] })),
    constraints: await relationDefinitions(db, constraintsStatement),
    indexes: await relationDefinitions(db, indexesStatement),
    triggers: await relationDefinitions(db, triggersStatement),
    functions: await functions(db),
    sequences: await sequences(db),
    views: await views(db),
  };
};

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value
      .map(canonicalize)
      .sort((left, right) => compareText(JSON.stringify(left), JSON.stringify(right)));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
};

export const canonicalJson = (snapshot: SchemaSnapshot): string =>
  JSON.stringify(canonicalize(snapshot));

export const fingerprintHash = (snapshot: SchemaSnapshot): string =>
  createContentHash().sha256(canonicalJson(snapshot));

const SHORT_FINGERPRINT_LENGTH = 12;

export const shortFingerprint = (hash: string): string =>
  hash.slice(0, SHORT_FINGERPRINT_LENGTH);
