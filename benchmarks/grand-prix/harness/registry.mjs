import { readFileSync } from 'node:fs';
const registry = JSON.parse(readFileSync(new URL('../config/laboratory.json', import.meta.url), 'utf8'));
export function entrantsFor(suite) {
  const cars = registry.suites[suite]?.cars;
  if (!Array.isArray(cars) || !cars.length || new Set(cars).size !== cars.length || !cars.every(id => /^[a-z][a-z0-9-]*$/.test(id))) throw Error('Invalid entrant registry: ' + suite);
  return [...cars];
}
