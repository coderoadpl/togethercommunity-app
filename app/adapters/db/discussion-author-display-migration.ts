const capitalizePart = (part: string): string => {
  const normalized = part.toLocaleLowerCase('pl-PL');
  return `${normalized.slice(0, 1).toLocaleUpperCase('pl-PL')}${normalized.slice(1)}`;
};

/**
 * The row repair performed by `0018_repair_discussion_authors`, expressed in
 * TypeScript so the migration's blank/e-mail/fallback cases stay unit-tested.
 */
export const repairDiscussionAuthorDisplay = (
  authorDisplay: string,
  authorEmail: string | null,
): string => {
  const current = authorDisplay.trim();
  if (current.length > 0) return current;
  const localPart = (authorEmail?.trim().split('@')[0] ?? '').split('+')[0] ?? '';
  const fromEmail = localPart
    .split(/[._-]+/u)
    .filter((part) => part.length > 0)
    .map(capitalizePart)
    .join(' ')
    .trim();
  return fromEmail.length > 0 ? fromEmail : 'Uczestnik';
};
