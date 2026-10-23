// Build-time runtime URLs are emitted by whisperRuntimePlugin for both the application and its worker.
declare module 'virtual:folia-whisper-runtime' {
    export const wasm: string;
    export const mjs: string;
}
