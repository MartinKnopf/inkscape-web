// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/lib-gif.h
/*
 * A simple, limited way to create animated GIFs (https://github.com/charlietangora/gif-h).
 *
 * gif.h
 * by Charlie Tangora
 * Public domain.
 *
 * It is a straight-ahead implementation of the GIF format with optional Floyd-Steinberg
 * dithering. It uses delta encoding: only the changed portions of each frame are saved.
 * Only RGBA8 is supported as an input format (the alpha is ignored).
 *
 * Use: GifBegin() starts the writer and the header, GifWriteFrame() adds the frames, GifEnd()
 * returns the file data.
 */

const kGifTransIndex = 0;

interface GifPalette {
  bitDepth: number;
  r: Uint8Array;
  g: Uint8Array;
  b: Uint8Array;
  // k-d tree over RGB space, organized in heap fashion, i.e. left child of node i is node i*2,
  // right child is node i*2+1. Nodes 256-511 are implicitly the leaves, containing a color.
  treeSplitElt: Uint8Array;
  treeSplit: Uint8Array;
}

/**
 * Walk the k-d tree to pick the palette entry for a desired color (upstream
 * GifGetClosestPaletteColor). The current best color and its error are in best; they change
 * only if a better color is in the subtree.
 */
function GifGetClosestPaletteColor(
  pal: GifPalette,
  r: number,
  g: number,
  b: number,
  best: { ind: number; diff: number },
  treeRoot: number,
): void {
  // base case, reached the bottom of the tree
  if (treeRoot > (1 << pal.bitDepth) - 1) {
    const ind = treeRoot - (1 << pal.bitDepth);
    if (ind === kGifTransIndex) return;

    // check whether this color is better than the current winner
    const diff = Math.abs(r - pal.r[ind]!) + Math.abs(g - pal.g[ind]!) + Math.abs(b - pal.b[ind]!);
    if (diff < best.diff) {
      best.ind = ind;
      best.diff = diff;
    }
    return;
  }

  // take the appropriate color (r, g, or b) for this node of the k-d tree
  const comps = [r, g, b];
  const splitComp = comps[pal.treeSplitElt[treeRoot]!]!;

  const splitPos = pal.treeSplit[treeRoot]!;
  if (splitPos > splitComp) {
    // check the left subtree
    GifGetClosestPaletteColor(pal, r, g, b, best, treeRoot * 2);
    if (best.diff > splitPos - splitComp) {
      // cannot prove there's not a better value in the right subtree, check that too
      GifGetClosestPaletteColor(pal, r, g, b, best, treeRoot * 2 + 1);
    }
  } else {
    GifGetClosestPaletteColor(pal, r, g, b, best, treeRoot * 2 + 1);
    if (best.diff > splitComp - splitPos) {
      GifGetClosestPaletteColor(pal, r, g, b, best, treeRoot * 2);
    }
  }
}

/** Swap two pixels of image (upstream GifSwapPixels, including its use of pixA's alpha). */
function GifSwapPixels(image: Uint8Array, base: number, pixA: number, pixB: number): void {
  const a = base + pixA * 4;
  const b = base + pixB * 4;
  const rA = image[a]!;
  const gA = image[a + 1]!;
  const bA = image[a + 2]!;
  const aA = image[a + 3]!;

  const rB = image[b]!;
  const gB = image[b + 1]!;
  const bB = image[b + 2]!;
  const aB = image[a + 3]!;

  image[a] = rB;
  image[a + 1] = gB;
  image[a + 2] = bB;
  image[a + 3] = aB;

  image[b] = rA;
  image[b + 1] = gA;
  image[b + 2] = bA;
  image[b + 3] = aA;
}

/** Just the partition operation from quicksort. */
function GifPartition(
  image: Uint8Array,
  base: number,
  left: number,
  right: number,
  elt: number,
  pivotValue: number,
): number {
  let storeIndex = left;
  let split = false;
  for (let ii = left; ii < right; ++ii) {
    const arrayVal = image[base + ii * 4 + elt]!;
    if (arrayVal < pivotValue) {
      GifSwapPixels(image, base, ii, storeIndex);
      ++storeIndex;
    } else if (arrayVal === pivotValue) {
      if (split) {
        GifSwapPixels(image, base, ii, storeIndex);
        ++storeIndex;
      }
      split = !split;
    }
  }
  return storeIndex;
}

