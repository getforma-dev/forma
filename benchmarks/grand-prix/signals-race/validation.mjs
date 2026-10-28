import { CARS } from './cars.mjs';
export function count(value, name, min = 0, max = 1000) {
  if (!/^(0|[1-9]\d*)$/.test(String(value)) || !Number.isSafeInteger(+value) || +value < min || +value > max)
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return +value;
}
export function validateCars(cars) {
  const allowed = [...CARS, 'alien-signals-3.1.2'];
  if (!cars.length || new Set(cars).size !== cars.length || cars.some(car => !allowed.includes(car)))
    throw new Error('Unknown or duplicate signals adapter');
  return cars;
}
export function rate(n, ms) {
  if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(ms) || ms <= 0) throw new Error('Invalid signals measurement');
  const value = n / (ms / 1000);
  if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid signals rate');
  return value;
}
