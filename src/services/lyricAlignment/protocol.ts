import type { LyricData } from '../../types';
import type { AlignmentResult } from './alignment';

// Worker messages contain samples and text only; no account credentials or playback control crosses the boundary.
export type AlignmentLanguage = 'auto' | 'japanese' | 'chinese' | 'english' | 'korean';
export type AlignmentProgress = { phase: 'model' | 'audio' | 'recognizing' | 'aligning'; progress?: number };
export type AlignmentRequest = { samples: Float32Array; lyrics: LyricData | null; language: AlignmentLanguage };
export type AlignmentReply = { type: 'progress'; value: AlignmentProgress } | { type: 'result'; value: AlignmentResult } | { type: 'error'; message: string };
export const ALIGNMENT_MODEL = 'Xenova/whisper-base';
export const ALIGNMENT_REVISION = '64da57285918e20ea79ea5c88eed7197933abaa8';
