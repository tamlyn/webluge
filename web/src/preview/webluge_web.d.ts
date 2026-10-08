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
    HEAP32: Int32Array;
    HEAPU8: Uint8Array;
    ccall(name: string, returnType: "number", argTypes: "string"[], args: string[]): number;
    _webluge_web_play(): void;
    _webluge_web_audition(y: number, on: boolean): void;
    _webluge_web_describe(): number;
    _webluge_web_description_length(): number;
    _webluge_web_toggle_clip(index: number, instant: boolean): void;
    _webluge_web_solo_clip(index: number): void;
    _webluge_web_switch_to_session(): void;
    _webluge_web_switch_to_arrangement(): void;
    _webluge_web_states(): number;
    _webluge_web_frames_per_tick(): number;
    _webluge_web_render(numFrames: number): number;
    _webluge_web_rendered_frames(): number;
  };
  export default function createWebluge(options?: {
    print?: (text: string) => void;
    printErr?: (text: string) => void;
  }): Promise<Webluge>;
}
