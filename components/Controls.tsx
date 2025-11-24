
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
  
  const [showEQ, setShowEQ] = useState(false);

  const formatSemitone = (val: number) => (val > 0 ? `+${val}` : val);
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const applyEqPreset = (name: string) => {
    switch(name) {
      case 'bass': onParamChange('eqLow', 8); onParamChange('eqMid', -4); onParamChange('eqHigh', -12); break;
      case 'voice': onParamChange('eqLow', -12); onParamChange('eqMid', 6); onParamChange('eqHigh', 2); break;
      case 'detail': onParamChange('eqLow', -6); onParamChange('eqMid', 0); onParamChange('eqHigh', 8); break;
      case 'flat': default: onParamChange('eqLow', 0); onParamChange('eqMid', 0); onParamChange('eqHigh', 0); break;
    }
  };

  return (
    <div className="flex flex-col md:flex-row items-center justify-between gap-4 px-4 max-w-7xl mx-auto h-20 md:h-14">
      
      {/* 1. Time Display & Scrubber */}
      <div className="flex-1 flex flex-col w-full md:w-auto min-w-[200px]">
          <div className="flex justify-between text-[10px] font-mono text-slate-400 px-1">
             <span>{formatTime(audioState.currentTime)}</span>
             <span>{formatTime(audioState.duration)}</span>
          </div>
          <div className="relative h-4 flex items-center">
            {/* Loop bar */}
            {loopState.start !== null && loopState.end !== null && (
               <div 
                 className="absolute top-0 h-1 bg-green-500/50 rounded z-0 pointer-events-none"
                 style={{
                   left: `${(loopState.start / audioState.duration) * 100}%`,
                   width: `${((loopState.end - loopState.start) / audioState.duration) * 100}%`
                 }}
               />
            )}
            <input
              type="range"
              min={0}
              max={audioState.duration || 100}
              value={audioState.currentTime}
              onChange={(e) => onSeek(parseFloat(e.target.value))}
              disabled={!audioState.isLoaded}
              className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500 z-10"
            />
          </div>
      </div>

      <div className="h-8 w-[1px] bg-slate-800 hidden md:block"></div>

      {/* 2. Transport Controls */}
      <div className="flex items-center gap-2">
         <button onClick={() => onJump(-5)} disabled={!audioState.isLoaded} className="p-2 text-slate-400 hover:text-white transition-colors" title="-5s">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 17l-5-5 5-5M18 17l-5-5 5-5"/></svg>
         </button>
         
         <button 
          onClick={onTogglePlay}
          disabled={!audioState.isLoaded}
          className={`w-10 h-10 rounded-full flex items-center justify-center text-xl transition-all ${
            audioState.isLoaded 
              ? audioState.isPlaying 
                ? 'bg-amber-500 text-slate-900 shadow-lg shadow-amber-500/30'
                : 'bg-cyan-500 text-slate-900 shadow-lg shadow-cyan-500/30' 
              : 'bg-slate-700 text-slate-500 cursor-not-allowed'
          }`}
        >
          {audioState.isPlaying ? '❚❚' : '▶'}
        </button>

        <button onClick={() => onJump(5)} disabled={!audioState.isLoaded} className="p-2 text-slate-400 hover:text-white transition-colors" title="+5s">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 17l5-5-5-5M6 17l5-5-5-5"/></svg>
         </button>
      </div>

      <div className="h-8 w-[1px] bg-slate-800 hidden md:block"></div>

      {/* 3. Speed & Pitch */}
      <div className="flex items-center gap-4">
          {/* Speed Presets + Slider */}
          <div className="flex flex-col items-center gap-1">
             <div className="flex gap-1">
                {[0.5, 0.75, 1.0].map(s => (
                    <button 
                        key={s}
                        onClick={() => onParamChange('speed', s)}
                        className={`text-[9px] px-1.5 py-0.5 rounded border ${params.speed === s ? 'bg-cyan-900 text-cyan-400 border-cyan-800' : 'bg-slate-800 text-slate-500 border-slate-700 hover:text-slate-300'}`}
                    >
                        {s * 100}%
                    </button>
                ))}
             </div>
             <input
                type="range" min={MIN_SPEED} max={MAX_SPEED} step={0.05}
                value={params.speed}
                onChange={(e) => onParamChange('speed', parseFloat(e.target.value))}
                className="w-24 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                title={`Velocidad: ${params.speed.toFixed(2)}x`}
             />
          </div>

          {/* Pitch */}
           <div className="flex flex-col items-center gap-1">
             <span className="text-[9px] font-mono text-slate-500">TONO: {formatSemitone(params.pitch)}</span>
             <input
                type="range" min={MIN_PITCH_SEMITONES} max={MAX_PITCH_SEMITONES} step={1}
                value={params.pitch}
                onChange={(e) => onParamChange('pitch', parseFloat(e.target.value))}
                className="w-20 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer"
             />
          </div>
      </div>

       <div className="h-8 w-[1px] bg-slate-800 hidden md:block"></div>

      {/* 4. Loop & FX Buttons */}
      <div className="flex items-center gap-2">
         <div className="flex flex-col gap-1">
            <div className="flex gap-1">
                <button onClick={() => onSetLoop('start')} className={`text-[9px] px-1.5 rounded border ${loopState.start !== null ? 'text-green-400 border-green-900 bg-green-900/10' : 'text-slate-500 border-slate-700'}`}>IN</button>
                <button onClick={() => onSetLoop('end')} className={`text-[9px] px-1.5 rounded border ${loopState.end !== null ? 'text-green-400 border-green-900 bg-green-900/10' : 'text-slate-500 border-slate-700'}`}>OUT</button>
            </div>
            <button 
                onClick={() => onSetLoop('toggle')}
                className={`text-[9px] px-2 rounded border w-full ${loopState.active ? 'bg-green-600 text-white border-green-600' : 'bg-slate-800 text-slate-500 border-slate-700'}`}
            >
                LOOP
            </button>
         </div>

         {/* Volume */}
          <div className="flex flex-col items-center ml-2">
             <input
                type="range" min={-60} max={0}
                value={params.volume}
                onChange={(e) => onParamChange('volume', parseFloat(e.target.value))}
                className="w-16 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                title="Volumen Maestro"
             />
             <span className="text-[8px] text-slate-600 mt-1">VOL</span>
          </div>
         
         {/* FX Toggle */}
         <div className="relative">
             <button 
                onClick={() => setShowEQ(!showEQ)}
                className={`ml-2 w-8 h-8 rounded border flex items-center justify-center font-bold text-xs transition-colors ${showEQ ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400'}`}
             >
                FX
             </button>

             {/* EQ POPOVER */}
             {showEQ && (
                 <div className="absolute bottom-full right-0 mb-3 bg-slate-900 border border-slate-700 p-4 rounded-lg shadow-2xl w-64 z-50">
                     <div className="flex justify-between items-center mb-4 border-b border-slate-800 pb-2">
                         <span className="text-xs font-bold text-slate-400">EQ & MEZCLA</span>
                         <div className="flex gap-1">
                             <button onClick={() => applyEqPreset('bass')} className="text-[9px] px-1 bg-slate-800 border border-slate-700 text-purple-400">BASS</button>
                             <button onClick={() => applyEqPreset('voice')} className="text-[9px] px-1 bg-slate-800 border border-slate-700 text-green-400">MID</button>
                             <button onClick={() => applyEqPreset('flat')} className="text-[9px] px-1 bg-slate-800 border border-slate-700 text-slate-400">FLAT</button>
                         </div>
                     </div>
                     <div className="flex justify-between gap-2 h-32">
                        {[
                            { label: 'LO', param: 'eqLow', val: params.eqLow },
                            { label: 'MID', param: 'eqMid', val: params.eqMid },
                            { label: 'HI', param: 'eqHigh', val: params.eqHigh }
                        ].map((b) => (
                            <div key={b.label} className="flex-1 flex flex-col items-center bg-slate-950/50 rounded py-2">
                                <input 
                                    type="range" min="-15" max="15" 
                                    value={b.val} 
                                    onChange={(e) => onParamChange(b.param as any, parseFloat(e.target.value))}
                                    className="h-full w-2 appearance-none bg-slate-700 rounded cursor-pointer"
                                    style={{ writingMode: 'vertical-lr', WebkitAppearance: 'slider-vertical' } as any}
                                />
                                <span className="text-[9px] text-slate-500 mt-2">{b.label}</span>
                            </div>
                        ))}
                     </div>
                     <div className="mt-4 pt-2 border-t border-slate-800">
                        <div className="flex justify-between text-[10px] text-indigo-400 mb-1">
                            <span>Metrónomo</span>
                            <span>{params.metronomeVolume.toFixed(0)} dB</span>
                        </div>
                        <input
                            type="range" min={-60} max={0}
                            value={params.metronomeVolume}
                            onChange={(e) => onParamChange('metronomeVolume', parseFloat(e.target.value))}
                            className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                        />
                     </div>
                 </div>
             )}
         </div>
      </div>
    </div>
  );
};
