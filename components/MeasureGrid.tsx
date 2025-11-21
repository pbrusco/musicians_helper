
import React, { useState, useRef, useEffect } from 'react';
import { GridConfig, Measure, AudioState } from '../types';
import { WaveformTimeline } from './WaveformTimeline';

interface MeasureGridProps {
  measures: Measure[];
  gridConfig: GridConfig;
  audioState: AudioState;
  onConfigChange: (newConfig: GridConfig) => void;
  onMeasureUpdate: (index: number, field: keyof Measure, value: any) => void;
  onMeasureDurationChange: (index: number, newDuration: number) => void;
  onCommitChanges: () => void; // Signal to save history
  onSeek: (time: number) => void;
  onAddMeasures: () => void;
  onPlayRegion: (start: number, duration: number) => void;
  onToggleMetronome: () => void;
  isMetronomeOn: boolean;
  onDeleteMeasure: (index: number) => void;
  onInsertMeasure: (index: number, position: 'before' | 'after') => void;
  autoScroll: boolean;
  onToggleAutoScroll: () => void;
  onTranspose: (semitones: number) => void;
}

export const MeasureGrid: React.FC<MeasureGridProps> = ({
  measures,
  gridConfig,
  audioState,
  onConfigChange,
  onMeasureUpdate,
  onMeasureDurationChange,
  onCommitChanges,
  onSeek,
  onAddMeasures,
  onPlayRegion,
  onToggleMetronome,
  isMetronomeOn,
  onDeleteMeasure,
  onInsertMeasure,
  autoScroll,
  onToggleAutoScroll,
  onTranspose
}) => {
  // State for menu
  const [activeMenu, setActiveMenu] = useState<number | null>(null);
  const gridContainerRef = useRef<HTMLDivElement>(null);

  const getStandardDuration = () => {
      const beats = gridConfig.tsTop * (4 / gridConfig.tsBottom);
      return (beats * 60) / gridConfig.bpm;
  };

  // Pre-calculate all measure start times and durations
  const measureLayout: {index: number, start: number, duration: number}[] = [];
  let t = gridConfig.offset;
  
  measures.forEach(m => {
      const dur = m.duration !== undefined ? m.duration : getStandardDuration();
      measureLayout.push({ index: m.index, start: t, duration: dur });
      t += dur;
  });
  
  // Determine active measure
  let currentMeasureIndex = -1;
  for (const layout of measureLayout) {
      if (audioState.currentTime >= layout.start && audioState.currentTime < layout.start + layout.duration) {
          currentMeasureIndex = layout.index;
          break;
      }
  }

  // Scroll active measure into view logic
  useEffect(() => {
      if (autoScroll && currentMeasureIndex !== -1) {
          const activeElement = document.getElementById(`measure-${currentMeasureIndex}`);
          if (activeElement) {
              activeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
      }
  }, [currentMeasureIndex, autoScroll]);

  return (
    <div className="flex flex-col h-full bg-slate-950" onClick={() => setActiveMenu(null)}>
      
      {/* Timeline Overlay */}
      <WaveformTimeline 
        buffer={audioState.buffer}
        gridConfig={gridConfig}
        measures={measures}
        currentTime={audioState.currentTime}
        duration={audioState.duration}
        onConfigChange={onConfigChange}
        onMeasureDurationChange={onMeasureDurationChange}
        onCommitChanges={onCommitChanges}
        onSeek={onSeek}
        onPlayRegion={onPlayRegion}
        autoScroll={autoScroll}
      />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-4 p-4 bg-slate-900 border-b border-slate-800 sticky top-0 z-20 shadow-md">
        
        <div className="flex flex-col">
          <label className="text-[10px] text-slate-500 font-bold uppercase">BPM (Global)</label>
          <input 
            type="number" 
            value={gridConfig.bpm}
            onChange={(e) => onConfigChange({...gridConfig, bpm: parseFloat(e.target.value) || 120})}
            onBlur={onCommitChanges}
            className="w-16 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm font-mono text-cyan-400 focus:border-cyan-500 focus:outline-none"
          />
        </div>

        <div className="flex flex-col">
             <label className="text-[10px] text-slate-500 font-bold uppercase">Métrica (Global)</label>
             <div className="flex items-center bg-slate-800 border border-slate-700 rounded px-2 py-1 gap-1 w-20">
                 <input 
                    className="w-6 bg-transparent text-sm font-mono text-center text-white focus:outline-none"
                    value={gridConfig.tsTop}
                    onChange={(e) => onConfigChange({...gridConfig, tsTop: parseInt(e.target.value) || 4})}
                    onBlur={onCommitChanges}
                 />
                 <span className="text-slate-500">/</span>
                 <input 
                    className="w-6 bg-transparent text-sm font-mono text-center text-white focus:outline-none"
                    value={gridConfig.tsBottom}
                    onChange={(e) => onConfigChange({...gridConfig, tsBottom: parseInt(e.target.value) || 4})}
                    onBlur={onCommitChanges}
                 />
             </div>
        </div>

        <div className="flex flex-col">
          <label className="text-[10px] text-slate-500 font-bold uppercase">Inicio (Offset)</label>
           <div className="flex gap-2">
              <input 
                type="number" 
                step="0.05"
                value={gridConfig.offset}
                onChange={(e) => onConfigChange({...gridConfig, offset: parseFloat(e.target.value) || 0})}
                onBlur={onCommitChanges}
                className="w-20 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm font-mono text-slate-400 focus:border-cyan-500 focus:outline-none"
              />
           </div>
        </div>

        {/* Transpose Controls */}
        <div className="flex flex-col">
             <label className="text-[10px] text-slate-500 font-bold uppercase mb-0.5">Transponer</label>
             <div className="flex gap-1">
                <button 
                    onClick={(e) => { e.stopPropagation(); onTranspose(-1); }}
                    className="px-3 py-1 bg-slate-800 border border-slate-700 text-slate-300 rounded text-sm hover:bg-slate-700 hover:text-white transition-colors font-mono"
                    title="Bajar 1 semitono"
                >
                    -1
                </button>
                <button 
                    onClick={(e) => { e.stopPropagation(); onTranspose(1); }}
                    className="px-3 py-1 bg-slate-800 border border-slate-700 text-slate-300 rounded text-sm hover:bg-slate-700 hover:text-white transition-colors font-mono"
                    title="Subir 1 semitono"
                >
                    +1
                </button>
             </div>
        </div>

        <div className="flex flex-col">
            <label className="text-[10px] text-slate-500 font-bold uppercase mb-0.5">Ayudas</label>
            <div className="flex gap-2">
                <button 
                    onClick={(e) => { e.stopPropagation(); onToggleMetronome(); }}
                    className={`flex items-center gap-2 px-3 py-1 rounded text-sm border transition-colors ${
                        isMetronomeOn 
                        ? 'bg-indigo-600 border-indigo-500 text-white shadow-[0_0_10px_rgba(79,70,229,0.5)]' 
                        : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-300'
                    }`}
                >
                    <span className="text-xs">●</span> Metrónomo
                </button>
                <button 
                    onClick={(e) => { e.stopPropagation(); onToggleAutoScroll(); }}
                    className={`flex items-center gap-2 px-3 py-1 rounded text-sm border transition-colors ${
                        autoScroll 
                        ? 'bg-emerald-600 border-emerald-500 text-white shadow-[0_0_10px_rgba(16,185,129,0.5)]' 
                        : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-300'
                    }`}
                >
                   <span className="text-xs">↓</span> Scroll
                </button>
            </div>
        </div>
      </div>

      {/* Grid Area */}
      <div className="flex-1 overflow-y-auto p-4 pb-20" ref={gridContainerRef}>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {measures.map((measure, i) => {
             const isActive = currentMeasureIndex === measure.index;
             const layout = measureLayout.find(l => l.index === measure.index);
             
             return (
               <div 
                  key={`${measure.index}-${i}`}
                  id={`measure-${measure.index}`}
                  className={`relative rounded-lg border-2 transition-all group/card ${
                    isActive 
                      ? 'border-cyan-500 bg-slate-800/80 shadow-[0_0_15px_rgba(6,182,212,0.15)]' 
                      : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
                  }`}
               >
                  {/* Header: Number, Menu */}
                  <div 
                    className="flex justify-between items-center px-2 py-1 bg-slate-900/50 border-b border-slate-800/50"
                  >
                    <div className="flex items-center gap-2">
                        <span 
                            className={`font-mono text-xs font-bold cursor-pointer hover:text-cyan-400 ${isActive ? 'text-cyan-400' : 'text-slate-500'}`}
                            onClick={() => {
                                if (layout) onPlayRegion(layout.start, layout.duration);
                            }}
                            title="Reproducir compás"
                        >
                        {measure.index}
                        </span>
                        {/* Rubato Indicator */}
                        {measure.duration !== undefined && (
                            <span className="text-[9px] text-amber-500 bg-amber-900/20 px-1 rounded" title="Duración manual (Rubato)">R</span>
                        )}
                    </div>
                    
                    {/* Action Menu */}
                    <div className="relative">
                        <button 
                            className="text-slate-600 hover:text-slate-300 px-1"
                            onClick={(e) => {
                                e.stopPropagation();
                                setActiveMenu(activeMenu === measure.index ? null : measure.index);
                            }}
                        >
                            ⋮
                        </button>
                        {activeMenu === measure.index && (
                            <div className="absolute right-0 top-full mt-1 w-32 bg-slate-800 border border-slate-700 rounded shadow-xl z-50 flex flex-col text-xs">
                                <button 
                                    className="px-3 py-2 text-left hover:bg-slate-700 text-slate-300"
                                    onClick={(e) => { e.stopPropagation(); onInsertMeasure(measure.index, 'before'); setActiveMenu(null); }}
                                >
                                    Insertar Antes
                                </button>
                                <button 
                                    className="px-3 py-2 text-left hover:bg-slate-700 text-slate-300"
                                    onClick={(e) => { e.stopPropagation(); onInsertMeasure(measure.index, 'after'); setActiveMenu(null); }}
                                >
                                    Insertar Después
                                </button>
                                {measure.duration !== undefined && (
                                     <button 
                                        className="px-3 py-2 text-left hover:bg-slate-700 text-amber-400 border-t border-slate-700"
                                        onClick={(e) => { e.stopPropagation(); onMeasureDurationChange(measure.index, 0); onCommitChanges(); setActiveMenu(null); }} 
                                    >
                                        Resetear Duración
                                    </button>
                                )}
                                <button 
                                    className="px-3 py-2 text-left hover:bg-red-900/20 text-red-400 border-t border-slate-700"
                                    onClick={(e) => { e.stopPropagation(); onDeleteMeasure(measure.index); setActiveMenu(null); }}
                                >
                                    Eliminar
                                </button>
                            </div>
                        )}
                    </div>
                  </div>

                  {/* Chords Input */}
                  <input
                    type="text"
                    value={measure.chords}
                    onChange={(e) => onMeasureUpdate(measure.index, 'chords', e.target.value)}
                    onBlur={onCommitChanges}
                    className="w-full bg-transparent px-3 py-2 font-bold text-indigo-400 placeholder-indigo-900/50 focus:outline-none text-center"
                    placeholder="Acorde"
                  />

                  {/* Lyrics Input */}
                  <textarea
                    value={measure.lyrics}
                    onChange={(e) => onMeasureUpdate(measure.index, 'lyrics', e.target.value)}
                    onBlur={onCommitChanges}
                    rows={2}
                    className="w-full bg-transparent px-3 py-2 text-sm text-slate-300 placeholder-slate-700 focus:outline-none resize-none text-center leading-snug"
                    placeholder="letra..."
                  />
               </div>
             );
          })}
          
          {/* Add Button */}
          <button 
            onClick={onAddMeasures}
            className="flex flex-col items-center justify-center min-h-[120px] rounded-lg border-2 border-dashed border-slate-800 text-slate-600 hover:text-slate-400 hover:border-slate-600 transition-all"
          >
            <span className="text-2xl font-bold">+</span>
            <span className="text-xs mt-2">Añadir 4 Compases</span>
          </button>
        </div>
      </div>
    </div>
  );
};
