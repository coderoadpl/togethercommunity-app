const ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const INITIAL_STATE = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

const utf8 = (text: string): number[] => {
  const bytes: number[] = [];
  for (const character of text) {
    const point = character.codePointAt(0) ?? 0;
    if (point < 0x80) bytes.push(point);
    else if (point < 0x800) bytes.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
    else if (point < 0x10000) bytes.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
    else bytes.push(0xf0 | (point >> 18), 0x80 | ((point >> 12) & 0x3f), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
  }
  return bytes;
};

const rotateRight = (value: number, bits: number): number => (value >>> bits) | (value << (32 - bits));

const word = (words: readonly number[], index: number): number => words[index] ?? 0;

const compress = (state: number[], schedule: readonly number[]): void => {
  let a = word(state, 0);
  let b = word(state, 1);
  let c = word(state, 2);
  let d = word(state, 3);
  let e = word(state, 4);
  let f = word(state, 5);
  let g = word(state, 6);
  let h = word(state, 7);
  for (let index = 0; index < 64; index += 1) {
    const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
    const choice = (e & f) ^ (~e & g);
    const first = (h + sum1 + choice + word(ROUND_CONSTANTS, index) + word(schedule, index)) >>> 0;
    const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
    const majority = (a & b) ^ (a & c) ^ (b & c);
    h = g;
    g = f;
    f = e;
    e = (d + first) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (first + sum0 + majority) >>> 0;
  }
  [a, b, c, d, e, f, g, h].forEach((value, index) => { state[index] = (word(state, index) + value) >>> 0; });
};

const sha256Hex = (bytes: readonly number[]): string => {
  const message = [...bytes];
  const bitLength = message.length * 8;
  message.push(0x80);
  while (message.length % 64 !== 56) message.push(0);
  for (let shift = 56; shift >= 0; shift -= 8) message.push(Math.floor(bitLength / 2 ** shift) & 0xff);
  const state = [...INITIAL_STATE];
  for (let offset = 0; offset < message.length; offset += 64) {
    const schedule: number[] = [];
    for (let index = 0; index < 16; index += 1) {
      const at = offset + index * 4;
      schedule.push(((word(message, at) << 24) | (word(message, at + 1) << 16) | (word(message, at + 2) << 8) | word(message, at + 3)) >>> 0);
    }
    for (let index = 16; index < 64; index += 1) {
      const early = word(schedule, index - 15);
      const late = word(schedule, index - 2);
      const sigma0 = rotateRight(early, 7) ^ rotateRight(early, 18) ^ (early >>> 3);
      const sigma1 = rotateRight(late, 17) ^ rotateRight(late, 19) ^ (late >>> 10);
      schedule.push((word(schedule, index - 16) + sigma0 + word(schedule, index - 7) + sigma1) >>> 0);
    }
    compress(state, schedule);
  }
  return state.map((value) => value.toString(16).padStart(8, '0')).join('');
};

const ITEMS_DIGEST_LENGTH = 16;

export const changeProposalGroupItemsDigest = (itemIds: readonly string[]): string =>
  sha256Hex(utf8(itemIds.join('\n'))).slice(0, ITEMS_DIGEST_LENGTH);

export const sha256HexOfBytes = (bytes: Uint8Array): string => sha256Hex([...bytes]);

export const sha256HexOfText = (text: string): string => sha256Hex(utf8(text));
