
import * as Tone from 'tone';

export interface AudioState {
  url: string | null;
  fileName: string;
  isLoaded: boolean;
  isPlaying: boolean;
  duration: number;
  currentTime: number;
  buffer: Tone.ToneAudioBuffer | null;
}

export interface ProcessingParams {
  speed: number; // Playback rate (0.5 - 2.0)
  pitch: number; // Detune in semitones (-12 to +12)
  volume: number; // Decibels (-60 to 0)
  // EQ Bands (dB) -12 to +12
  eqLow: number; 
  eqMid: number; 
  eqHigh: number;
  metronomeVolume: number; // Decibels (-60 to 0 or +)
}

export interface LoopState {
  active: boolean;
  start: number | null;
  end: number | null;
}

export interface Measure {
  index: number; // 1-based index
  chords: string;
  lyrics: string;
  duration?: number; // Optional: specific duration in seconds. If undefined, calculated from Global BPM.
}

export interface GridConfig {
  bpm: number;
  tsTop: number;    // Global Time Signature Numerator
  tsBottom: number; // Global Time Signature Denominator
  offset: number;   // Start time of the first measure in seconds
}

export enum LoadingState {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  READY = 'READY',
  ERROR = 'ERROR'
}
