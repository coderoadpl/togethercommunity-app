import { z } from 'zod';

export const languageSchema = z.enum(['pl', 'en']);

export type Language = z.output<typeof languageSchema>;

export const LANGUAGES = languageSchema.options;

export const DEFAULT_LANGUAGE: Language = 'pl';
