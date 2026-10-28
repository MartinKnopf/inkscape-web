// TypeScript bindings for emscripten-generated code.  Automatically generated at compile time.
interface WasmModule {
}

type EmbindString = ArrayBuffer|Uint8Array|Uint8ClampedArray|Int8Array|string;
interface EmbindModule {
  boolop(_0: EmbindString, _1: EmbindString, _2: number, _3: number, _4: number): string;
  cutPath(_0: EmbindString, _1: EmbindString): any;
  splitNonIntersectingPaths(_0: EmbindString, _1: number): any;
  normalizePath(_0: EmbindString, _1: number): string;
  pathBounds(_0: EmbindString, _1: boolean, _2: number, _3: number, _4: number, _5: number, _6: number, _7: number): any;
  transformPath(_0: EmbindString, _1: number, _2: number, _3: number, _4: number, _5: number, _6: number): string;
  reversePath(_0: EmbindString): string;
  writePath(_0: EmbindString, _1: number, _2: boolean, _3: boolean): string;
  readPath(_0: EmbindString, _1: number): any;
}

export type MainModule = WasmModule & EmbindModule;
export default function MainModuleFactory (options?: unknown): Promise<MainModule>;
