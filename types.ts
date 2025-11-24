

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

export interface RegionSelection {
  active: boolean;
  start: number;
  end: number;
}

export interface Measure {
  index: number; // 1-based index
  chords: string;
  lyrics: string;
  duration?: number; // Optional: specific duration in seconds. If undefined, calculated from Global BPM.
}

export interface Marker {
  id: string;
  time: number;
  label: string;
  color?: string;
}

export type BeatUnit = 'quarter' | 'eighth' | 'dotted-quarter';

export interface GridConfig {
  bpm: number;
  tsTop: number;    // Global Time Signature Numerator
  tsBottom: number; // Global Time Signature Denominator
  keySignature: string; // e.g. "C", "Am", "F#"
  offset: number;   // Start time of the first measure in seconds
  beatUnit: BeatUnit; // The unit that the BPM refers to
}

export interface ProjectMeta {
  id: string;
  name: string;
  lastOpened: number;
}

export enum LoadingState {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  READY = 'READY',
  ERROR = 'ERROR'
}