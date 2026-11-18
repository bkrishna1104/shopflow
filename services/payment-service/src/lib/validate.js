// Tiny input validators. WHY: never trust input — bad data must become a 400,
// not a database error (500) that pollutes the 5xx metric the canary is judged on.
import { HttpError } from './errors.js';

export function positiveInt(value, name) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `${name} must be a positive integer`);
  return n;
}

export function nonNegativeInt(value, name) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isInteger(n) || n < 0) throw new HttpError(400, `${name} must be a non-negative integer`);
  return n;
}

export function nonEmptyString(value, name, maxLength = 200) {
  if (typeof value !== 'string' || value.trim() === '') throw new HttpError(400, `${name} is required`);
  if (value.length > maxLength) throw new HttpError(400, `${name} must be at most ${maxLength} characters`);
  return value.trim();
}

export function pagination(query) {
  const limit = query.limit === undefined ? 50 : positiveInt(query.limit, 'limit');
  const offset = query.offset === undefined ? 0 : nonNegativeInt(query.offset, 'offset');
  return { limit: Math.min(limit, 100), offset };
}