/** Perform an incomplete sort, finding all elements above and below the desired median. */
function GifPartitionByMedian(
  image: Uint8Array,
  base: number,
  left: number,
  right: number,
  com: number,
  neededCenter: number,
): void {
  if (left < right - 1) {
    const pivotValue = image[base + neededCenter * 4 + com]!;
    GifSwapPixels(image, base, neededCenter, right - 1);
    const pivotIndex = GifPartition(image, base, left, right - 1, com, pivotValue);
    GifSwapPixels(image, base, pivotIndex, right - 1);

    // Only "sort" the section of the array that contains the median
    if (pivotIndex > neededCenter) GifPartitionByMedian(image, base, left, pivotIndex, com, neededCenter);
    if (pivotIndex < neededCenter)
      GifPartitionByMedian(image, base, pivotIndex + 1, right, com, neededCenter);
  }
}

/** Just partition around a given pivot, returning the split point. */
function GifPartitionByMean(
  image: Uint8Array,
  base: number,
  left: number,
  right: number,
  com: number,
  neededMean: number,
): number {
  if (left < right - 1) return GifPartition(image, base, left, right - 1, com, neededMean);
  return left;
}

/**
 * Build a palette by creating a balanced k-d tree of all pixels in the image. The pixels of
 * image from base on are sorted by it.
 */
function GifSplitPalette(
  image: Uint8Array,
  base: number,
  numPixels: number,
  treeNode: number,
  treeLevel: number,
  buildForDither: boolean,
  pal: GifPalette,
): void {
  if (numPixels === 0) return;

  const numColors = 1 << pal.bitDepth;

  // base case, bottom of the tree
  if (treeNode >= numColors) {
    const entry = treeNode - numColors;

    if (buildForDither) {
      // Dithering needs at least one color as dark as anything in the image and at least one
      // brightest color - otherwise it builds up error and produces strange artifacts
      if (entry === 1) {
        // special case: the darkest color in the image
        let r = 255;
        let g = 255;
        let b = 255;
        for (let ii = 0; ii < numPixels; ++ii) {
          r = Math.min(r, image[base + ii * 4]!);
          g = Math.min(g, image[base + ii * 4 + 1]!);
          b = Math.min(b, image[base + ii * 4 + 2]!);
        }
        pal.r[entry] = r;
        pal.g[entry] = g;
        pal.b[entry] = b;
        return;
      }

      if (entry === numColors - 1) {
        // special case: the lightest color in the image
        let r = 0;
        let g = 0;
        let b = 0;
        for (let ii = 0; ii < numPixels; ++ii) {
          r = Math.max(r, image[base + ii * 4]!);
          g = Math.max(g, image[base + ii * 4 + 1]!);
          b = Math.max(b, image[base + ii * 4 + 2]!);
        }
        pal.r[entry] = r;
        pal.g[entry] = g;
        pal.b[entry] = b;
        return;
      }
    }

    // otherwise, take the average of all colors in this subcube
    let r = 0;
    let g = 0;
    let b = 0;
    for (let ii = 0; ii < numPixels; ++ii) {
      r += image[base + ii * 4]!;
      g += image[base + ii * 4 + 1]!;
      b += image[base + ii * 4 + 2]!;
    }

    r += Math.floor(numPixels / 2); // round to nearest
    g += Math.floor(numPixels / 2);
    b += Math.floor(numPixels / 2);

    pal.r[entry] = Math.floor(r / numPixels);
    pal.g[entry] = Math.floor(g / numPixels);
    pal.b[entry] = Math.floor(b / numPixels);
    return;
  }

  // Find the axis with the largest range
  let minR = 255;
  let maxR = 0;
  let minG = 255;
  let maxG = 0;
  let minB = 255;
  let maxB = 0;
  for (let ii = 0; ii < numPixels; ++ii) {
    const r = image[base + ii * 4]!;
    const g = image[base + ii * 4 + 1]!;
    const b = image[base + ii * 4 + 2]!;

    if (r > maxR) maxR = r;
    if (r < minR) minR = r;
    if (g > maxG) maxG = g;
    if (g < minG) minG = g;
    if (b > maxB) maxB = b;
    if (b < minB) minB = b;
  }

  const rRange = maxR - minR;
  const gRange = maxG - minG;
  const bRange = maxB - minB;

  // and split along that axis. (incidentally, this means this isn't a "proper" k-d tree but I
  // don't know what else to call it)
  let splitCom = 1;
  let rangeMin = minG;
  let rangeMax = maxG;
  if (bRange > gRange) {
    splitCom = 2;
    rangeMin = minB;
    rangeMax = maxB;
  }
  if (rRange > bRange && rRange > gRange) {
    splitCom = 0;
    rangeMin = minR;
    rangeMax = maxR;
  }

  let subPixelsA = Math.floor(numPixels / 2);

  GifPartitionByMedian(image, base, 0, numPixels, splitCom, subPixelsA);
  let splitValue = image[base + subPixelsA * 4 + splitCom]!;

  // if the split is very unbalanced, split at the mean instead of the median to preserve rare colors
  const splitUnbalance = Math.abs(splitValue - rangeMin - (rangeMax - splitValue));
  if (splitUnbalance > 1536 >> treeLevel) {
    splitValue = rangeMin + Math.trunc((rangeMax - rangeMin) / 2);
    subPixelsA = GifPartitionByMean(image, base, 0, numPixels, splitCom, splitValue);
  }

  // add the bottom node for the transparency index
  if (treeNode === numColors / 2) {
    subPixelsA = 0;
    splitValue = 0;
  }

  const subPixelsB = numPixels - subPixelsA;
  pal.treeSplitElt[treeNode] = splitCom;
  pal.treeSplit[treeNode] = splitValue;

  GifSplitPalette(image, base, subPixelsA, treeNode * 2, treeLevel + 1, buildForDither, pal);
  GifSplitPalette(
    image,
    base + subPixelsA * 4,
    subPixelsB,
    treeNode * 2 + 1,
    treeLevel + 1,
    buildForDither,
    pal,
  );
}

