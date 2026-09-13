import { waitUntil } from '@vercel/functions';

export const keepAlive = (task: Promise<unknown>): void => {
  if (process.env.VERCEL === undefined && process.env.VERCEL_URL === undefined) return;
  try {
    waitUntil(task);
  } catch {
    return;
  }
};
