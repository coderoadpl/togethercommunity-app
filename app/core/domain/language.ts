import { z } from 'zod';

export const languageSchema = z.enum(['pl', 'en']);

export type Language = z.output<typeof languageSchema>;

export const LANGUAGES = languageSchema.options;

export const DEFAULT_LANGUAGE: Language = 'pl';

/** HTTP header carrying the UI language for transactional magic-link emails. */
export const MAGIC_LINK_LANGUAGE_HEADER = 'x-together-language';