/**
 * Find all pixels that have changed from the previous image and move them to the front of the
 * buffer. This allows us to build a palette optimized for the colors of the changed pixels only.
 */
function GifPickChangedPixels(lastFrame: Uint8Array, frame: Uint8Array, numPixels: number): number {
  let numChanged = 0;
  let writeIter = 0;
  for (let ii = 0; ii < numPixels; ++ii) {
    const i = ii * 4;
    if (lastFrame[i] !== frame[i] || lastFrame[i + 1] !== frame[i + 1] || lastFrame[i + 2] !== frame[i + 2]) {
      frame[writeIter] = frame[i]!;
      frame[writeIter + 1] = frame[i + 1]!;
      frame[writeIter + 2] = frame[i + 2]!;
      ++numChanged;
      writeIter += 4;
    }
  }
  return numChanged;
}

/**
 * Create a palette by placing all the image pixels in a k-d tree and then averaging the blocks
 * at the bottom. This is known as the "median split" technique.
 */
function GifMakePalette(
  lastFrame: Uint8Array | null,
  nextFrame: Uint8Array,
  width: number,
  height: number,
  bitDepth: number,
  buildForDither: boolean,
): GifPalette {
  const pal: GifPalette = {
    bitDepth,
    r: new Uint8Array(256),
    g: new Uint8Array(256),
    b: new Uint8Array(256),
    treeSplitElt: new Uint8Array(256),
    treeSplit: new Uint8Array(256),
  };

  // SplitPalette is destructive (it sorts the pixels by color) so we must create a copy of the
  // image for it to destroy
  const destroyableImage = nextFrame.slice(0, width * height * 4);

  let numPixels = width * height;
  if (lastFrame) numPixels = GifPickChangedPixels(lastFrame, destroyableImage, numPixels);

  GifSplitPalette(destroyableImage, 0, numPixels, 1, 0, buildForDither, pal);

  // add the bottom node for the transparency index
  pal.treeSplit[1 << (bitDepth - 1)] = 0;
  pal.treeSplitElt[1 << (bitDepth - 1)] = 0;

  pal.r[0] = pal.g[0] = pal.b[0] = 0;
  return pal;
}

