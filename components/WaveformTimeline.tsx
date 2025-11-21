
import React, { useEffect, useRef, useState } from 'react';
import * as Tone from 'tone';
import { GridConfig, Measure } from '../types';

interface WaveformTimelineProps {
  buffer: Tone.ToneAudioBuffer | null;
  gridConfig: GridConfig;
  measures: Measure[];
  currentTime: number;
  duration: number;
  onConfigChange: (config: GridConfig) => void;
  onMeasureDurationChange: (index: number, newDuration: number) => void;
  onCommitChanges: () => void; // Trigger history save
  onSeek: (time: number) => void;
  onPlayRegion: (start: number, duration: number) => void;
  autoScroll: boolean;
}

export const WaveformTimeline: React.FC<WaveformTimelineProps> = ({
  buffer,
  gridConfig,
  measures,
  currentTime,
  duration,
  onConfigChange,
  onMeasureDurationChange,
  onCommitChanges,
  onSeek,
  onPlayRegion,
  autoScroll
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(50); // Pixels per second
  const [draggingLine, setDraggingLine] = useState<number | null>(null); // Index of measure line being dragged

  // Helper to get standard duration
  const getStandardDuration = () => {
      const beats = gridConfig.tsTop * (4 / gridConfig.tsBottom);
      return (beats * 60) / gridConfig.bpm;
  };

  // Auto Scroll Logic
  useEffect(() => {
      if (autoScroll && containerRef.current) {
          const playheadX = currentTime * zoom;
          const containerWidth = containerRef.current.clientWidth;
          // Center the playhead
          const scrollPos = playheadX - (containerWidth / 2);
          containerRef.current.scrollLeft = scrollPos;
      }
  }, [currentTime, zoom, autoScroll]);

  // Draw Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 1. Setup Dimensions
    const width = Math.max(container.clientWidth, duration * zoom);
    const height = 160;
    canvas.width = width;
    canvas.height = height;

    // Clear
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#0f172a'; // slate-950
    ctx.fillRect(0, 0, width, height);

    // 2. Draw Waveform (Optimized)
    if (buffer && buffer.loaded) {
      const data = buffer.getChannelData(0);
      const step = Math.ceil(data.length / width);
      const amp = height / 2;

      ctx.beginPath();
      ctx.strokeStyle = '#334155'; // slate-700
      ctx.lineWidth = 1;

      for (let i = 0; i < width; i++) {
        const dataIndex = Math.floor(i * step);
        // Simple downsampling
        let min = 1.0;
        let max = -1.0;
        for (let j = 0; j < step; j++) {
          const datum = data[dataIndex + j];
          if (datum < min) min = datum;
          if (datum > max) max = datum;
        }
        if (min === 1.0) min = 0;
        if (max === -1.0) max = 0;

        ctx.moveTo(i, amp + min * amp);
        ctx.lineTo(i, amp + max * amp);
      }
      ctx.stroke();
    }

    // 3. Draw Grid Lines (Cumulative Measures)
    const standardDur = getStandardDuration();
    
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '10px JetBrains Mono';

    let currentT = gridConfig.offset;
    const drawLimit = Math.min(measures.length, 1000); 
    
    for (let i = 0; i < drawLimit; i++) {
        const m = measures[i];
        const x = currentT * zoom;
        const measureDuration = m.duration !== undefined ? m.duration : standardDur;

        if (x > -50 && x < width) {
            // Line Style
            const isFirst = i === 0;
            ctx.strokeStyle = isFirst ? '#22d3ee' : 'rgba(99, 102, 241, 0.5)';
            ctx.lineWidth = isFirst ? 2 : 1;
            
            // Draw Line
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();

            // Draw Number
            ctx.fillStyle = isFirst ? '#22d3ee' : '#818cf8';
            ctx.fillText((m.index).toString(), x + 4, 4);
            
            // Draw TS on first
            if (isFirst) {
                 ctx.fillStyle = 'rgba(255,255,255,0.3)';
                 ctx.fillText(`${gridConfig.tsTop}/${gridConfig.tsBottom}`, x + 4, 16);
            }
            // Draw "R" for rubato/custom duration
            if (m.duration !== undefined) {
                 ctx.fillStyle = '#f59e0b';
                 ctx.fillText(`R`, x + 4, height - 14);
            }

            // Draw Drag Handle Area (Visual only)
            ctx.fillStyle = 'rgba(255,255,255,0.05)';
            ctx.fillRect(x - 4, 0, 8, height);
        }
        
        currentT += measureDuration;
        if (currentT * zoom > width) break; 
    }

    // 4. Draw Playhead
    const playheadX = currentTime * zoom;
    ctx.strokeStyle = '#f59e0b'; // Amber
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, height);
    ctx.stroke();

    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.moveTo(playheadX - 5, 0);
    ctx.lineTo(playheadX + 5, 0);
    ctx.lineTo(playheadX, 8);
    ctx.fill();

  }, [buffer, duration, zoom, gridConfig, currentTime, measures]);

  // Mouse Interaction helpers
  const getMouseTime = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const scrollLeft = containerRef.current?.scrollLeft || 0;
    const x = (e.clientX - rect.left) + scrollLeft; // Fix relative mouse position by adding scroll
    return x / zoom;
  };

  // Calculate which measure line is closest
  const getClosestMeasureLine = (time: number) => {
      let t = gridConfig.offset;
      const standardDur = getStandardDuration();
      
      // Check start (index 0) - Offset
      if (Math.abs(time - t) < (10 / zoom)) return 0;

      for (let i = 0; i < measures.length; i++) {
          const m = measures[i];
          const dur = m.duration !== undefined ? m.duration : standardDur;
          t += dur;
          // t is now the END of measure i, or START of measure i+1
          // We map this line to index i+1
          if (Math.abs(time - t) < (10 / zoom)) return i + 1;
      }
      return -1;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    // Don't seek/drag if clicking scrollbar (simplistic check, usually browser handles it)
    // But we are clicking on canvas, so it's fine.
    
    const time = getMouseTime(e);
    const closestIndex = getClosestMeasureLine(time);

    if (closestIndex !== -1) {
      setDraggingLine(closestIndex);
    } else {
      onSeek(time);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const time = getMouseTime(e);
    const closestIndex = getClosestMeasureLine(time);
    
    canvas.style.cursor = draggingLine !== null ? 'ew-resize' : (closestIndex !== -1 ? 'ew-resize' : 'text');

    if (draggingLine !== null) {
      e.preventDefault();
      const newTime = Math.max(0, time);

      if (draggingLine === 0) {
        // Moving Offset
        onConfigChange({ ...gridConfig, offset: newTime });
      } else {
         // Rubato Logic
         const measureIndex = draggingLine - 1;
         if (measures[measureIndex]) {
             // 1. Find start time of this measure
             let startT = gridConfig.offset;
             const standardDur = getStandardDuration();
             
             for (let i = 0; i < measureIndex; i++) {
                 startT += (measures[i].duration !== undefined ? measures[i].duration! : standardDur);
             }
             
             // 2. Calculate new duration
             const newDuration = newTime - startT;
             
             if (newDuration > 0.1) { // Minimum duration safeguard
                 onMeasureDurationChange(measures[measureIndex].index, newDuration);
             }
         }
      }
    }
  };

  const handleMouseUp = () => {
    if (draggingLine !== null) {
        // We were dragging, so commit the changes to history now
        onCommitChanges();
    }
    setDraggingLine(null);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    const time = getMouseTime(e);
    if (time < gridConfig.offset) return;

    // Find which measure
    let t = gridConfig.offset;
    const standardDur = getStandardDuration();
    
    for (const m of measures) {
        const dur = m.duration !== undefined ? m.duration : standardDur;
        if (time >= t && time < t + dur) {
            onPlayRegion(t, dur);
            break;
        }
        t += dur;
    }
  };

  return (
    <div className="flex flex-col border-b border-slate-800 bg-slate-900">
        <div className="flex justify-between items-center px-4 py-2 bg-slate-900 border-b border-slate-800">
             <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Línea de Tiempo</h3>
             <div className="flex items-center gap-2">
                 <span className="text-[10px] text-slate-500">ZOOM</span>
                 <input 
                    type="range" 
                    min="10" 
                    max="200" 
                    value={zoom} 
                    onChange={(e) => setZoom(Number(e.target.value))}
                    className="w-24 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                 />
             </div>
        </div>
        <div 
            ref={containerRef}
            className="overflow-x-auto overflow-y-hidden relative select-none"
            style={{ height: '160px' }}
        >
            <canvas 
                ref={canvasRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onDoubleClick={handleDoubleClick}
                className="block touch-none"
            />
        </div>
        <div className="px-4 py-1 bg-slate-950/50 text-[10px] text-slate-500 flex gap-4">
            <span><strong className="text-cyan-400">Click + Arrastre (Inicio):</strong> Mover Offset</span>
            <span><strong className="text-indigo-400">Click + Arrastre (Líneas):</strong> Estirar compás (Rubato)</span>
            <span><strong className="text-emerald-400">Doble Click:</strong> Reproducir Compás</span>
        </div>
    </div>
  );
};
