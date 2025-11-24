
import React, { useState, useRef, useEffect } from 'react';
import { GridConfig, Measure, AudioState, BeatUnit } from '../types';

interface MeasureGridProps {
  measures: Measure[];
  selectedMeasureIndices: number[];
  gridConfig: GridConfig;
  audioState: AudioState;
  onConfigChange: (newConfig: GridConfig) => void;
  onMeasureUpdate: (index: number, field: keyof Measure, value: any) => void;
  onMeasureDurationChange: (index: number, newDuration: number) => void;
  onMeasureSelect: (index: number, isShift: boolean, isCtrl: boolean) => void;
  onCommitChanges: () => void; // Signal to save history
  onSeek: (time: number) => void;
  onAddMeasures: () => void;
  onPlayRegion: (start: number, duration: number) => void;
  onDeleteMeasure: (index: number) => void;
  onInsertMeasure: (index: number, position: 'before' | 'after') => void;
  onDuplicateSelection: () => void;
  autoScroll: boolean;
  onToggleAutoScroll: () => void;
  onTranspose: (semitones: number) => void;
}

export const MeasureGrid: React.FC<MeasureGridProps> = ({
  measures,
  selectedMeasureIndices,
  gridConfig,
  audioState,
  onConfigChange,
  onMeasureUpdate,
  onMeasureDurationChange,
  onMeasureSelect,
  onCommitChanges,
  onSeek,
  onAddMeasures,
  onPlayRegion,
  onDeleteMeasure,
  onInsertMeasure,
  onDuplicateSelection,
  autoScroll,
  onToggleAutoScroll,
  onTranspose
}) => {
  // State for menu
  const [activeMenu, setActiveMenu] = useState<number | null>(null);
  const gridContainerRef = useRef<HTMLDivElement>(null);

  const getStandardDuration = () => {
      // Calculate effective BPM relative to quarter notes
      let effectiveBpm = gridConfig.bpm;
      if (gridConfig.beatUnit === 'eighth') effectiveBpm = effectiveBpm / 2;
      if (gridConfig.beatUnit === 'dotted-quarter') effectiveBpm = effectiveBpm * 1.5;

      const beats = gridConfig.tsTop * (4 / gridConfig.tsBottom);
      return (beats * 60) / effectiveBpm;
  };

  // Pre-calculate all measure start times and durations
  const measureLayout: {index: number, start: number, duration: number}[] = [];
  let t = gridConfig.offset;
  
  measures.forEach(m => {
      const dur = m.duration !== undefined ? m.duration : getStandardDuration();
      measureLayout.push({ index: m.index, start: t, duration: dur });
      t += dur;
  });
  
  // Determine playing measure
  let playingMeasureIndex = -1;
  for (const layout of measureLayout) {
      if (audioState.currentTime >= layout.start && audioState.currentTime < layout.start + layout.duration) {
          playingMeasureIndex = layout.index;
          break;
      }
  }

  // Scroll active measure into view logic
  useEffect(() => {
      if (autoScroll && playingMeasureIndex !== -1 && gridContainerRef.current) {
          const activeElement = document.getElementById(`measure-${playingMeasureIndex}`);
          if (activeElement) {
              activeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
      }
  }, [playingMeasureIndex, autoScroll]);

  // Helper to toggle beat unit
  const toggleBeatUnit = (e: React.MouseEvent) => {
      e.stopPropagation();
      const units: BeatUnit[] = ['quarter', 'eighth', 'dotted-quarter'];
      const currentIndex = units.indexOf(gridConfig.beatUnit || 'quarter');
      const nextIndex = (currentIndex + 1) % units.length;
      onConfigChange({ ...gridConfig, beatUnit: units[nextIndex] });
      onCommitChanges();
  };

  const getBeatUnitIcon = () => {
      switch(gridConfig.beatUnit) {
          case 'eighth': return '♪';
          case 'dotted-quarter': return '♩.';
          case 'quarter': default: return '♩';
      }
  };

  return (
    <div className="flex flex-col h-full bg-slate-950" onClick={() => setActiveMenu(null)}>
      
      {/* Toolbar - Simplified */}
      <div className="flex flex-wrap items-center gap-4 px-4 py-2 bg-slate-900 border-b border-slate-800 sticky top-0 z-20 shadow-md h-14 shrink-0">
        
        <div className="flex flex-col">
          <label className="text-[9px] text-slate-500 font-bold uppercase">Tempo</label>
          <div className="flex items-center gap-1">
              <button 
                onClick={toggleBeatUnit}
                className="w-8 h-6 flex items-center justify-center bg-slate-800 border border-slate-700 rounded text-sm hover:bg-slate-700 text-cyan-400 font-bold"
                title="Cambiar figura de pulso"
              >
                  {getBeatUnitIcon()}
              </button>
              <span className="text-slate-500 text-xs font-bold">=</span>
              <input 
                type="number" 
                value={gridConfig.bpm}
                onChange={(e) => onConfigChange({...gridConfig, bpm: parseFloat(e.target.value) || 120})}
                onBlur={onCommitChanges}
                className="w-14 bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-xs font-mono text-cyan-400 focus:border-cyan-500 focus:outline-none"
              />
          </div>
        </div>

        <div className="flex flex-col">
             <label className="text-[9px] text-slate-500 font-bold uppercase">Métrica</label>
             <div className="flex items-center bg-slate-800 border border-slate-700 rounded px-2 py-0.5 gap-1 w-16">
                 <input 
                    className="w-5 bg-transparent text-xs font-mono text-center text-white focus:outline-none"
                    value={gridConfig.tsTop}
                    onChange={(e) => onConfigChange({...gridConfig, tsTop: parseInt(e.target.value) || 4})}
                    onBlur={onCommitChanges}
                 />
                 <span className="text-slate-500 text-xs">/</span>
                 <input 
                    className="w-5 bg-transparent text-xs font-mono text-center text-white focus:outline-none"
                    value={gridConfig.tsBottom}
                    onChange={(e) => onConfigChange({...gridConfig, tsBottom: parseInt(e.target.value) || 4})}
                    onBlur={onCommitChanges}
                 />
             </div>
        </div>

        <div className="flex flex-col">
          <label className="text-[9px] text-slate-500 font-bold uppercase">Tonalidad</label>
          <input 
            type="text" 
            value={gridConfig.keySignature}
            onChange={(e) => onConfigChange({...gridConfig, keySignature: e.target.value})}
            onBlur={onCommitChanges}
            className="w-16 bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-xs font-mono text-yellow-400 focus:border-yellow-500 focus:outline-none text-center"
            placeholder="Key"
          />
        </div>

        <div className="h-8 w-[1px] bg-slate-800 mx-2"></div>

        {/* Transpose Controls */}
        <div className="flex flex-col">
             <label className="text-[9px] text-slate-500 font-bold uppercase mb-0.5">Transponer</label>
             <div className="flex gap-1">
                <button onClick={(e) => { e.stopPropagation(); onTranspose(-1); }} className="px-2 py-0.5 bg-slate-800 border border-slate-700 text-slate-300 rounded text-xs hover:bg-slate-700 font-mono">-1</button>
                <button onClick={(e) => { e.stopPropagation(); onTranspose(1); }} className="px-2 py-0.5 bg-slate-800 border border-slate-700 text-slate-300 rounded text-xs hover:bg-slate-700 font-mono">+1</button>
             </div>
        </div>

        <div className="flex-1"></div>

        <div className="flex gap-2">
            <button 
                onClick={(e) => { e.stopPropagation(); onToggleAutoScroll(); }}
                className={`flex items-center gap-2 px-3 py-1 rounded text-xs border transition-colors ${
                    autoScroll 
                    ? 'bg-emerald-600 border-emerald-500 text-white' 
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-300'
                }`}
            >
               ↓ Scroll
            </button>
        </div>
      </div>

      {/* Grid Area - Full width cards */}
      <div className="flex-1 overflow-y-auto p-4 pb-20 bg-slate-950" ref={gridContainerRef}>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
          {measures.map((measure, i) => {
             const isPlaying = playingMeasureIndex === measure.index;
             const isSelected = selectedMeasureIndices.includes(measure.index);
             const layout = measureLayout.find(l => l.index === measure.index);
             
             return (
               <div 
                  key={`${measure.index}-${i}`}
                  id={`measure-${measure.index}`}
                  className={`relative rounded border transition-all group/card ${
                    isPlaying 
                      ? 'border-cyan-500 bg-slate-800 shadow-[0_0_10px_rgba(6,182,212,0.2)]' 
                      : isSelected
                        ? 'border-indigo-500 bg-indigo-900/30'
                        : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
                  }`}
                  onClick={(e) => {
                      onMeasureSelect(measure.index, e.shiftKey, e.ctrlKey || e.metaKey);
                  }}
               >
                  {/* Header */}
                  <div 
                    className={`flex justify-between items-center px-2 py-0.5 rounded-t cursor-pointer transition-colors border-b ${
                        isSelected 
                            ? 'bg-indigo-900/50 border-indigo-500/50' 
                            : 'bg-slate-900/80 border-slate-800/50 hover:bg-slate-800'
                    }`}
                    onClick={(e) => {
                        // Action: Seek to start of measure only if not holding shift/ctrl
                        if (!e.shiftKey && !e.ctrlKey && !e.metaKey && layout) {
                            onSeek(layout.start);
                        }
                    }}
                    title="Click para posicionar audio (Shift+Click para seleccionar)"
                  >
                    <div className="flex items-center gap-1.5">
                        <span 
                            className={`font-mono text-[10px] font-bold cursor-pointer hover:text-cyan-400 ${isPlaying ? 'text-cyan-400' : isSelected ? 'text-indigo-300' : 'text-slate-500'}`}
                            onClick={(e) => { 
                                e.stopPropagation(); // Prevent seek
                                if (layout) onPlayRegion(layout.start, layout.duration); 
                            }}
                            title="Reproducir compás (Space para reproducir selección)"
                        >
                        {measure.index}
                        </span>
                        
                        {/* Mini Play Button */}
                        <button
                            className="text-slate-600 hover:text-cyan-400 transition-colors"
                            onClick={(e) => {
                                e.stopPropagation(); // Prevent seek
                                if (layout) onPlayRegion(layout.start, layout.duration);
                            }}
                            title="Reproducir compás"
                        >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                        </button>
                    </div>

                    <div className="flex items-center gap-1">
                        {measure.duration !== undefined && <span className="text-[8px] text-amber-500 font-bold" title="Duración Manual">R</span>}
                        
                        {/* Action Menu Trigger */}
                        <button 
                            className="text-slate-600 hover:text-slate-300 px-1 text-xs"
                            onClick={(e) => {
                                e.stopPropagation();
                                setActiveMenu(activeMenu === measure.index ? null : measure.index);
                            }}
                        >
                            ⋮
                        </button>
                    </div>
                  </div>

                   {/* Context Menu */}
                   {activeMenu === measure.index && (
                        <div className="absolute right-0 top-6 w-32 bg-slate-800 border border-slate-700 rounded shadow-xl z-50 flex flex-col text-[10px]">
                            <button className="px-2 py-1.5 text-left hover:bg-slate-700 text-slate-300" onClick={(e) => { e.stopPropagation(); onInsertMeasure(measure.index, 'before'); setActiveMenu(null); }}>Insertar Antes</button>
                            <button className="px-2 py-1.5 text-left hover:bg-slate-700 text-slate-300" onClick={(e) => { e.stopPropagation(); onInsertMeasure(measure.index, 'after'); setActiveMenu(null); }}>Insertar Después</button>
                            
                            {selectedMeasureIndices.includes(measure.index) && selectedMeasureIndices.length > 0 && (
                                <button className="px-2 py-1.5 text-left hover:bg-slate-700 text-indigo-300 border-t border-slate-700" onClick={(e) => { e.stopPropagation(); onDuplicateSelection(); setActiveMenu(null); }}>Duplicar Selección</button>
                            )}

                            {measure.duration !== undefined && (
                                    <button className="px-2 py-1.5 text-left hover:bg-slate-700 text-amber-400 border-t border-slate-700" onClick={(e) => { e.stopPropagation(); onMeasureDurationChange(measure.index, 0); onCommitChanges(); setActiveMenu(null); }}>Reset Duración</button>
                            )}
                            <button className="px-2 py-1.5 text-left hover:bg-red-900/20 text-red-400 border-t border-slate-700" onClick={(e) => { e.stopPropagation(); onDeleteMeasure(measure.index); setActiveMenu(null); }}>Eliminar</button>
                        </div>
                    )}

                  {/* Chords Input */}
                  <input
                    type="text"
                    value={measure.chords}
                    onChange={(e) => onMeasureUpdate(measure.index, 'chords', e.target.value)}
                    onBlur={onCommitChanges}
                    className={`w-full bg-transparent px-1 py-1 font-bold text-sm placeholder-indigo-900/30 focus:outline-none text-center ${isSelected ? 'text-indigo-200' : 'text-indigo-400'}`}
                    placeholder="-"
                  />

                  {/* Lyrics Input */}
                  <textarea
                    value={measure.lyrics}
                    onChange={(e) => onMeasureUpdate(measure.index, 'lyrics', e.target.value)}
                    onBlur={onCommitChanges}
                    rows={1}
                    className="w-full bg-transparent px-1 pb-1 text-[10px] text-slate-400 placeholder-slate-800 focus:outline-none resize-none text-center leading-tight overflow-hidden whitespace-nowrap"
                    placeholder="..."
                  />
               </div>
             );
          })}
          
          {/* Add Button */}
          <button 
            onClick={onAddMeasures}
            className="flex flex-col items-center justify-center min-h-[60px] rounded border-2 border-dashed border-slate-800 text-slate-600 hover:text-slate-400 hover:border-slate-600 transition-all opacity-50 hover:opacity-100"
          >
            <span className="text-lg font-bold">+</span>
          </button>
        </div>
      </div>
    </div>
  );
};