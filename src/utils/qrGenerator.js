/**
 * مولّد رموز QR Code محلي 100% بدون أي خوادم خارجية (Pure JS ISO/IEC 18004 -> Sharp SVG)
 * - يدعم ترميز الروابط الكاملة (Byte Mode UTF-8) لمستوى تصحيح أخطاء M (الإصدارات 1 إلى 10)
 * - مثالي لأمان hostToken: لا يغادر أي رابط المتصفح مطلقاً
 */
(function () {
  "use strict";

  // جداول Galois Field GF(256) بكثيرة الحدود 0x11D
  const GF_EXP = new Uint8Array(512);
  const GF_LOG = new Uint8Array(256);
  (function initGF() {
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

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return GF_EXP[GF_LOG[a] + GF_LOG[b]];
  }

  function rsGeneratorPoly(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i++) {
      const next = new Array(poly.length + 1).fill(0);
      const factor = GF_EXP[i];
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], factor);
      }
      poly = next;
    }
    return poly;
  }

  function rsComputeRemainder(data, ecLen) {
    const gen = rsGeneratorPoly(ecLen);
    const res = new Uint8Array(ecLen);
    for (let i = 0; i < data.length; i++) {
      const factor = data[i] ^ res[0];
      for (let j = 0; j < ecLen - 1; j++) {
        res[j] = res[j + 1];
      }
      res[ecLen - 1] = 0;
      if (factor !== 0) {
        for (let j = 0; j < ecLen; j++) {
          res[j] ^= gfMul(gen[j + 1], factor);
        }
      }
    }
    return res;
  }

  // مواصفات الإصدارات 1..10 لمستوى تصحيح الأخطاء M (Format bits: 00 -> index 0)
  // [version, totalDataCodewords, ecPerBlock, [[blockCount, dataPerBlock], ...], alignmentCenters]
  const VERSION_SPECS_M = [
    null,
    { v: 1, dataCap: 16, ecPerBlock: 10, blocks: [[1, 16]], align: [] },
    { v: 2, dataCap: 28, ecPerBlock: 16, blocks: [[1, 28]], align: [6, 18] },
    { v: 3, dataCap: 44, ecPerBlock: 26, blocks: [[1, 44]], align: [6, 22] },
    { v: 4, dataCap: 64, ecPerBlock: 18, blocks: [[2, 32]], align: [6, 26] },
    { v: 5, dataCap: 86, ecPerBlock: 24, blocks: [[2, 43]], align: [6, 30] },
    { v: 6, dataCap: 108, ecPerBlock: 16, blocks: [[4, 27]], align: [6, 34] },
    { v: 7, dataCap: 124, ecPerBlock: 18, blocks: [[4, 31]], align: [6, 22, 38] },
    { v: 8, dataCap: 154, ecPerBlock: 22, blocks: [[2, 38], [2, 39]], align: [6, 24, 42] },
    { v: 9, dataCap: 182, ecPerBlock: 22, blocks: [[3, 36], [2, 37]], align: [6, 26, 46] },
    { v: 10, dataCap: 216, ecPerBlock: 26, blocks: [[4, 43], [1, 44]], align: [6, 28, 50] }
  ];

  // بتات معلومات الإصدار لـ V7..V10 (BCH 18,6)
  const VERSION_INFO_BITS = {
    7: 0x07c94,
    8: 0x085bc,
    9: 0x09a99,
    10: 0x0a4d3
  };

  function encodeUtf8Bytes(str) {
    if (typeof TextEncoder !== "undefined") {
      return Array.from(new TextEncoder().encode(str));
    }
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
      let c = str.charCodeAt(i);
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) {
        bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      } else {
        bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    }
    return bytes;
  }

  function pickVersionSpec(byteLen) {
    for (let v = 1; v < VERSION_SPECS_M.length; v++) {
      const spec = VERSION_SPECS_M[v];
      const countBits = v <= 9 ? 8 : 16;
      const neededBits = 4 + countBits + byteLen * 8;
      if (neededBits <= spec.dataCap * 8) {
        return spec;
      }
    }
    throw new Error("QR payload too long for versions 1-10 (max ~213 bytes).");
  }

  function buildCodewords(bytes, spec) {
    const bits = [];
    const pushBits = (val, len) => {
      for (let i = len - 1; i >= 0; i--) {
        bits.push((val >>> i) & 1);
      }
    };

    // Mode indicator: 0100 (Byte)
    pushBits(0x4, 4);
    const countBits = spec.v <= 9 ? 8 : 16;
    pushBits(bytes.length, countBits);
    for (let i = 0; i < bytes.length; i++) {
      pushBits(bytes[i], 8);
    }

    const totalDataBits = spec.dataCap * 8;
    const terminator = Math.min(4, totalDataBits - bits.length);
    for (let i = 0; i < terminator; i++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);

    const dataCodewords = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      dataCodewords.push(b);
    }

    const padBytes = [0xec, 0x11];
    let padIdx = 0;
    while (dataCodewords.length < spec.dataCap) {
      dataCodewords.push(padBytes[padIdx % 2]);
      padIdx++;
    }

    // تقسيم إلى كتل وتوليد رموز Reed-Solomon ثم التداخل (Interleaving)
    const dataBlocks = [];
    const ecBlocks = [];
    let offset = 0;
    spec.blocks.forEach(([count, len]) => {
      for (let b = 0; b < count; b++) {
        const slice = dataCodewords.slice(offset, offset + len);
        offset += len;
        dataBlocks.push(slice);
        ecBlocks.push(Array.from(rsComputeRemainder(slice, spec.ecPerBlock)));
      }
    });

    const maxDataLen = Math.max(...dataBlocks.map((b) => b.length));
    const interleaved = [];
    for (let i = 0; i < maxDataLen; i++) {
      for (let b = 0; b < dataBlocks.length; b++) {
        if (i < dataBlocks[b].length) interleaved.push(dataBlocks[b][i]);
      }
    }
    for (let i = 0; i < spec.ecPerBlock; i++) {
      for (let b = 0; b < ecBlocks.length; b++) {
        interleaved.push(ecBlocks[b][i]);
      }
    }
    return interleaved;
  }

  function computeFormatBits(maskId) {
    // EC Level M = 00 (2 bits) + maskId (3 bits)
    const data = (0x00 << 3) | (maskId & 7);
    let rem = data << 10;
    const poly = 0x537;
    for (let i = 14; i >= 10; i--) {
      if ((rem >>> i) & 1) {
        rem ^= poly << (i - 10);
      }
    }
    return ((data << 10) | rem) ^ 0x5412;
  }

  function applyMaskCondition(maskId, r, c) {
    switch (maskId) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
      default: return false;
    }
  }

  function createBaseMatrix(spec) {
    const size = spec.v * 4 + 17;
    const modules = Array.from({ length: size }, () => new Uint8Array(size));
    const isFunc = Array.from({ length: size }, () => new Uint8Array(size));

    const setFunc = (r, c, dark) => {
      if (r < 0 || c < 0 || r >= size || c >= size) return;
      modules[r][c] = dark ? 1 : 0;
      isFunc[r][c] = 1;
    };

    // 1) Finder patterns + separators
    const drawFinder = (topR, topC) => {
      for (let dr = -1; dr <= 7; dr++) {
        for (let dc = -1; dc <= 7; dc++) {
          const r = topR + dr;
          const c = topC + dc;
          if (r < 0 || c < 0 || r >= size || c >= size) continue;
          const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
          const dark =
            inOuter &&
            (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
          setFunc(r, c, dark);
        }
      }
    };
    drawFinder(0, 0);
    drawFinder(0, size - 7);
    drawFinder(size - 7, 0);

    // 2) Timing patterns
    for (let i = 8; i < size - 8; i++) {
      const dark = i % 2 === 0;
      setFunc(6, i, dark);
      setFunc(i, 6, dark);
    }

    // 3) Alignment patterns
    const centers = spec.align;
    for (let i = 0; i < centers.length; i++) {
      for (let j = 0; j < centers.length; j++) {
        const cr = centers[i];
        const cc = centers[j];
        if (isFunc[cr][cc]) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const dist = Math.max(Math.abs(dr), Math.abs(dc));
            setFunc(cr + dr, cc + dc, dist !== 1);
          }
        }
      }
    }

    // 4) Reserve Format Info areas + Dark Module
    for (let i = 0; i <= 8; i++) {
      if (i !== 6) {
        setFunc(8, i, false);
        setFunc(i, 8, false);
      }
    }
    for (let i = 0; i < 8; i++) {
      setFunc(8, size - 1 - i, false);
    }
    for (let i = 0; i < 7; i++) {
      setFunc(size - 1 - i, 8, false);
    }
    setFunc(size - 8, 8, true); // Dark Module

    // 5) Version Info (versions 7+)
    if (spec.v >= 7 && VERSION_INFO_BITS[spec.v]) {
      const vBits = VERSION_INFO_BITS[spec.v];
      for (let i = 0; i < 18; i++) {
        const bit = Boolean((vBits >>> i) & 1);
        const a = Math.floor(i / 3);
        const b = size - 11 + (i % 3);
        setFunc(a, b, bit);
        setFunc(b, a, bit);
      }
    }

    return { size, modules, isFunc };
  }

  function placeDataBits(base, codewords) {
    const { size, modules, isFunc } = base;
    let bitIdx = 0;
    const totalBits = codewords.length * 8;
    let upward = true;

    for (let col = size - 1; col >= 1; col -= 2) {
      if (col === 6) col = 5;
      for (let step = 0; step < size; step++) {
        const r = upward ? size - 1 - step : step;
        for (let d = 0; d < 2; d++) {
          const c = col - d;
          if (!isFunc[r][c]) {
            let bit = 0;
            if (bitIdx < totalBits) {
              const byteVal = codewords[bitIdx >>> 3];
              bit = (byteVal >>> (7 - (bitIdx & 7))) & 1;
              bitIdx++;
            }
            modules[r][c] = bit;
          }
        }
      }
      upward = !upward;
    }
  }

  function drawFormatInfo(modules, size, maskId) {
    const bits = computeFormatBits(maskId);
    const getBit = (idx) => (bits >>> idx) & 1;

    // Top-left around finder
    const coords1 = [
      [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
      [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]
    ];
    for (let i = 0; i < 15; i++) {
      modules[coords1[i][0]][coords1[i][1]] = getBit(14 - i);
    }

    // Bottom-left & top-right
    for (let i = 0; i < 7; i++) {
      modules[size - 1 - i][8] = getBit(14 - i);
    }
    for (let i = 0; i < 8; i++) {
      modules[8][size - 8 + i] = getBit(7 - i);
    }
  }

  function scoreMatrix(modules, size) {
    let penalty = 0;
    let darkCount = 0;

    // Rule 1: 5+ same color in row/col
    for (let r = 0; r < size; r++) {
      let runVal = modules[r][0];
      let runLen = 1;
      for (let c = 1; c < size; c++) {
        if (modules[r][c] === runVal) {
          runLen++;
        } else {
          if (runLen >= 5) penalty += 3 + (runLen - 5);
          runVal = modules[r][c];
          runLen = 1;
        }
      }
      if (runLen >= 5) penalty += 3 + (runLen - 5);
    }
    for (let c = 0; c < size; c++) {
      let runVal = modules[0][c];
      let runLen = 1;
      for (let r = 1; r < size; r++) {
        if (modules[r][c] === runVal) {
          runLen++;
        } else {
          if (runLen >= 5) penalty += 3 + (runLen - 5);
          runVal = modules[r][c];
          runLen = 1;
        }
      }
      if (runLen >= 5) penalty += 3 + (runLen - 5);
    }

    // Rule 2: 2x2 blocks + darkCount
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const v = modules[r][c];
        if (v) darkCount++;
        if (
          r < size - 1 &&
          c < size - 1 &&
          v === modules[r][c + 1] &&
          v === modules[r + 1][c] &&
          v === modules[r + 1][c + 1]
        ) {
          penalty += 3;
        }
      }
    }

    // Rule 4: dark ratio balance
    const total = size * size;
    const pct = (darkCount * 100) / total;
    const k = Math.floor(Math.abs(pct - 50) / 5);
    penalty += k * 10;
    return penalty;
  }

  function generateMatrix(text) {
    const cleanText = String(text || "");
    const bytes = encodeUtf8Bytes(cleanText);
    const spec = pickVersionSpec(bytes.length);
    const codewords = buildCodewords(bytes, spec);
    const base = createBaseMatrix(spec);
    placeDataBits(base, codewords);

    let bestMask = 0;
    let bestScore = Infinity;
    let bestModules = null;

    for (let mask = 0; mask < 8; mask++) {
      const candidate = base.modules.map((row, r) => {
        const copy = new Uint8Array(row);
        for (let c = 0; c < base.size; c++) {
          if (!base.isFunc[r][c] && applyMaskCondition(mask, r, c)) {
            copy[c] ^= 1;
          }
        }
        return copy;
      });
      drawFormatInfo(candidate, base.size, mask);
      const sc = scoreMatrix(candidate, base.size);
      if (sc < bestScore) {
        bestScore = sc;
        bestMask = mask;
        bestModules = candidate;
      }
    }

    return {
      version: spec.v,
      mask: bestMask,
      size: base.size,
      modules: bestModules
    };
  }

  function toSVG(text, options = {}) {
    const {
      size = 220,
      margin = 3,
      dark = "#0b1228",
      light = "#ffffff",
      ariaLabel = "رمز QR"
    } = options;

    const qr = generateMatrix(text);
    const viewDim = qr.size + margin * 2;
    const paths = [];

    for (let r = 0; r < qr.size; r++) {
      for (let c = 0; c < qr.size; c++) {
        if (qr.modules[r][c]) {
          paths.push(`M${c + margin},${r + margin}h1v1h-1z`);
        }
      }
    }

    const safeLabel = String(ariaLabel).replace(/"/g, "&quot;");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewDim} ${viewDim}" width="${size}" height="${size}" role="img" aria-label="${safeLabel}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="${light}" rx="2"/><path d="${paths.join("")}" fill="${dark}"/></svg>`;
  }

  window.SeenJeemQR = {
    generateMatrix,
    toSVG
  };
})();
