import React, { useEffect, useRef, useState } from 'react';

interface GuitarTunerProps {
  onClose: () => void;
}

const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export const GuitarTuner: React.FC<GuitarTunerProps> = ({ onClose }) => {
  const [note, setNote] = useState<string>("-");
  const [cents, setCents] = useState<number>(0);
  const [frequency, setFrequency] = useState<number>(0);
  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const rafIdRef = useRef<number | null>(null);

  // --- Pitch Detection Logic (Auto-correlation) ---
  const autoCorrelate = (buffer: Float32Array, sampleRate: number): number => {
    const SIZE = buffer.length;
    let sumOfSquares = 0;
    for (let i = 0; i < SIZE; i++) {
      const val = buffer[i];
      sumOfSquares += val * val;
    }
    
    const rootMeanSquare = Math.sqrt(sumOfSquares / SIZE);
    if (rootMeanSquare < 0.01) return -1; // Not enough signal

    let r1 = 0, r2 = SIZE - 1, thres = 0.2;
    for (let i = 0; i < SIZE / 2; i++) {
      if (Math.abs(buffer[i]) < thres) { r1 = i; break; }
    }
    for (let i = 1; i < SIZE / 2; i++) {
      if (Math.abs(buffer[SIZE - i]) < thres) { r2 = SIZE - i; break; }
    }

    const updatedBuffer = buffer.slice(r1, r2);
    const c = new Array(updatedBuffer.length).fill(0);
    
    for (let i = 0; i < updatedBuffer.length; i++) {
      for (let j = 0; j < updatedBuffer.length - i; j++) {
        c[i] = c[i] + updatedBuffer[j] * updatedBuffer[j + i];
      }
    }

    let d = 0;
    while (c[d] > c[d + 1]) d++;
    let maxval = -1, maxpos = -1;
    for (let i = d; i < updatedBuffer.length; i++) {
      if (c[i] > maxval) {
        maxval = c[i];
        maxpos = i;
      }
    }
    
    let T0 = maxpos;
    const x1 = c[T0 - 1], x2 = c[T0], x3 = c[T0 + 1];
    const a = (x1 + x3 - 2 * x2) / 2;
    const b = (x3 - x1) / 2;
    if (a) T0 = T0 - b / (2 * a);

    return sampleRate / T0;
  };

  const getNote = (freq: number) => {
    const noteNum = 12 * (Math.log(freq / 440) / Math.log(2));
    const midi = Math.round(noteNum) + 69;
    const note = NOTES[midi % 12];
    return note;
  };

  const getCents = (freq: number, noteFreq: number) => {
    return Math.floor(1200 * Math.log2(freq / noteFreq));
  };

  const getStandardFrequency = (freq: number) => {
    const noteNum = 12 * (Math.log(freq / 440) / Math.log(2));
    const midi = Math.round(noteNum) + 69;
    return 440 * Math.pow(2, (midi - 69) / 12);
  };

  const updatePitch = () => {
    if (!analyserRef.current || !audioContextRef.current) return;
    
    const bufferLength = 2048;
    const buffer = new Float32Array(bufferLength);
    analyserRef.current.getFloatTimeDomainData(buffer);

    const ac = autoCorrelate(buffer, audioContextRef.current.sampleRate);

    if (ac !== -1) {
      const detectedNote = getNote(ac);
      const standardFreq = getStandardFrequency(ac);
      const detectedCents = getCents(ac, standardFreq);
      
      setFrequency(Math.round(ac));
      setNote(detectedNote);
      setCents(detectedCents);
    }

    rafIdRef.current = requestAnimationFrame(updatePitch);
  };

  const startTuner = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 2048;
      
      sourceRef.current = audioContextRef.current.createMediaStreamSource(stream);
      sourceRef.current.connect(analyserRef.current);
      
      setIsActive(true);
      setError(null);
      updatePitch();
    } catch (err) {
      console.error(err);
      setError("No se pudo acceder al micrófono.");
    }
  };

  const stopTuner = () => {
    if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    if (sourceRef.current) sourceRef.current.disconnect();
    if (audioContextRef.current) audioContextRef.current.close();
    setIsActive(false);
  };

  useEffect(() => {
    startTuner();
    return () => stopTuner();
  }, []);

  // Calculate needle rotation (-45deg to 45deg for -50 to 50 cents)
  const rotation = Math.max(-45, Math.min(45, cents));
  const isInTune = Math.abs(cents) < 5;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm">
      <div className="relative bg-slate-900 w-full max-w-md p-8 rounded-2xl border border-slate-700 shadow-2xl flex flex-col items-center">
        
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-500 hover:text-slate-300"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>

        <h2 className="text-2xl font-bold text-slate-200 mb-6 tracking-wider">AFINADOR</h2>

        {error ? (
          <div className="text-red-400 bg-red-900/20 px-4 py-2 rounded mb-4 text-center">{error}</div>
        ) : (
          <>
            {/* Display Gauge */}
            <div className="relative w-64 h-32 overflow-hidden mb-8">
               {/* Arc Background */}
               <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-56 h-56 rounded-full border-[12px] border-slate-700 box-border" style={{ clipPath: 'polygon(0 0, 100% 0, 100% 50%, 0 50%)' }}></div>
               
               {/* Center Marker */}
               <div className="absolute bottom-[10px] left-1/2 -translate-x-1/2 w-1 h-4 bg-emerald-500 rounded z-10"></div>
               
               {/* Needle */}
               <div 
                 className={`absolute bottom-0 left-1/2 w-1 h-28 origin-bottom rounded transition-transform duration-200 ease-out ${isInTune ? 'bg-emerald-400 shadow-[0_0_15px_#34d399]' : 'bg-red-400'}`}
                 style={{ transform: `translateX(-50%) rotate(${rotation}deg)` }}
               ></div>
            </div>

            {/* Note Name */}
            <div className="flex flex-col items-center mb-4">
              <div className={`text-8xl font-bold font-mono ${isInTune ? 'text-emerald-400 drop-shadow-[0_0_10px_rgba(52,211,153,0.5)]' : 'text-slate-200'}`}>
                {note}
              </div>
              <div className="text-slate-500 font-mono mt-2 text-lg">
                {frequency} Hz
              </div>
            </div>

            {/* Cents Text */}
            <div className={`text-xl font-bold ${isInTune ? 'text-emerald-400' : cents > 0 ? 'text-amber-400' : 'text-blue-400'}`}>
               {cents === 0 ? 'PERFECTO' : cents > 0 ? `+${cents} cents` : `${cents} cents`}
            </div>

            {/* Instructions */}
            <div className="mt-8 text-xs text-slate-600 text-center max-w-xs">
              Asegúrate de que el micrófono esté permitido y cerca del instrumento. Toca una cuerda a la vez.
            </div>
          </>
        )}
      </div>
    </div>
  );
};