/** Floyd-Steinberg dithering; writes the palette value to alpha (upstream GifDitherImage). */
function GifDitherImage(
  lastFrame: Uint8Array | null,
  nextFrame: Uint8Array,
  outFrame: Uint8Array,
  width: number,
  height: number,
  pal: GifPalette,
): void {
  const numPixels = width * height;

  // quantPixels initially holds color*256 for all pixels. The extra 8 bits of precision allow
  // for sub-single-color error values to be propagated.
  const quantPixels = new Int32Array(numPixels * 4);
  for (let ii = 0; ii < numPixels * 4; ++ii) quantPixels[ii] = nextFrame[ii]! * 256;

  const spread = (loc: number, r_err: number, g_err: number, b_err: number, num: number): void => {
    if (loc >= numPixels) return;
    const p = 4 * loc;
    quantPixels[p] = quantPixels[p]! + Math.max(-quantPixels[p]!, Math.trunc((r_err * num) / 16));
    quantPixels[p + 1] = quantPixels[p + 1]! + Math.max(-quantPixels[p + 1]!, Math.trunc((g_err * num) / 16));
    quantPixels[p + 2] = quantPixels[p + 2]! + Math.max(-quantPixels[p + 2]!, Math.trunc((b_err * num) / 16));
  };

  for (let yy = 0; yy < height; ++yy) {
    for (let xx = 0; xx < width; ++xx) {
      const n = 4 * (yy * width + xx);

      // Compute the colors we want (rounding to nearest)
      const rr = Math.trunc((quantPixels[n]! + 127) / 256);
      const gg = Math.trunc((quantPixels[n + 1]! + 127) / 256);
      const bb = Math.trunc((quantPixels[n + 2]! + 127) / 256);

      // if it happens that we want the color from last frame, then just write out a transparent pixel
      if (lastFrame && lastFrame[n] === rr && lastFrame[n + 1] === gg && lastFrame[n + 2] === bb) {
        quantPixels[n] = rr;
        quantPixels[n + 1] = gg;
        quantPixels[n + 2] = bb;
        quantPixels[n + 3] = kGifTransIndex;
        continue;
      }

      const best = { ind: kGifTransIndex, diff: 1000000 };

      // Search the palette
      GifGetClosestPaletteColor(pal, rr, gg, bb, best, 1);

      // Write the result to the temp buffer
      const r_err = quantPixels[n]! - pal.r[best.ind]! * 256;
      const g_err = quantPixels[n + 1]! - pal.g[best.ind]! * 256;
      const b_err = quantPixels[n + 2]! - pal.b[best.ind]! * 256;

      quantPixels[n] = pal.r[best.ind]!;
      quantPixels[n + 1] = pal.g[best.ind]!;
      quantPixels[n + 2] = pal.b[best.ind]!;
      quantPixels[n + 3] = best.ind;

      // Propagate the error to the four adjacent locations that we haven't touched yet
      spread(yy * width + xx + 1, r_err, g_err, b_err, 7);
      spread(yy * width + width + xx - 1, r_err, g_err, b_err, 3);
      spread(yy * width + width + xx, r_err, g_err, b_err, 5);
      spread(yy * width + width + xx + 1, r_err, g_err, b_err, 1);
    }
  }

  // Copy the palettized result to the output buffer
  for (let ii = 0; ii < numPixels * 4; ++ii) outFrame[ii] = quantPixels[ii]!;
}

/** Pick palette colors for the image using simple thresholding, no dithering. */
function GifThresholdImage(
  lastFrame: Uint8Array | null,
  nextFrame: Uint8Array,
  outFrame: Uint8Array,
  width: number,
  height: number,
  pal: GifPalette,
): void {
  const numPixels = width * height;
  for (let ii = 0; ii < numPixels; ++ii) {
    const i = ii * 4;
    // if a previous color is available, and it matches the current color, set the pixel to transparent
    if (
      lastFrame &&
      lastFrame[i] === nextFrame[i] &&
      lastFrame[i + 1] === nextFrame[i + 1] &&
      lastFrame[i + 2] === nextFrame[i + 2]
    ) {
      outFrame[i] = lastFrame[i]!;
      outFrame[i + 1] = lastFrame[i + 1]!;
      outFrame[i + 2] = lastFrame[i + 2]!;
      outFrame[i + 3] = kGifTransIndex;
    } else {
      // palettize the pixel
      const best = { ind: 1, diff: 1000000 };
      GifGetClosestPaletteColor(pal, nextFrame[i]!, nextFrame[i + 1]!, nextFrame[i + 2]!, best, 1);

      // Write the resulting color to the output buffer
      outFrame[i] = pal.r[best.ind]!;
      outFrame[i + 1] = pal.g[best.ind]!;
      outFrame[i + 2] = pal.b[best.ind]!;
      outFrame[i + 3] = best.ind;
    }
  }
}

