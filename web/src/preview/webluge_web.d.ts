// The firmware's browser build (src/web.cpp), made by Emscripten.
declare module "@firmware/webluge_web.mjs" {
  export type Webluge = {
    FS: {
      mkdirTree(path: string): void;
      writeFile(path: string, data: Uint8Array): void;
      unlink(path: string): void;
      rmdir(path: string): void;
    };
    HEAPF32: Float32Array;
    ccall(name: string, returnType: "number", argTypes: "string"[], args: string[]): number;
    _webluge_web_play(): void;
    _webluge_web_render(numFrames: number): number;
    _webluge_web_rendered_frames(): number;
  };
  export default function createWebluge(options?: {
    print?: (text: string) => void;
    printErr?: (text: string) => void;
  }): Promise<Webluge>;
}
