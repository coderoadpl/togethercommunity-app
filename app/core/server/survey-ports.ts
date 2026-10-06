import type { AppError, Result, Survey, SurveyResponse } from '#core/domain/index.js';
import type { Clock, IdGenerator, TokenGenerator } from './ports.js';

export interface SurveyRepository {
  list(tenantId: string): Promise<Survey[]>;
  findById(tenantId: string, id: string): Promise<Survey | null>;
  findBySlug(tenantId: string, slug: string): Promise<Survey | null>;
  save(tenantId: string, survey: Survey, expectedRevision: number | null): Promise<Result<Survey, AppError>>;
  delete(tenantId: string, id: string): Promise<boolean>;
  submit(tenantId: string, survey: Survey, response: Omit<SurveyResponse, 'memberName'>): Promise<Result<void, AppError>>;
  responses(tenantId: string, surveyId: string, offset: number, limit: number): Promise<SurveyResponse[]>;
  exportResponses(tenantId: string, surveyId: string): Promise<SurveyResponse[]>;
  distribution(tenantId: string, surveyId: string): Promise<Array<{ score: number; count: number }>>;
}
export interface SurveyDeps {
  surveys: SurveyRepository;
  clock: Clock;
  ids: IdGenerator;
  tokens: TokenGenerator;
}
