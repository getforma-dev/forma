import assert from 'node:assert/strict';
export const NAVIGATION_INCREMENT_GZIP = 12 * 1024;
export const NAVIGATION_GROUP_GZIP = 64 * 1024;
/** Paired cold-consumer delta, including positive changes to shared core.
 * Per-route checks prevent duplicate baseline runtimes hiding eager group cost. */
export function navigationSizeVerdict({ previousPlain, currentPlain, group }) {
  const valid = value => assert(Number.isSafeInteger(value) && value >= 0, 'size must be a nonnegative safe byte count');
  valid(group);
  const routes = Object.keys(previousPlain);
  assert(routes.length > 0); assert.deepEqual(Object.keys(currentPlain).sort(), [...routes].sort(), 'paired route inventory differs');
  const comparisons = routes.map(route => {
    const previous=previousPlain[route], current=currentPlain[route];valid(previous);valid(current);
    const sharedDelta=Math.max(0,current-previous), increment=Math.max(0,group-current+sharedDelta);
    return {route,previousPlainGzip:previous,currentPlainGzip:current,positiveSharedDeltaGzip:sharedDelta,incrementGzip:increment};
  });
  const increment=Math.max(...comparisons.map(row=>row.incrementGzip));
  return {comparisons,incrementGzip:increment,groupGzip:group,ceilings:{increment:NAVIGATION_INCREMENT_GZIP,group:NAVIGATION_GROUP_GZIP},
    passed:increment<=NAVIGATION_INCREMENT_GZIP&&group<=NAVIGATION_GROUP_GZIP};
}
