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

export interface TextShape extends ClassHandle {
  hasEdges(): boolean;
  bbox(): any;
}

export interface TextScanlineMaker extends ClassHandle {
  makeScanline(_0: number, _1: number): any;
  completeLine(): void;
  yCoordinate(): number;
  setNewYCoordinate(_0: number): void;
  canExtendCurrentScanline(_0: number, _1: number): boolean;
  setLineHeight(_0: number, _1: number): void;
}

export interface TextPathPath extends ClassHandle {
  empty(): boolean;
  closed(): boolean;
  length(): number;
  position(_0: number): any;
  lastPiece(): number;
  pointAndTangentAt(_0: number, _1: number): any;
  pointAt(_0: number, _1: number): any;
  onSameSubpath(_0: number, _1: number): boolean;
  nearestLength(_0: number, _1: number): number;
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
  strokeOutline(_0: EmbindString, _1: number, _2: number, _3: number, _4: number): string;
  nodesatTimeAtArcLength(_0: EmbindString, _1: number): number;
  nodesatArcLengthAt(_0: EmbindString, _1: number): number;
  nodesatRadToLen(_0: number, _1: EmbindString, _2: EmbindString): number;
  nodesatLenToRad(_0: number, _1: EmbindString, _2: EmbindString): number;
  bendPath(_0: EmbindString, _1: EmbindString, _2: number, _3: number, _4: number, _5: number, _6: number, _7: boolean, _8: boolean, _9: boolean): string;
  pathBounds(_0: EmbindString, _1: boolean, _2: number, _3: number, _4: number, _5: number, _6: number, _7: number): any;
  transformPath(_0: EmbindString, _1: number, _2: number, _3: number, _4: number, _5: number, _6: number): string;
  reversePath(_0: EmbindString): string;
  writePath(_0: EmbindString, _1: number, _2: boolean, _3: boolean): string;
  readPath(_0: EmbindString, _1: number): any;
  spiroRun(_0: any, _1: EmbindString): string;
  taperStretchAlong(_0: EmbindString, _1: EmbindString, _2: number): string;
  halfOutline(_0: EmbindString, _1: number, _2: number, _3: number): string;
  envelopePath(_0: EmbindString, _1: EmbindString, _2: EmbindString, _3: EmbindString, _4: EmbindString, _5: number, _6: number, _7: number, _8: number, _9: boolean, _10: boolean): string;
  patternAlongPath(_0: EmbindString, _1: EmbindString, _2: number, _3: number, _4: number, _5: number, _6: boolean, _7: boolean, _8: number, _9: boolean, _10: number): string;
  joinTypePath(_0: EmbindString, _1: number, _2: number, _3: boolean, _4: number, _5: number): string;
  dashedStrokePath(_0: EmbindString, _1: number, _2: number, _3: boolean, _4: boolean, _5: boolean): string;
  interpolatePath(_0: EmbindString, _1: EmbindString, _2: number, _3: boolean): string;
  sketchPath(_0: EmbindString, _1: any, _2: any, _3: number, _4: number, _5: number, _6: number, _7: number, _8: number, _9: number): string;
  powerstrokePath(_0: EmbindString, _1: any, _2: boolean, _3: boolean, _4: number, _5: number, _6: number, _7: number, _8: number, _9: number): string;
  identityPwd2Path(_0: EmbindString): string;
  recursiveSkeletonPath(_0: EmbindString, _1: number): string;
  extrudePath(_0: EmbindString, _1: number, _2: number): string;
  gearsPath(_0: EmbindString, _1: number, _2: number, _3: number): string;
  latticePath(_0: EmbindString, _1: any, _2: number, _3: number, _4: number, _5: number): string;
  lattice2Path(_0: EmbindString, _1: any, _2: number, _3: number, _4: number, _5: number): string;
  roughHatchesPath(_0: EmbindString, _1: any, _2: any, _3: any): string;
  dynastrokePath(_0: EmbindString, _1: number, _2: number, _3: number, _4: number, _5: number, _6: number, _7: number, _8: number): string;
  knotCrossings(_0: EmbindString): any;
  knotComponent(_0: EmbindString, _1: number, _2: any, _3: any, _4: any): string;
  embroderyStitchPath(_0: EmbindString, _1: any): string;
  curvePointAndDerivatives(_0: EmbindString, _1: number, _2: number): any;
  pathNearestFlatTime(_0: EmbindString, _1: number, _2: number): number;
  pwd2Transformed(_0: EmbindString, _1: any): string;
  pwd2Samples(_0: EmbindString, _1: any): any;
  arcLengthSamples(_0: EmbindString, _1: any): any;
  pwd2Length(_0: EmbindString): number;
  rulerPath(_0: EmbindString, _1: number, _2: number, _3: number, _4: number, _5: number, _6: number, _7: number, _8: number, _9: number, _10: number, _11: number, _12: number): string;
  interpolatePoints(_0: any, _1: number): string;
  removeOverlaps(_0: any): any;
  normalizeShape(_0: EmbindString, _1: number): string;
  offsetShape(_0: EmbindString, _1: number, _2: number, _3: number, _4: number): string;
  offsetOriginal(_0: EmbindString, _1: number, _2: number): string;
  strokeToPath(_0: EmbindString, _1: number, _2: number, _3: number, _4: number, _5: any, _6: number, _7: number): string;
  AvoidRouter: {
    new(): AvoidRouter;
  };
  potraceTrace(_0: any, _1: number, _2: number, _3: number, _4: number, _5: number, _6: number): any;
  rgbMapQuantize(_0: any, _1: number, _2: number, _3: number): any;
  rgbMapGaussian(_0: any, _1: number, _2: number): any;
  grayMapGaussian(_0: any, _1: number, _2: number): any;
  grayMapCanny(_0: any, _1: number, _2: number, _3: number, _4: number): any;
  quantizeBand(_0: any, _1: number, _2: number, _3: number): any;
  floodPathData(_0: EmbindString, _1: number): string;
  TextShape: {
    booleen(_0: TextShape, _1: TextShape, _2: number): TextShape | null;
    copy(_0: TextShape): TextShape | null;
    inclusion(_0: EmbindString, _1: any, _2: number): TextShape | null;
    exclusion(_0: EmbindString, _1: any, _2: number): TextShape | null;
    region(_0: EmbindString, _1: any, _2: boolean): TextShape | null;
    rect(_0: number, _1: number, _2: number, _3: number): TextShape | null;
  };
  TextScanlineMaker: {
    new(_0: TextShape, _1: number): TextScanlineMaker;
  };
  TextPathPath: {
    new(_0: EmbindString, _1: any): TextPathPath;
  };
}

export type MainModule = WasmModule & EmbindModule;
export default function MainModuleFactory (options?: unknown): Promise<MainModule>;
