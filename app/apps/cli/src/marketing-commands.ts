import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';

import type { Command } from 'commander';
import { z } from 'zod';

import { parseMarketingImportCsv, mapMarketingImportCsv, renderMarketingContactCsv, marketingDirectoryContracts, marketingSignupContracts, MARKETING_IMPORT_ATTESTATION_VERSION, MARKETING_IMPORT_ATTESTATION_TEXT, MARKETING_DIRECTORY_ATTESTATION_TEXT, type ApiClient } from '#core/client/index.js';
import { marketingImportMappingSchema } from '#core/contract/index.js';
import { err, ok, validation, internal, type AppError, type Result, type MarketingContactView } from '#core/domain/index.js';

import { emit } from './output.js';

type MarketingCliContext = { api: ApiClient; json: boolean };
const importOptionsSchema = z.object({
  delimiter: z.enum(['auto', 'comma', 'semicolon']).default('auto'), mapping: z.string().optional(), contactsOnly: z.boolean().optional(), consentDefinition: z.string().optional(),
  attest: z.boolean().default(false), attestationNote: z.string().optional(), dryRun: z.boolean().default(false), skipInvalid: z.boolean().default(false),
  idempotencyKey: z.string().optional(), resume: z.string().optional(), wait: z.boolean().default(true), apiKeyEnv: z.string().optional(),
  defaultReason: z.enum(['unsubscribe', 'bounce', 'complaint', 'manual']).optional(), defaultAt: z.string().optional(),
});
type ImportOptions = z.output<typeof importOptionsSchema>;
const keyTransport = (name?: string): Result<{ apiKey?: string }, AppError> => {
  if (name === undefined) return ok({});
  const key = process.env[name];
  return key ? ok({ apiKey: key }) : err(validation(`API key environment variable ${name} is empty`));
};
const readJsonFile = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'));
export const runMarketingCsvImport = async (ctx: MarketingCliContext, file: string, options: ImportOptions, kind: 'contacts' | 'suppressions'): Promise<Result<unknown, AppError>> => {
  const transport = keyTransport(options.apiKeyEnv);
  if (!transport.ok) return transport;
  if (options.contactsOnly && options.consentDefinition) return err(validation('Choose contacts-only or a consent definition'));
  if (!options.dryRun && !options.resume && (!options.attest || !options.attestationNote)) return err(validation('Import requires --attest and --attestation-note, or --dry-run'));
  const bytes = await readFile(file);
  if (bytes.byteLength > 3 * 1024 * 1024) return err(validation('CSV exceeds 3 MiB'));
  let csvText: string;
  try { csvText = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return err(validation('CSV must be UTF-8')); }
  const csv = parseMarketingImportCsv(csvText, options.delimiter === 'auto' ? undefined : options.delimiter === 'comma' ? ',' : ';');
  if (!csv.ok) return csv;
  const mapping = options.mapping === undefined ? undefined : marketingImportMappingSchema.safeParse(await readJsonFile(options.mapping));
  if (mapping !== undefined && !mapping.success) return err(validation('Invalid column mapping', mapping.error.flatten()));
  const defaults = { ...(options.defaultReason === undefined ? {} : { reason: options.defaultReason }), ...(options.defaultAt === undefined ? {} : { at: options.defaultAt }) };
  const mapped = mapMarketingImportCsv(csv.value, { kind, ...(mapping?.success ? { mapping: mapping.data } : {}), defaults });
  if (!mapped.ok) return mapped;
  for (const warning of mapped.value.warnings) process.stderr.write(`${warning.message}\n`);
  for (const header of mapped.value.unknownColumns) process.stderr.write(`Unmapped column: ${header}\n`);
  const fileSha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const created = options.resume === undefined
    ? await ctx.api.createMarketingContactImport({ datasetVersion: 'together-marketing-contacts/v1', kind, fileName: basename(file), fileSha256, rowCount: mapped.value.rows.length, consentDefinitionId: options.consentDefinition ?? null, defaults, mapping: mapped.value.mapping, delimiter: csv.value.delimiter, idempotencyKey: options.idempotencyKey ?? crypto.randomUUID() }, transport.value)
    : await ctx.api.getMarketingContactImport({ importId: options.resume }, transport.value);
  if (!created.ok) return created;
  const importId = created.value.import.id;
  if (created.value.import.fileSha256 !== fileSha256 || created.value.import.kind !== kind) return err(validation('Resume file does not match the staged import'));
  let batch = created.value.import;
  if (options.dryRun && batch.status !== 'draft' && batch.status !== 'ready') return ok({ import: batch });
  if (batch.status === 'draft' || batch.status === 'ready') {
    for (let offset = 0; offset < mapped.value.rows.length; offset += 200) {
      const appended = await ctx.api.appendMarketingContactImportRows({ importId, offset, rows: mapped.value.rows.slice(offset, offset + 200) }, transport.value);
      if (!appended.ok) return appended;
    }
    const validated = await ctx.api.validateMarketingContactImport({ importId }, transport.value);
    if (!validated.ok || options.dryRun) return validated;
    if (!options.attest) return err(validation('Resume commit requires --attest'));
    const committed = await ctx.api.commitMarketingContactImport({ importId, validationHash: validated.value.validationHash,
      attestation: { accepted: true, version: MARKETING_IMPORT_ATTESTATION_VERSION, locale: 'en', note: options.attestationNote ?? '' }, invalidRows: options.skipInvalid ? 'skip_invalid' : 'reject_batch',
    }, transport.value);
    if (!committed.ok) return committed;
    batch = committed.value.import;
  } else if (batch.status === 'failed') {
    const retried = await ctx.api.retryMarketingContactImport({ importId }, transport.value);
    if (!retried.ok) return retried;
    batch = retried.value.import;
  }
  if (!options.wait) return ok({ import: batch });
  while (!['completed', 'completed_with_errors', 'failed', 'cancelled'].includes(batch.status)) {
    process.stderr.write(`Import ${importId}: ${batch.status}\n`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const progress = await ctx.api.getMarketingContactImport({ importId }, transport.value);
    if (!progress.ok) return progress;
    batch = progress.value.import;
  }
  return batch.status === 'failed' || batch.status === 'cancelled' ? err(validation(`Import ${batch.status}: ${batch.lastError ?? importId}`, { import: batch })) : ok({ import: batch });
};
const filtersSchema = z.object({ id: z.string().optional(), search: z.string().optional(), tag: z.array(z.string()).optional(), list: z.string().optional(), consentDefinition: z.string().optional(), consentState: z.enum(['none', 'pending_confirmation', 'active', 'withdrawn']).optional(), suppressed: z.enum(['true', 'false']).optional(), linkedMember: z.enum(['true', 'false']).optional(), archived: z.boolean().optional(), limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().optional(), out: z.string().optional(), spreadsheetSafe: z.boolean().default(false), apiKeyEnv: z.string().optional() });
const filterInput = async (api: ApiClient, options: z.output<typeof filtersSchema>, transport: { apiKey?: string }) => {
  const list = options.list === undefined ? null : await api.getMarketingList({ listId: options.list }, transport);
  if (list !== null && !list.ok) return list;
  return ok({ id: options.id, search: options.search, tags: options.tag, listId: list?.ok ? list.value.list.id : undefined, consentDefinitionId: options.consentDefinition, consentState: options.consentState,
    suppressed: options.suppressed === undefined ? undefined : options.suppressed === 'true', linkedMember: options.linkedMember === undefined ? undefined : options.linkedMember === 'true', archived: options.archived, limit: options.limit, cursor: options.cursor });
};
export const registerMarketingCommands = (program: Command, context: () => Result<MarketingCliContext, AppError>): void => {
  const marketing = program.command('marketing').description('Manage contacts, lists and durable imports');
  const contacts = marketing.command('contacts'); const lists = marketing.command('lists'); const imports = marketing.command('imports'); const suppressions = marketing.command('suppressions');
  const run = <S extends z.ZodTypeAny>(schema: S, action: (ctx: MarketingCliContext, input: z.output<S>) => Promise<Result<unknown, AppError>>) => async (...args: unknown[]) => {
    const ctx = context();
    if (!ctx.ok) { emit(ctx, process.argv.includes('--json'), () => ''); return; }
    const input = schema.safeParse(args.slice(0, -1));
    if (!input.success) { emit(err(validation('Invalid marketing command options', input.error.flatten())), ctx.value.json, () => ''); return; }
    try { const result = await action(ctx.value, input.data); emit(result, ctx.value.json, (value) => JSON.stringify(value, null, 2)); }
    catch (error) { emit(err(internal(error instanceof Error ? error.message : 'Marketing command failed')), ctx.value.json, () => ''); }
  };
  for (const [group, kind] of [[contacts, 'contacts'], [suppressions, 'suppressions']] as const) {
    group.command('import <file>').option('--dry-run').option('--delimiter <delimiter>', 'auto, comma or semicolon', 'auto').option('--mapping <file>').option('--contacts-only').option('--consent-definition <id>')
      .option('--attest', MARKETING_IMPORT_ATTESTATION_TEXT + ' Directory-only: ' + MARKETING_DIRECTORY_ATTESTATION_TEXT).option('--attestation-note <text>').option('--skip-invalid').option('--idempotency-key <key>').option('--resume <id>').option('--no-wait').option('--api-key-env <name>').option('--default-reason <reason>').option('--default-at <iso>')
      .action(run(z.tuple([z.string(), importOptionsSchema]), (ctx, [file, options]) => runMarketingCsvImport(ctx, file, options, kind)));
  }
  for (const command of ['list', 'export']) {
    contacts.command(command).option('--id <contact-id>').option('--search <text>').option('--tag <tags...>').option('--list <key-or-id>').option('--consent-definition <id>').option('--consent-state <state>').option('--suppressed <boolean>').option('--linked-member <boolean>').option('--archived').option('--limit <number>', 'Page size', '50').option('--cursor <cursor>').option('--out <file>').option('--spreadsheet-safe').option('--api-key-env <name>')
      .action(run(z.tuple([filtersSchema]), async (ctx, [options]) => {
        const transport = keyTransport(options.apiKeyEnv); if (!transport.ok) return transport;
        const input = await filterInput(ctx.api, options, transport.value); if (!input.ok) return input;
        if (command === 'list') return ctx.api.listMarketingContacts(input.value, transport.value);
        const all: MarketingContactView[] = []; let cursor = input.value.cursor;
        do {
          const page = await ctx.api.exportMarketingContacts({ ...input.value, cursor }, transport.value); if (!page.ok) return page;
          all.push(...page.value.contacts); cursor = page.value.nextCursor ?? undefined;
        } while (cursor !== undefined);
        const csv = renderMarketingContactCsv(all, options.spreadsheetSafe);
        if (options.out !== undefined) { await writeFile(options.out, csv); return ok({ file: options.out, rowCount: all.length }); }
        return ok({ csv, rowCount: all.length });
      }));
  }
  lists.command('create').requiredOption('--key <key>').requiredOption('--name <name>').option('--rule <json>').action(run(z.tuple([z.object({ key: z.string(), name: z.string(), rule: z.string().optional() })]), (ctx, [options]) => {
    const rule: unknown = options.rule === undefined ? null : JSON.parse(options.rule);
    const input = marketingDirectoryContracts.createMarketingList.input.safeParse({ ...options, rule });
    return input.success ? ctx.api.createMarketingList(input.data) : Promise.resolve(err(validation('Invalid list rule', input.error.flatten())));
  }));
  const forms = marketing.command('forms').description('Manage public newsletter signup forms');
  forms.command('list').action(run(z.tuple([z.object({})]), (ctx) => ctx.api.listMarketingSignupForms({})));
  forms.command('show <slug>').action(run(z.tuple([z.string(), z.object({})]), (ctx, [slug]) => ctx.api.getMarketingSignupForm({ slug })));
  forms.command('create').requiredOption('--input <json>', 'Signup form as JSON').action(run(z.tuple([z.object({ input: z.string() })]), (ctx, [options]) => {
    let raw: unknown;
    try { raw = JSON.parse(options.input); }
    catch { return Promise.resolve(err(validation('Signup form input must be valid JSON'))); }
    const parsed = marketingSignupContracts.createMarketingSignupForm.input.safeParse(raw);
    return parsed.success ? ctx.api.createMarketingSignupForm(parsed.data) : Promise.resolve(err(validation('Invalid signup form', parsed.error.flatten())));
  }));
  lists.command('list').action(run(z.tuple([z.object({})]), (ctx) => ctx.api.listMarketingLists({})));
  for (const action of ['add', 'remove'] as const) {
    lists.command(action).requiredOption('--list <key-or-id>').requiredOption('--contact <ids...>').action(run(z.tuple([z.object({ list: z.string(), contact: z.array(z.string()) })]), async (ctx, [options]) => {
      const list = await ctx.api.getMarketingList({ listId: options.list }); if (!list.ok) return list;
      return ctx.api[action === 'add' ? 'addMarketingListContacts' : 'removeMarketingListContacts']({ listId: list.value.list.id, contactIds: options.contact });
    }));
  }
  const jsonCommand = <S extends z.ZodTypeAny>(group: Command, name: string, schema: S, call: (api: ApiClient, input: z.output<S>, transport: { apiKey?: string }) => Promise<Result<unknown, AppError>>) => {
    group.command(name).requiredOption('--input <json>', 'Request object as JSON').option('--api-key-env <name>').action(run(z.tuple([z.object({ input: z.string(), apiKeyEnv: z.string().optional() })]), async (ctx, [options]) => {
      const transport = keyTransport(options.apiKeyEnv); if (!transport.ok) return transport;
      const raw: unknown = JSON.parse(options.input); const input = schema.safeParse(raw);
      return input.success ? call(ctx.api, input.data, transport.value) : err(validation('Invalid request', input.error.flatten()));
    }));
  };
  jsonCommand(contacts, 'get', marketingDirectoryContracts.getMarketingContact.input, (api, input, transport) => api.getMarketingContact(input, transport));
  jsonCommand(contacts, 'upsert', marketingDirectoryContracts.upsertMarketingContact.input, (api, input, transport) => api.upsertMarketingContact(input, transport));
  jsonCommand(contacts, 'update', marketingDirectoryContracts.updateMarketingContact.input, (api, input, transport) => api.updateMarketingContact(input, transport));
  jsonCommand(contacts, 'archive', marketingDirectoryContracts.archiveMarketingContact.input, (api, input, transport) => api.archiveMarketingContact(input, transport));
  jsonCommand(contacts, 'restore', marketingDirectoryContracts.restoreMarketingContact.input, (api, input, transport) => api.restoreMarketingContact(input, transport));
  jsonCommand(contacts, 'sync', marketingDirectoryContracts.syncMarketingMemberContacts.input, (api, input, transport) => api.syncMarketingMemberContacts(input, transport));
  jsonCommand(lists, 'get', marketingDirectoryContracts.getMarketingList.input, (api, input, transport) => api.getMarketingList(input, transport));
  jsonCommand(lists, 'update', marketingDirectoryContracts.updateMarketingList.input, (api, input, transport) => api.updateMarketingList(input, transport));
  jsonCommand(lists, 'archive', marketingDirectoryContracts.archiveMarketingList.input, (api, input, transport) => api.archiveMarketingList(input, transport));
  jsonCommand(lists, 'preview', marketingDirectoryContracts.previewMarketingList.input, (api, input, transport) => api.previewMarketingList(input, transport));
  jsonCommand(lists, 'contacts', marketingDirectoryContracts.getMarketingListContacts.input, (api, input, transport) => api.getMarketingListContacts(input, transport));
  jsonCommand(imports, 'upload', marketingDirectoryContracts.uploadMarketingContactImport.input, (api, input) => api.uploadMarketingContactImport(input));
  jsonCommand(imports, 'preview', marketingDirectoryContracts.previewMarketingContactImport.input, (api, input) => api.previewMarketingContactImport(input));
  jsonCommand(imports, 'create', marketingDirectoryContracts.createMarketingContactImport.input, (api, input, transport) => api.createMarketingContactImport(input, transport));
  jsonCommand(imports, 'append', marketingDirectoryContracts.appendMarketingContactImportRows.input, (api, input, transport) => api.appendMarketingContactImportRows(input, transport));
  jsonCommand(imports, 'validate', marketingDirectoryContracts.validateMarketingContactImport.input, (api, input, transport) => api.validateMarketingContactImport(input, transport));
  jsonCommand(imports, 'commit', marketingDirectoryContracts.commitMarketingContactImport.input, (api, input, transport) => api.commitMarketingContactImport(input, transport));
  jsonCommand(imports, 'get', marketingDirectoryContracts.getMarketingContactImport.input, (api, input, transport) => api.getMarketingContactImport(input, transport));
  jsonCommand(imports, 'rows', marketingDirectoryContracts.getMarketingContactImportRows.input, (api, input, transport) => api.getMarketingContactImportRows(input, transport));
  jsonCommand(imports, 'retry', marketingDirectoryContracts.retryMarketingContactImport.input, (api, input, transport) => api.retryMarketingContactImport(input, transport));
  jsonCommand(imports, 'cancel', marketingDirectoryContracts.cancelMarketingContactImport.input, (api, input, transport) => api.cancelMarketingContactImport(input, transport));
  jsonCommand(imports, 'process', marketingDirectoryContracts.processMarketingContactImport.input, (api, input, transport) => api.processMarketingContactImport(input, transport));
  jsonCommand(suppressions, 'create-import', marketingDirectoryContracts.importMarketingSuppressions.input, (api, input, transport) => api.importMarketingSuppressions(input, transport));
};