/** The bytes of the file so far. */
class ByteSink {
  #bytes: number[] = [];
  put(...values: number[]): void {
    for (const v of values) this.#bytes.push(v & 0xff);
  }
  puts(text: string): void {
    for (const c of text) this.#bytes.push(c.charCodeAt(0));
  }
  write(chunk: ArrayLike<number>, length = chunk.length): void {
    for (let i = 0; i < length; i++) this.#bytes.push(chunk[i]!);
  }
  data(): Uint8Array {
    return Uint8Array.from(this.#bytes);
  }
}

/** Writes the LZW-compressed portion of the image one bit at a time. */
class GifBitStatus {
  chunkIndex = 0;
  chunk = new Uint8Array(256); // bytes are written in here until we have 255 of them, then written to the file
  bitIndex = 0; // how many bits in the partial byte written so far
  byte = 0; // current partial byte
}

/** Insert a single bit. */
function GifWriteBit(stat: GifBitStatus, bit: number): void {
  stat.byte |= (bit & 1) << stat.bitIndex;

  ++stat.bitIndex;
  if (stat.bitIndex > 7) {
    // move the newly-finished byte to the chunk buffer
    stat.chunk[stat.chunkIndex++] = stat.byte;
    // and start a new byte
    stat.bitIndex = 0;
    stat.byte = 0;
  }
}

/** Write all bytes so far to the file. */
function GifWriteChunk(f: ByteSink, stat: GifBitStatus): void {
  f.put(stat.chunkIndex);
  f.write(stat.chunk, stat.chunkIndex);

  stat.bitIndex = 0;
  stat.byte = 0;
  stat.chunkIndex = 0;
}

function GifWriteCode(f: ByteSink, stat: GifBitStatus, code: number, length: number): void {
  for (let ii = 0; ii < length; ++ii) {
    GifWriteBit(stat, code);
    code >>>= 1;

    if (stat.chunkIndex === 255) GifWriteChunk(f, stat);
  }
}

/** Write the palette (the first color is the transparency). */
function GifWritePalette(pal: GifPalette, f: ByteSink): void {
  f.put(0, 0, 0); // first color: transparency
  for (let ii = 1; ii < 1 << pal.bitDepth; ++ii) f.put(pal.r[ii]!, pal.g[ii]!, pal.b[ii]!);
}

/** Write the image header, LZW-compress and write out the image. */
function GifWriteLzwImage(
  f: ByteSink,
  image: Uint8Array,
  left: number,
  top: number,
  width: number,
  height: number,
  delay: number,
  pal: GifPalette,
): void {
  // graphics control extension
  f.put(0x21, 0xf9, 0x04);
  f.put(0x05); // leave prev frame in place, this frame has transparency
  f.put(delay & 0xff, (delay >> 8) & 0xff);
  f.put(kGifTransIndex); // transparent color index
  f.put(0);

  f.put(0x2c); // image descriptor block

  f.put(left & 0xff, (left >> 8) & 0xff); // corner of image in canvas space
  f.put(top & 0xff, (top >> 8) & 0xff);
  f.put(width & 0xff, (width >> 8) & 0xff); // width and height of image
  f.put(height & 0xff, (height >> 8) & 0xff);

  f.put(0x80 + pal.bitDepth - 1); // local color table present, 2 ^ bitDepth entries
  GifWritePalette(pal, f);

  const minCodeSize = pal.bitDepth;
  const clearCode = 1 << pal.bitDepth;

  f.put(minCodeSize); // min code size

  // The LZW dictionary is a 256-ary tree constructed as the file is encoded.
  const codetree = new Uint16Array(4096 * 256);

  let curCode = -1;
  let codeSize = minCodeSize + 1;
  let maxCode = clearCode + 1;

  const stat = new GifBitStatus();

  GifWriteCode(f, stat, clearCode, codeSize); // start with a fresh LZW dictionary

  for (let yy = 0; yy < height; ++yy) {
    for (let xx = 0; xx < width; ++xx) {
      // top-left origin
      const nextValue = image[(yy * width + xx) * 4 + 3]!;

      if (curCode < 0) {
        // first value in a new run
        curCode = nextValue;
      } else if (codetree[curCode * 256 + nextValue]) {
        // current run already in the dictionary
        curCode = codetree[curCode * 256 + nextValue]!;
      } else {
        // finish the current run, write a code
        GifWriteCode(f, stat, curCode, codeSize);

        // insert the new run into the dictionary
        codetree[curCode * 256 + nextValue] = ++maxCode;

        if (maxCode >= 2 ** codeSize) {
          // dictionary entry count has broken a size barrier, we need more bits for codes
          codeSize++;
        }
        if (maxCode === 4095) {
          // the dictionary is full, clear it out and begin anew
          GifWriteCode(f, stat, clearCode, codeSize); // clear tree

          codetree.fill(0);
          codeSize = minCodeSize + 1;
          maxCode = clearCode + 1;
        }

        curCode = nextValue;
      }
    }
  }

  // compression footer
  GifWriteCode(f, stat, curCode, codeSize);
  GifWriteCode(f, stat, clearCode, codeSize);
  GifWriteCode(f, stat, clearCode + 1, minCodeSize + 1);

  // write out the last partial chunk
  while (stat.bitIndex) GifWriteBit(stat, 0);
  if (stat.chunkIndex) GifWriteChunk(f, stat);

  f.put(0); // image block terminator
}

/** A GIF file in progress (upstream GifWriter). */
export class GifWriter {
  readonly #f = new ByteSink();
  readonly #oldImage: Uint8Array;
  #firstFrame = true;

