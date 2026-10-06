import type { Survey, SurveyResults } from '#core/domain/index.js';

export const sampleSurvey: Survey = {
  id: 'survey-feedback', tenantId: 'tenant-studio', title: 'Audience feedback', question: 'How was your experience?', type: 'nps', slug: 'feedback', commentEnabled: true, commentPrompt: 'What would you like us to know?', active: true,
  endings: [{ min: 0, max: 6, body: 'Thank you for telling us. We will use your feedback to improve.' }, { min: 7, max: 8, body: 'Thank you. Your perspective helps us take the next step.' }, { min: 9, max: 10, body: 'Thank you! We are glad you enjoyed your experience.' }], token: 'survey-public-token', revision: 1, createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z',
};
export const sampleResults: SurveyResults = {
  count: 12, nps: 25, average: 7.5, distribution: Array.from({ length: 11 }, (_, score) => ({ score, count: [0, 0, 1, 0, 0, 1, 1, 2, 1, 3, 3][score] ?? 0 })),
  responses: [
    { id: 'response-one', tenantId: 'tenant-studio', surveyId: 'survey-feedback', memberId: 'member-one', memberName: 'Alex Reader', score: 9, comment: 'Clear and useful. Thank you for listening.', createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z' },
    { id: 'response-two', tenantId: 'tenant-studio', surveyId: 'survey-feedback', memberId: null, memberName: null, score: 7, comment: 'I would appreciate more examples.', createdAt: '2026-10-01T11:00:00.000Z', updatedAt: '2026-10-01T11:00:00.000Z' },
  ], page: 1, pageSize: 25, totalPages: 1,
};
