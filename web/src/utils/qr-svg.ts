// Pure TypeScript ISO/IEC 18004 QR Code Matrix Generator (Versions 1..6, Level L, Byte Mode)
// Zero external dependencies, 100% offline, scannable by all iOS / Android cameras.

interface VersionSpec {
  version: number;
  size: number;
  dataCodewords: number;
  eccCodewordsPerBlock: number;
  numBlocks: number;
  alignment: number[];
}

const VERSION_SPECS: VersionSpec[] = [
  { version: 1, size: 21, dataCodewords: 19, eccCodewordsPerBlock: 7, numBlocks: 1, alignment: [] },
  { version: 2, size: 25, dataCodewords: 34, eccCodewordsPerBlock: 10, numBlocks: 1, alignment: [6, 18] },
  { version: 3, size: 29, dataCodewords: 55, eccCodewordsPerBlock: 15, numBlocks: 1, alignment: [6, 22] },
  { version: 4, size: 33, dataCodewords: 80, eccCodewordsPerBlock: 20, numBlocks: 1, alignment: [6, 26] },
  { version: 5, size: 37, dataCodewords: 108, eccCodewordsPerBlock: 26, numBlocks: 1, alignment: [6, 30] },
  { version: 6, size: 41, dataCodewords: 136, eccCodewordsPerBlock: 18, numBlocks: 2, alignment: [6, 34] }
];

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const root = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], root);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: Uint8Array, eccLen: number): Uint8Array {
  const gen = rsGeneratorPoly(eccLen);
  const rem = new Uint8Array(eccLen);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0];
    rem.copyWithin(0, 1);
    rem[eccLen - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < eccLen; j++) {
        rem[j] ^= gfMul(gen[j + 1], factor);
      }
    }
  }
  return rem;
}

export function generateQrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  const spec = VERSION_SPECS.find((s) => bytes.length + 3 <= s.dataCodewords) || VERSION_SPECS[VERSION_SPECS.length - 1];
  const payload = bytes.slice(0, spec.dataCodewords - 3);

  // Build bit stream: Byte mode (0100) + 8-bit length + bytes + terminator
  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };

  pushBits(0b0100, 4);
  pushBits(payload.length, 8);
  for (const b of payload) pushBits(b, 8);

  const maxBits = spec.dataCodewords * 8;
  const termLen = Math.min(4, maxBits - bits.length);
  pushBits(0, termLen);
  while (bits.length % 8 !== 0) bits.push(0);

  const dataWords = new Uint8Array(spec.dataCodewords);
  for (let i = 0; i < bits.length / 8; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i * 8 + j];
    dataWords[i] = b;
  }
  const padBytes = [0xec, 0x11];
  for (let i = bits.length / 8, p = 0; i < spec.dataCodewords; i++, p++) {
    dataWords[i] = padBytes[p % 2];
  }

  // Reed-Solomon blocks & interleaving
  const blockSize = spec.dataCodewords / spec.numBlocks;
  const dataBlocks: Uint8Array[] = [];
  const eccBlocks: Uint8Array[] = [];
  for (let b = 0; b < spec.numBlocks; b++) {
    const blk = dataWords.subarray(b * blockSize, (b + 1) * blockSize);
    dataBlocks.push(blk);
    eccBlocks.push(rsEncode(blk, spec.eccCodewordsPerBlock));
  }

  const finalCodewords: number[] = [];
  for (let i = 0; i < blockSize; i++) {
    for (let b = 0; b < spec.numBlocks; b++) finalCodewords.push(dataBlocks[b][i]);
  }
  for (let i = 0; i < spec.eccCodewordsPerBlock; i++) {
    for (let b = 0; b < spec.numBlocks; b++) finalCodewords.push(eccBlocks[b][i]);
  }

  const size = spec.size;
  const modules: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const isFunc: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  const setFunctionModule = (r: number, c: number, dark: boolean) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      modules[r][c] = dark;
      isFunc[r][c] = true;
    }
  };

  // Finder patterns + separators
  const drawFinder = (r0: number, c0: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const rr = r0 + dr;
        const cc = c0 + dc;
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6 && (dr === 0 || dr === 6 || dc === 0 || dc === 6);
        const inInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFunctionModule(rr, cc, inOuter || inInner);
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setFunctionModule(6, i, i % 2 === 0);
    setFunctionModule(i, 6, i % 2 === 0);
  }

  // Alignment patterns
  const align = spec.alignment;
  for (let i = 0; i < align.length; i++) {
    for (let j = 0; j < align.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) continue;
      const ar = align[i];
      const ac = align[j];
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          setFunctionModule(ar + dr, ac + dc, dark);
        }
      }
    }
  }

  // Reserve format info & dark module
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      setFunctionModule(8, i, false);
      setFunctionModule(i, 8, false);
    }
    if (i < 8) {
      setFunctionModule(8, size - 1 - i, false);
      setFunctionModule(size - 1 - i, 8, false);
    }
  }
  setFunctionModule(size - 8, 8, true);

  // Place data bits in upward/downward 2-column zigzag
  let bitIdx = 0;
  const totalBits = finalCodewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      const upward = ((right + 1) & 2) === 0;
      const r = upward ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (!isFunc[r][c]) {
          let dark = false;
          if (bitIdx < totalBits) {
            dark = ((finalCodewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1) === 1;
            bitIdx++;
          }
          // Apply Mask 0: (r + c) % 2 === 0
          if ((r + c) % 2 === 0) dark = !dark;
          modules[r][c] = dark;
        }
      }
    }
  }

  // Format bits for ECC Level L (01) + Mask 0 (000) -> 0x77c4 (30660)
  const formatBits = 0x77c4;
  // ISO/IEC 18004 Section 6.9: Format info is placed MSB first (bit 14 down to bit 0)
  const getFmtBit = (i: number) => ((formatBits >>> (14 - i)) & 1) === 1;

  for (let i = 0; i <= 5; i++) modules[8][i] = getFmtBit(i);
  modules[8][7] = getFmtBit(6);
  modules[8][8] = getFmtBit(7);
  modules[7][8] = getFmtBit(8);
  for (let i = 9; i < 15; i++) modules[14 - i][8] = getFmtBit(i);

  for (let i = 0; i < 8; i++) modules[size - 1 - i][8] = getFmtBit(i);
  for (let i = 8; i < 15; i++) modules[8][size - 15 + i] = getFmtBit(i);

  return modules;
}

export function renderQrSvgPath(matrix: boolean[][], margin = 4): { size: number; path: string } {
  const n = matrix.length;
  const total = n + margin * 2;
  const parts: string[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (matrix[r][c]) {
        parts.push(`M${c + margin},${r + margin}h1v1h-1z`);
      }
    }
  }
  return { size: total, path: parts.join('') };
}
