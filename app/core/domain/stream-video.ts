import { z } from 'zod';

export const streamVideoSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  lengthSeconds: z.number().int().nonnegative(),
  uploadedAt: z.string(),
});

export type StreamVideo = z.infer<typeof streamVideoSchema>;

export const streamVideoPageSchema = z.object({
  libraryId: z.string().min(1),
  videos: z.array(streamVideoSchema),
  totalItems: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});

export type StreamVideoPage = z.infer<typeof streamVideoPageSchema>;

export const listStreamVideosInputSchema = z.object({
  search: z.string().trim().optional(),
  page: z.coerce.number().int().positive().default(1),
});

export type ListStreamVideosInput = z.input<typeof listStreamVideosInputSchema>;
