import { z } from 'zod';
import { partnerProgramSchema, partnerProgramInputSchema, partnerProgramUpdateSchema, partnerProgramSummarySchema, partnerDetailSchema, partnerSchema, partnerAssignInputSchema, partnerUpdateInputSchema, partnerCodeSchema, partnerCodeInputSchema, partnerCodeUpdateSchema, commissionSchema } from '#core/domain/index.js';

export const partnerContracts = {
  listPartnerPrograms: { input: z.object({}).strict(), output: z.object({ programs: z.array(partnerProgramSummarySchema) }) },
  getPartnerProgram: { input: z.object({ id: z.string().min(1) }).strict(), output: z.object({ program: partnerProgramSchema, partners: z.array(partnerDetailSchema), codes: z.array(partnerCodeSchema), commissions: z.array(commissionSchema) }) },
  createPartnerProgram: { input: partnerProgramInputSchema, output: z.object({ program: partnerProgramSchema }) },
  updatePartnerProgram: { input: partnerProgramUpdateSchema, output: z.object({ program: partnerProgramSchema }) },
  assignPartner: { input: partnerAssignInputSchema, output: z.object({ partner: partnerSchema }) },
  updatePartner: { input: partnerUpdateInputSchema, output: z.object({ partner: partnerSchema }) },
  createPartnerCode: { input: partnerCodeInputSchema, output: z.object({ code: partnerCodeSchema }) },
  updatePartnerCode: { input: partnerCodeUpdateSchema, output: z.object({ code: partnerCodeSchema }) },
} as const;
export const PARTNER_ROUTES = {
  listPartnerPrograms: { method: 'GET', path: '/api/partner-programs' },
  getPartnerProgram: { method: 'GET', path: '/api/partner-programs/:id' },
  createPartnerProgram: { method: 'POST', path: '/api/partner-programs' },
  updatePartnerProgram: { method: 'POST', path: '/api/partner-programs/:id' },
  assignPartner: { method: 'POST', path: '/api/partners' },
  updatePartner: { method: 'POST', path: '/api/partners/:id' },
  createPartnerCode: { method: 'POST', path: '/api/partner-codes' },
  updatePartnerCode: { method: 'POST', path: '/api/partner-codes/:id' },
} as const;
