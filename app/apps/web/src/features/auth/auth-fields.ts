import { z } from 'zod';

const emailSchema = z.string().email();

export const isEmailAddress = (value: string): boolean => emailSchema.safeParse(value).success;

export const describedBy = (...ids: ReadonlyArray<string | null>): { 'aria-describedby'?: string } => {
  const present = ids.filter((id): id is string => id !== null);
  return present.length === 0 ? {} : { 'aria-describedby': present.join(' ') };
};
