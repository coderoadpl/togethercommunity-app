export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export const describedBy = (...ids: ReadonlyArray<string | null>): { 'aria-describedby'?: string } => {
  const present = ids.filter((id): id is string => id !== null);
  return present.length === 0 ? {} : { 'aria-describedby': present.join(' ') };
};
