export const copyText = async (text: string): Promise<boolean> => {
  const { clipboard } = navigator;
  if (clipboard === undefined) return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};
