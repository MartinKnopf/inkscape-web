// TypeScript bindings for emscripten-generated code.  Automatically generated at compile time.
interface WasmModule {
}

interface EmbindModule {
  cdrParse(_0: any): any;
  vsdParse(_0: any): any;
  wpgParse(_0: any): any;
}

export type MainModule = WasmModule & EmbindModule;
export default function MainModuleFactory (options?: unknown): Promise<MainModule>;
