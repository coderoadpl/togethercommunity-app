import { keyDownloadFileCapExceeded } from './change-proposal-download.js';

export const CHANGE_PROPOSAL_REFUSALS = {
  accessCourseUnavailable: 'Product access items may only reference existing, active courses',
  accessModuleMissing: 'Product access items may only reference existing modules',
  accessModuleOutsideCourse: 'Product access moduleIds must belong to the item courseId',
  accessExcludedModuleOutsideCourse: 'Product access excludedModuleIds must belong to the item courseId',
  accessLessonMissing: 'Product access items may only reference existing lessons',
  accessLessonOutsideCourse: 'Product access lessonIds must belong to the item courseId through its modules and chapters',
  fileProductNotDigital: 'Files can only be attached to digital-download products',
  fileReplacementMissing: 'Replacement file not found',
  fileReplacementNotReady: 'Only ready files can be replaced',
  fileRemovalNotReady: 'Only a ready file can be removed by a proposal',
  fileProductFull: keyDownloadFileCapExceeded('product_files').message,
} as const;

export type ChangeProposalRefusal = keyof typeof CHANGE_PROPOSAL_REFUSALS;

const isRefusal = (key: string): key is ChangeProposalRefusal => key in CHANGE_PROPOSAL_REFUSALS;

const REFUSAL_BY_MESSAGE: ReadonlyMap<string, ChangeProposalRefusal> = new Map(
  Object.entries(CHANGE_PROPOSAL_REFUSALS).flatMap(([refusal, message]) => isRefusal(refusal) ? [[message, refusal] as const] : []),
);

export const changeProposalRefusalOf = (message: string | null): ChangeProposalRefusal | null =>
  message === null ? null : REFUSAL_BY_MESSAGE.get(message) ?? null;
