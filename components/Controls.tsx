
import React, { useState } from 'react';
import { MAX_PITCH_SEMITONES, MIN_PITCH_SEMITONES, MAX_SPEED, MIN_SPEED } from '../constants';
import { AudioState, ProcessingParams, LoopState } from '../types';

interface ControlsProps {
  params: ProcessingParams;
  audioState: AudioState;
  loopState: LoopState;
  onParamChange: (key: keyof ProcessingParams, value: number) => void;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onJump: (delta: number) => void;
  onSetLoop: (type: 'start' | 'end' | 'clear' | 'toggle') => void;
}

export const Controls: React.FC<ControlsProps> = ({ 
  params, 
  audioState, 
  loopState,
  onParamChange, 
  onTogglePlay,
  onSeek,
  onJump,
  onSetLoop
}) => {
  
  const [showEQ, setShowEQ] = useState(true);
  const [showLoop, setShowLoop] = useState(true);
  const [showSpeed, setShowSpeed] = useState(true);

  const formatSemitone = (val: number) => (val > 0 ? `+${val}` : val);
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Preset configurations for the EQ
  const applyEqPreset = (name: string) => {
    switch(name) {
      case 'bass': // Boost Lows, cut others
        onParamChange('eqLow', 8);
        onParamChange('eqMid', -4);
        onParamChange('eqHigh', -12);
        break;
      case 'voice': // Boost Mids (Voice/Guitar), cut rumble
        onParamChange('eqLow', -12);
        onParamChange('eqMid', 6);
        onParamChange('eqHigh', 2);
        break;
      case 'detail': // High boost for percussion/breath
        onParamChange('eqLow', -6);
        onParamChange('eqMid', 0);
        onParamChange('eqHigh', 8);
        break;
      case 'flat': // Reset
      default:
        onParamChange('eqLow', 0);
        onParamChange('eqMid', 0);
        onParamChange('eqHigh', 0);
        break;
    }
  };

  const SectionHeader = ({ title, isOpen, onToggle }: { title: string, isOpen: boolean, onToggle: () => void }) => (
      <div 
        onClick={onToggle}
        className="flex justify-between items-center text-xs text-slate-400 uppercase font-semibold tracking-wider mb-2 cursor-pointer hover:text-slate-300 transition-colors select-none border-b border-slate-800/50 pb-1"
      >
        <span>{title}</span>
        <span className="text-slate-500">{isOpen ? '−' : '+'}</span>
      </div>
  );

  return (
    <div className="space-y-6 p-6 bg-slate-800 rounded-xl border border-slate-700 shadow-lg select-none">
      
      {/* Timeline / Scrubber */}
      <div className="space-y-2">
        <div className="flex justify-between text-xs font-mono text-slate-400">
          <span>{formatTime(audioState.currentTime)}</span>
          <span>{formatTime(audioState.duration)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={audioState.duration || 100}
          value={audioState.currentTime}
          onChange={(e) => onSeek(parseFloat(e.target.value))}
          disabled={!audioState.isLoaded}
          className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500 hover:accent-cyan-400"
        />
        {/* Loop Indicators on Timeline (Visual only roughly) */}
        {loopState.start !== null && loopState.end !== null && (
           <div className="relative h-1 w-full mt-1">
             <div 
               className="absolute h-full bg-green-500/50 rounded"
               style={{
                 left: `${(loopState.start / audioState.duration) * 100}%`,
                 width: `${((loopState.end - loopState.start) / audioState.duration) * 100}%`
               }}
             />
           </div>
        )}
      </div>

      {/* Main Transport Controls */}
      <div className="flex flex-wrap justify-center gap-4 items-center border-b border-slate-700 pb-6">
        
        {/* Jump Back */}
        <button onClick={() => onJump(-5)} disabled={!audioState.isLoaded} className="p-3 rounded-full bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors" title="Retroceder 5s (F1)">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 17l-5-5 5-5M18 17l-5-5 5-5"/></svg>
        </button>

        {/* Play/Pause */}
         <button 
          onClick={onTogglePlay}
          disabled={!audioState.isLoaded}
          className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl transition-all ${
            audioState.isLoaded 
              ? audioState.isPlaying 
                ? 'bg-amber-500 hover:bg-amber-400 text-slate-900 shadow-[0_0_20px_rgba(245,158,11,0.4)]'
                : 'bg-cyan-500 hover:bg-cyan-400 text-slate-900 shadow-[0_0_20px_rgba(6,182,212,0.4)]' 
              : 'bg-slate-700 text-slate-500 cursor-not-allowed'
          }`}
          title="Play/Pause (ESC)"
        >
          {audioState.isPlaying ? '❚❚' : '▶'}
        </button>
        
        {/* Jump Forward */}
        <button onClick={() => onJump(5)} disabled={!audioState.isLoaded} className="p-3 rounded-full bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors" title="Adelantar 5s (F2)">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 17l5-5-5-5M6 17l5-5-5-5"/></svg>
        </button>
      </div>

      {/* EQ & Mix Section */}
      <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-700/50">
        <SectionHeader title="Ecualizador y Mezcla" isOpen={showEQ} onToggle={() => setShowEQ(!showEQ)} />
        
        {showEQ && (
          <>
            <div className="flex justify-end gap-1 mb-4">
               <button onClick={() => applyEqPreset('bass')} className="px-2 py-1 text-[10px] bg-slate-800 border border-slate-700 hover:bg-slate-700 rounded text-purple-400" title="Aislar Bajo">BAJO</button>
               <button onClick={() => applyEqPreset('voice')} className="px-2 py-1 text-[10px] bg-slate-800 border border-slate-700 hover:bg-slate-700 rounded text-green-400" title="Voz y Guitarra">MEDIOS</button>
               <button onClick={() => applyEqPreset('detail')} className="px-2 py-1 text-[10px] bg-slate-800 border border-slate-700 hover:bg-slate-700 rounded text-cyan-400" title="Detalles / Aire">ALTO</button>
               <button onClick={() => applyEqPreset('flat')} className="px-2 py-1 text-[10px] bg-slate-800 border border-slate-700 hover:bg-slate-700 rounded text-slate-400">PLANO</button>
            </div>

            <div className="flex justify-between items-center gap-2">
              {/* LOW */}
              <div className="flex-1 flex flex-col items-center gap-2">
                <input 
                  type="range" min="-15" max="15" step="1" 
                  value={params.eqLow} onChange={(e) => onParamChange('eqLow', parseFloat(e.target.value))}
                  className="h-24 w-2 bg-slate-700 rounded-lg appearance-none cursor-pointer writing-mode-vertical"
                  style={{ writingMode: 'vertical-lr', WebkitAppearance: 'slider-vertical' } as any} 
                />
                <span className="text-[10px] text-slate-500 font-mono">LOW</span>
              </div>
              {/* MID */}
              <div className="flex-1 flex flex-col items-center gap-2">
                <input 
                  type="range" min="-15" max="15" step="1" 
                  value={params.eqMid} onChange={(e) => onParamChange('eqMid', parseFloat(e.target.value))}
                  className="h-24 w-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                  style={{ writingMode: 'vertical-lr', WebkitAppearance: 'slider-vertical' } as any}
                />
                <span className="text-[10px] text-slate-500 font-mono">MID</span>
              </div>
              {/* HIGH */}
              <div className="flex-1 flex flex-col items-center gap-2">
                <input 
                  type="range" min="-15" max="15" step="1" 
                  value={params.eqHigh} onChange={(e) => onParamChange('eqHigh', parseFloat(e.target.value))}
                  className="h-24 w-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                  style={{ writingMode: 'vertical-lr', WebkitAppearance: 'slider-vertical' } as any}
                />
                <span className="text-[10px] text-slate-500 font-mono">HI</span>
              </div>
            </div>

             {/* Metronome Volume in EQ Section */}
             <div className="mt-4 pt-4 border-t border-slate-800">
                 <div className="flex justify-between mb-1">
                  <label className="text-indigo-400 text-xs font-bold">VOL. METRÓNOMO</label>
                  <span className="font-mono text-xs text-slate-500">{params.metronomeVolume.toFixed(0)} dB</span>
                </div>
                <input
                  type="range"
                  min={-60}
                  max={0}
                  step={1}
                  value={params.metronomeVolume}
                  onChange={(e) => onParamChange('metronomeVolume', parseFloat(e.target.value))}
                  className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                />
            </div>
          </>
        )}
      </div>

      {/* Loop Controls */}
      <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-700/50 flex flex-col gap-2">
          <SectionHeader title="Bucle (Loop)" isOpen={showLoop} onToggle={() => setShowLoop(!showLoop)} />
          
          {showLoop && (
            <>
              <div className="flex gap-2">
                <button 
                  onClick={() => onSetLoop('start')} 
                  className={`flex-1 py-1 text-xs rounded border ${loopState.start !== null ? 'border-green-500 text-green-400 bg-green-900/20' : 'border-slate-600 text-slate-400 hover:bg-slate-700'}`}
                >
                  SET A
                </button>
                <button 
                  onClick={() => onSetLoop('end')} 
                  className={`flex-1 py-1 text-xs rounded border ${loopState.end !== null ? 'border-green-500 text-green-400 bg-green-900/20' : 'border-slate-600 text-slate-400 hover:bg-slate-700'}`}
                >
                  SET B
                </button>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => onSetLoop('toggle')}
                  className={`flex-1 py-1 text-xs rounded border ${loopState.active ? 'bg-green-600 border-green-600 text-white' : 'border-slate-600 text-slate-400 hover:bg-slate-700'}`}
                >
                  {loopState.active ? 'LOOP ON' : 'LOOP OFF'}
                </button>
                <button onClick={() => onSetLoop('clear')} className="px-3 py-1 text-xs rounded border border-red-900/50 text-red-400 hover:bg-red-900/20">
                  ⨯
                </button>
              </div>
            </>
          )}
      </div>

      {/* Speed & Pitch */}
      <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-700/50">
        <SectionHeader title="Velocidad y Tono" isOpen={showSpeed} onToggle={() => setShowSpeed(!showSpeed)} />

        {showSpeed && (
          <div className="grid grid-cols-2 gap-4 pt-2">
            {/* Speed */}
            <div>
              <div className="flex justify-between mb-1">
                <label className="text-cyan-400 text-xs font-bold">VELOCIDAD</label>
                <span className="font-mono text-xs text-white">{params.speed.toFixed(2)}x</span>
              </div>
              <input
                type="range"
                min={MIN_SPEED}
                max={MAX_SPEED}
                step={0.05}
                value={params.speed}
                onChange={(e) => onParamChange('speed', parseFloat(e.target.value))}
                className="w-full h-1 bg-slate-600 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            {/* Pitch */}
            <div>
              <div className="flex justify-between mb-1">
                <label className="text-purple-400 text-xs font-bold">TONO</label>
                <span className="font-mono text-xs text-white">{formatSemitone(params.pitch)} st</span>
              </div>
              <input
                type="range"
                min={MIN_PITCH_SEMITONES}
                max={MAX_PITCH_SEMITONES}
                step={1}
                value={params.pitch}
                onChange={(e) => onParamChange('pitch', parseFloat(e.target.value))}
                className="w-full h-1 bg-slate-600 rounded-lg appearance-none cursor-pointer"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
