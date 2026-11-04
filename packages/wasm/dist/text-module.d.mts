// TypeScript bindings for emscripten-generated code.  Automatically generated at compile time.
interface WasmModule {
}

type EmbindString = ArrayBuffer|Uint8Array|Uint8ClampedArray|Int8Array|string;
interface EmbindModule {
  faceCount(_0: EmbindString): number;
  faceCreate(_0: EmbindString, _1: number): number;
  faceClone(_0: number): number;
  faceDestroy(_0: number): void;
  upem(_0: number): number;
  table(_0: number, _1: EmbindString): any;
  tableList(_0: number): string;
  nominalGlyph(_0: number, _1: number): number;
  glyphMetrics(_0: number, _1: number): any;
  hasVExtents(_0: number): boolean;
  glyphPath(_0: number, _1: number): string;
  setVariations(_0: number, _1: EmbindString): void;
  setSyntheticBold(_0: number, _1: number, _2: number): void;
  shape(_0: number, _1: any, _2: number, _3: number, _4: number, _5: EmbindString, _6: EmbindString, _7: EmbindString): any;
  name(_0: number, _1: number): string;
  gsubTables(_0: number): string;
  varAxes(_0: number): string;
  scripts(_0: any): any;
  bidiLevels(_0: any, _1: boolean): any;
  lineBreaks(_0: any, _1: EmbindString): any;
  wordBreaks(_0: any, _1: EmbindString): any;
  graphemeBreaks(_0: any): any;
}

export type MainModule = WasmModule & EmbindModule;
export default function MainModuleFactory (options?: unknown): Promise<MainModule>;
