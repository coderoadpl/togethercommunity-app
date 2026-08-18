import { formatDateTime, formatTime } from '../../../lib/format.js';

const RANGE_SEPARATOR = ' – ';

const isSameLocalDay = (start: Date, end: Date): boolean =>
  start.getFullYear() === end.getFullYear()
  && start.getMonth() === end.getMonth()
  && start.getDate() === end.getDate();

export const formatEventRange = (
  startsAt: string,
  endsAt: string,
  language: string,
): string =>
  isSameLocalDay(new Date(startsAt), new Date(endsAt))
    ? `${formatDateTime(startsAt, language)}${RANGE_SEPARATOR}${formatTime(endsAt, language)}`
    : `${formatDateTime(startsAt, language)}${RANGE_SEPARATOR}${formatDateTime(endsAt, language)}`;

export const hasEnded = (endsAt: string, nowMs = Date.now()): boolean =>
  new Date(endsAt).getTime() < nowMs;
