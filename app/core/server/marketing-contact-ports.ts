import type {
  AppError, MarketingContact, MarketingContactListQuery, MarketingContactPage, MarketingContactUpsert, MarketingContactUpsertResult,
  MarketingList, MarketingListQuery, MarketingListPage, MarketingListSave, MarketingListMembershipChange, MarketingListMembershipResult,
  MarketingListRule, MarketingListCounts, MarketingContactImport, MarketingImportRowReceipt, MarketingDirectoryEvent, Result,
} from '#core/domain/index.js';

import type { ContentHash, Clock, IdGenerator, EmailHmac, ConsentDefinitionRepository, MarketingConsentRepository, SuppressionRepository } from './ports.js';

export interface MarketingContactRepository {
  lockAddress(tenantId: string, email: string): Promise<void>;
  findById(tenantId: string, contactId: string): Promise<MarketingContact | null>;
  findByEmail(tenantId: string, email: string): Promise<MarketingContact | null>;
  listPage(tenantId: string, query: MarketingContactListQuery, asOf?: string): Promise<MarketingContactPage>;
  upsertByEmail(tenantId: string, input: MarketingContactUpsert): Promise<MarketingContactUpsertResult>;
  update(tenantId: string, contactId: string, input: Omit<MarketingContactUpsert, 'email'>): Promise<MarketingContact | null>;
  archive(tenantId: string, input: { contactId: string; archivedAt: string | null }): Promise<MarketingContact | null>;
}
export interface MarketingListRepository {
  findById(tenantId: string, listId: string): Promise<MarketingList | null>;
  findByKey(tenantId: string, key: string): Promise<MarketingList | null>;
  listPage(tenantId: string, query: MarketingListQuery): Promise<MarketingListPage>;
  save(tenantId: string, input: MarketingListSave): Promise<Result<MarketingList, AppError>>;
  addMembers(tenantId: string, input: MarketingListMembershipChange & { importId?: string }): Promise<MarketingListMembershipResult>;
  removeMembers(tenantId: string, input: MarketingListMembershipChange & { importId?: string }): Promise<MarketingListMembershipResult>;
  validateRule(tenantId: string, rule: MarketingListRule): Promise<boolean>;
  counts(tenantId: string, listId: string, consentDefinitionId: string | null, asOf: string): Promise<MarketingListCounts>;
}
export interface MarketingContactImportRepository {
  findById(tenantId: string, importId: string): Promise<MarketingContactImport | null>;
  findByKey(tenantId: string, key: string): Promise<MarketingContactImport | null>;
  save(tenantId: string, batch: MarketingContactImport): Promise<void>;
  runnable(tenantId: string, now: string): Promise<string[]>;
  rows(tenantId: string, importId: string): Promise<MarketingImportRowReceipt[]>;
  nextRow(tenantId: string, importId: string): Promise<MarketingImportRowReceipt | null>;
  rowsPage(tenantId: string, importId: string, offset: number, limit: number): Promise<MarketingImportRowReceipt[]>;
  hasLists(tenantId: string, importId: string): Promise<boolean>;
  saveRow(tenantId: string, row: MarketingImportRowReceipt): Promise<void>;
  lock(tenantId: string, key: string): Promise<void>;
  saveCsv(tenantId: string, importId: string, csv: string): Promise<void>;
  readCsv(tenantId: string, importId: string): Promise<string | null>;
  clearStagedRows(tenantId: string, importId: string): Promise<void>;
  purgeStaging(tenantId: string, now: string): Promise<number>;
}
export interface MarketingDirectoryEventRepository {
  append(tenantId: string, event: Omit<MarketingDirectoryEvent, 'sequence'>): Promise<void>;
  list(tenantId: string, subjectKind: MarketingDirectoryEvent['subjectKind'], subjectId: string): Promise<MarketingDirectoryEvent[]>;
}
export interface MarketingMemberSyncRepository {
  next(tenantId: string, now: string): Promise<{ memberId: string; revision: number; email: string; displayName: string | null } | null>;
  complete(tenantId: string, memberId: string, revision: number, now: string): Promise<boolean>;
}
export interface MarketingImportTransactionRepos {
  contacts: MarketingContactRepository; lists: MarketingListRepository; imports: MarketingContactImportRepository;
  directoryEvents: MarketingDirectoryEventRepository; definitions: ConsentDefinitionRepository;
  consents: MarketingConsentRepository; suppressions: SuppressionRepository; memberSync: MarketingMemberSyncRepository;
}
export interface MarketingImportTransaction {
  run<T>(tenantId: string, operation: (repos: MarketingImportTransactionRepos) => Promise<Result<T, AppError>>): Promise<Result<T, AppError>>;
}
export interface MarketingDirectoryJobs {
  tenantIds(): Promise<string[]>;
}
export interface MarketingContactDeps extends MarketingImportTransactionRepos {
  transaction: MarketingImportTransaction; clock: Clock; ids: IdGenerator; hmac: EmailHmac;
  contentHash: ContentHash;
}
export type MarketingImportDeps = MarketingContactDeps;
