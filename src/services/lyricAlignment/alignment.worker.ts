import { env, pipeline, Tensor, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import { wasm, mjs } from 'virtual:folia-whisper-runtime';
import { alignLyricsToWords, wordsToSubtitle, type TimedWord } from './alignment';
import { ALIGNMENT_MODEL, ALIGNMENT_REVISION, type AlignmentRequest, type AlignmentReply } from './protocol';
import { languageFromLogits } from './languageDetection';

// Speech inference and text alignment run in a disposable worker, never on the player rendering thread.
const bundledModel = Boolean(import.meta.env.FOLIA_ALIGNMENT_BUNDLED);
env.allowLocalModels = bundledModel;
env.allowRemoteModels = !bundledModel;
env.localModelPath = '/models/';
env.useBrowserCache = !bundledModel;
env.backends.onnx.wasm!.numThreads = 1;
env.backends.onnx.wasm!.wasmPaths = { wasm, mjs };
const send = (reply: AlignmentReply) => self.postMessage(reply);

// Transformers.js 3.8.1 defaults omitted language to English. Explicitly detect each window instead.
const detectLanguage = async (transcriber: AutomaticSpeechRecognitionPipeline, audio: Float32Array): Promise<string> => {
    const config = transcriber.model.generation_config as unknown as { decoder_start_token_id: number; lang_to_id: Record<string, number> };
    const features = await transcriber.processor(audio);
    const decoder = new Tensor('int64', BigInt64Array.from([BigInt(config.decoder_start_token_id)]), [1, 1]);
    let output: Record<string, Tensor> = {};
    try {
        output = await transcriber.model.forward({ input_features: features.input_features, decoder_input_ids: decoder });
        return languageFromLogits(output.logits.data as Float32Array, config.lang_to_id);
    } finally {
        const tensors = new Set([decoder, ...Object.values(features), ...Object.values(output)]);
        for (const tensor of tensors) if (tensor instanceof Tensor) tensor.dispose();
    }
};
self.onmessage = async (event: MessageEvent<AlignmentRequest>) => {
    try {
        const { samples, lyrics, language } = event.data;
        let lastProgress = 0;
        const transcriber = await pipeline('automatic-speech-recognition', ALIGNMENT_MODEL, {
            revision: ALIGNMENT_REVISION, dtype: 'q8', device: 'wasm',
            progress_callback: progress => {
                const now = Date.now();
                if (now - lastProgress < 500) return;
                lastProgress = now;
                send({ type: 'progress', value: { phase: 'model', progress: 'progress' in progress ? progress.progress : undefined } });
            },
        });
        const duration = samples.length / 16000;
        const words: TimedWord[] = [];
        // Thirty-second windows overlap by six seconds. Keep each window's centre to avoid duplicate words.
        for (let offset = 0; offset < duration; offset += 24) {
            const end = Math.min(duration, offset + 30), last = end >= duration;
            send({ type: 'progress', value: { phase: 'recognizing', progress: 100 * offset / duration } });
            const audio = samples.subarray(Math.round(offset * 16000), Math.round(end * 16000));
            let energy = 0;
            for (let i = 0; i < audio.length; i++) energy += audio[i] * audio[i];
            if (energy / audio.length > 0.000001) {
                const detectedLanguage = language === 'auto' ? await detectLanguage(transcriber, audio) : language;
                const result = await transcriber(audio, { return_timestamps: 'word', task: 'transcribe',
                    language: detectedLanguage, max_new_tokens: 448, num_beams: 1, do_sample: false });
                const output = Array.isArray(result) ? result[0] : result;
                for (const chunk of output.chunks ?? []) {
                    const [start, stop] = chunk.timestamp;
                    if (start === null || stop === null || !Number.isFinite(start) || !Number.isFinite(stop)) continue;
                    const midpoint = (start + stop) / 2;
                    if (midpoint < (offset ? 3 : 0) || !last && midpoint >= 27) continue;
                    words.push({ text: chunk.text, start: offset + start, end: Math.min(end, offset + stop) });
                }
            }
            if (last) break;
        }
        await transcriber.dispose();
        send({ type: 'progress', value: { phase: 'aligning' } });
        const result = lyrics?.lines.length ? alignLyricsToWords(lyrics, words, duration) : wordsToSubtitle(words, duration);
        send({ type: 'result', value: result });
    } catch (error) {
        send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
};
