// Labels for the keyed table: jfb word lists, mulberry32 seed 42, ids from 1 upward per page load.
const A = ['pretty', 'large', 'big', 'small', 'tall', 'short', 'long', 'handsome', 'plain', 'quaint',
  'clean', 'elegant', 'easy', 'angry', 'crazy', 'helpful', 'mushy', 'odd', 'unsightly', 'adorable',
  'important', 'inexpensive', 'cheap', 'expensive', 'fancy'];
const C = ['red', 'yellow', 'blue', 'green', 'pink', 'brown', 'purple', 'brown', 'white', 'black', 'orange'];
const N = ['table', 'chair', 'house', 'bbq', 'desk', 'car', 'pony', 'cookie', 'sandwich', 'burger', 'pizza',
  'mouse', 'keyboard'];

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createDataGenerator(seed = 42) {
const rnd = mulberry32(seed);
let nextId = 1;
const pick = (list) => list[Math.floor(rnd() * list.length)];

// Returns [{ id, label }, ...]
return function buildData(count) {
  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = { id: nextId++, label: pick(A) + ' ' + pick(C) + ' ' + pick(N) };
  }
  return out;
};
}

export const buildData = createDataGenerator();
