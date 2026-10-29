// TypeScript bindings for emscripten-generated code.  Automatically generated at compile time.
interface WasmModule {
}

type EmbindString = ArrayBuffer|Uint8Array|Uint8ClampedArray|Int8Array|string;
export interface ClassHandle {
  isAliasOf(other: ClassHandle): boolean;
  delete(): void;
  deleteLater(): this;
  isDeleted(): boolean;
  // @ts-ignore - If targeting lower than ESNext, this symbol might not exist.
  [Symbol.dispose](): void;
  clone(): this;
}
export interface AvoidRouter extends ClassHandle {
  addShape(_0: number, _1: any): void;
  moveShape(_0: number, _1: any): void;
  deleteShape(_0: number): void;
  addConnector(_0: number, _1: boolean): void;
  setRoutingType(_0: number, _1: boolean): void;
  setEndpoints(_0: number, _1: number, _2: number, _3: number, _4: number): void;
  makePathInvalid(_0: number): void;
  isInitialised(_0: number): boolean;
  deleteConnector(_0: number): void;
  processTransaction(): boolean;
  takeChanged(): any;
  route(_0: number, _1: number): any;
}

interface EmbindModule {
  boolop(_0: EmbindString, _1: EmbindString, _2: number, _3: number, _4: number): string;
  cutPath(_0: EmbindString, _1: EmbindString): any;
  splitNonIntersectingPaths(_0: EmbindString, _1: number): any;
  pathsOverlap(_0: EmbindString, _1: EmbindString): boolean;
  tweakPath(_0: EmbindString, _1: number, _2: number, _3: number, _4: number, _5: number, _6: number, _7: number, _8: number, _9: number, _10: number, _11: number, _12: number, _13: number, _14: number, _15: number, _16: number, _17: number): any;
  normalizePath(_0: EmbindString, _1: number): string;
  flattenPath(_0: EmbindString, _1: number): string;
  pathCrossings(_0: EmbindString, _1: EmbindString): any;
  simplifyPath(_0: EmbindString, _1: number, _2: number, _3: boolean): string;
  offsetPath(_0: EmbindString, _1: number, _2: number, _3: number, _4: number, _5: number, _6: number, _7: number): any;
  bendPath(_0: EmbindString, _1: EmbindString, _2: number, _3: number, _4: number, _5: number, _6: number, _7: boolean, _8: boolean, _9: boolean): string;
  pathBounds(_0: EmbindString, _1: boolean, _2: number, _3: number, _4: number, _5: number, _6: number, _7: number): any;
  transformPath(_0: EmbindString, _1: number, _2: number, _3: number, _4: number, _5: number, _6: number): string;
  reversePath(_0: EmbindString): string;
  writePath(_0: EmbindString, _1: number, _2: boolean, _3: boolean): string;
  readPath(_0: EmbindString, _1: number): any;
  AvoidRouter: {
    new(): AvoidRouter;
  };
}

export type MainModule = WasmModule & EmbindModule;
export default function MainModuleFactory (options?: unknown): Promise<MainModule>;