  /**
   * Start a GIF (upstream GifBegin). The delay is the time between frames in hundredths of a
   * second (not all viewers pay attention to it); a delay of 0 makes a still image.
   */
  constructor(
    readonly width: number,
    readonly height: number,
    delay: number,
  ) {
    this.#oldImage = new Uint8Array(width * height * 4);
    const f = this.#f;
    f.puts('GIF89a');

    // screen descriptor
    f.put(width & 0xff, (width >> 8) & 0xff, height & 0xff, (height >> 8) & 0xff);

    f.put(0xf0); // there is an unsorted global color table of 2 entries
    f.put(0); // background color
    f.put(0); // pixels are square (we need to specify this because it's 1989)

    // now the "global" palette (really just a dummy palette): color 0 and 1 are black
    f.put(0, 0, 0, 0, 0, 0);

    if (delay !== 0) {
      // animation header
      f.put(0x21); // extension
      f.put(0xff); // application specific
      f.put(11); // length 11
      f.puts('NETSCAPE2.0');
      f.put(3); // 3 bytes of NETSCAPE2.0 data

      f.put(1); // this is the Netscape 2.0 sub-block ID and it must be 1, otherwise some viewers error
      f.put(0); // loop infinitely (byte 0)
      f.put(0); // loop infinitely (byte 1)

      f.put(0); // block terminator
    }
  }

  /**
   * Add a frame of RGBA8 pixels (upstream GifWriteFrame). Different frames may use different
   * bit depths.
   */
  writeFrame(image: Uint8Array | Uint8ClampedArray, delay: number, bitDepth = 8, dither = false): void {
    const frame =
      image instanceof Uint8Array ? image : new Uint8Array(image.buffer, image.byteOffset, image.length);
    const oldImage = this.#firstFrame ? null : this.#oldImage;
    this.#firstFrame = false;

    const pal = GifMakePalette(dither ? null : oldImage, frame, this.width, this.height, bitDepth, dither);

    if (dither) GifDitherImage(oldImage, frame, this.#oldImage, this.width, this.height, pal);
    else GifThresholdImage(oldImage, frame, this.#oldImage, this.width, this.height, pal);

    GifWriteLzwImage(this.#f, this.#oldImage, 0, 0, this.width, this.height, delay, pal);
  }

  /** Write the EOF code and return the file (upstream GifEnd). */
  end(): Uint8Array {
    this.#f.put(0x3b); // end of file
    return this.#f.data();
  }
}
