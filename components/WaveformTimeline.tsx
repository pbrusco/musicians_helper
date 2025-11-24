import React, { useEffect, useRef, useState } from 'react';
import * as Tone from 'tone';
import { GridConfig, Measure, Marker, RegionSelection } from '../types';

interface WaveformTimelineProps {
  buffer: Tone.ToneAudioBuffer | null;
  gridConfig: GridConfig;
  measures: Measure[];
  markers: Marker[];
  currentTime: number;
  duration: number;
  selection: RegionSelection;
  onConfigChange: (config: GridConfig) => void;
  onMeasureDurationChange: (index: number, newDuration: number) => void;
  onCommitChanges: () => void; // Trigger history save
  onSeek: (time: number) => void;
  onPlayRegion: (start: number, duration: number) => void;
  autoScroll: boolean;
  onUpdateMarkers: (markers: Marker[]) => void;
  onUpdateSelection: (sel: RegionSelection) => void;
}

interface ContextMenuState {
    x: number;
    y: number;
    time: number;
    markerId?: string;
}

const LEFT_PADDING = 24; // Padding to avoid edge clipping

export const WaveformTimeline: React.FC<WaveformTimelineProps> = ({
  buffer,
  gridConfig,
  measures,
  markers,
  currentTime,
  duration,
  selection,
  onConfigChange,
  onMeasureDurationChange,
  onCommitChanges,
  onSeek,
  onPlayRegion,
  autoScroll,
  onUpdateMarkers,
  onUpdateSelection
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(50); // Pixels per second
  const [draggingLine, setDraggingLine] = useState<number | null>(null); // Index of measure line being dragged
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<number>(0);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Helper to get standard duration
  const getStandardDuration = () => {
      const beats = gridConfig.tsTop * (4 / gridConfig.tsBottom);
      return (beats * 60) / gridConfig.bpm;
  };

  // Auto Scroll Logic - Updated to only scroll if out of view
  useEffect(() => {
      if (autoScroll && containerRef.current) {
          const container = containerRef.current;
          const playheadX = (currentTime * zoom) + LEFT_PADDING;
          const { scrollLeft, clientWidth } = container;
          
          // Check if playhead is outside the visible area (with a small margin)
          // If the user clicks on a visible part (manual seek), this condition will likely be false (isVisible = true),
          // so it won't scroll.
          // If playback moves it past the right edge, it triggers scroll.
          const isVisible = playheadX >= scrollLeft && playheadX <= (scrollLeft + clientWidth);
          
          if (!isVisible) {
              // Scroll to follow
              container.scrollLeft = playheadX - (clientWidth * 0.2); // Keep some context to the left
          }
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
    const totalWidth = Math.max(container.clientWidth, (duration * zoom) + LEFT_PADDING + 100);
    const height = 160;
    const markersHeight = 24; // Reserved top area for markers
    
    if (canvas.width !== totalWidth || canvas.height !== height) {
        canvas.width = totalWidth;
        canvas.height = height;
    }

    // Clear
    ctx.clearRect(0, 0, totalWidth, height);
    ctx.fillStyle = '#0f172a'; // slate-950
    ctx.fillRect(0, 0, totalWidth, height);
    
    // Draw Markers Area Bg
    ctx.fillStyle = '#1e293b'; // slate-800
    ctx.fillRect(0, 0, totalWidth, markersHeight);
    ctx.strokeStyle = '#334155';
    ctx.beginPath();
    ctx.moveTo(0, markersHeight);
    ctx.lineTo(totalWidth, markersHeight);
    ctx.stroke();

    // SHIFT CONTEXT FOR PADDING
    ctx.save();
    ctx.translate(LEFT_PADDING, 0);

    // 2. Draw Waveform (Optimized)
    if (buffer && buffer.loaded) {
      const data = buffer.getChannelData(0);
      const waveformWidth = duration * zoom;
      const step = Math.ceil(data.length / waveformWidth);
      const waveHeight = height - markersHeight;
      const amp = waveHeight / 2;
      const yOffset = markersHeight;

      ctx.beginPath();
      ctx.strokeStyle = '#334155'; // slate-700
      ctx.lineWidth = 1;

      for (let i = 0; i < waveformWidth; i++) {
        const dataIndex = Math.floor(i * step);
        if (dataIndex >= data.length) break;

        // Simple downsampling
        let min = 1.0;
        let max = -1.0;
        for (let j = 0; j < step; j++) {
          if (dataIndex + j < data.length) {
              const datum = data[dataIndex + j];
              if (datum < min) min = datum;
              if (datum > max) max = datum;
          }
        }
        if (min === 1.0) min = 0;
        if (max === -1.0) max = 0;

        ctx.moveTo(i, yOffset + amp + min * amp);
        ctx.lineTo(i, yOffset + amp + max * amp);
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

        if (x > -50 && x < totalWidth) {
            // Line Style
            const isFirst = i === 0;
            ctx.strokeStyle = isFirst ? '#22d3ee' : 'rgba(99, 102, 241, 0.5)';
            ctx.lineWidth = isFirst ? 2 : 1;
            
            // Draw Line
            ctx.beginPath();
            ctx.moveTo(x, markersHeight);
            ctx.lineTo(x, height);
            ctx.stroke();

            // Draw Number
            ctx.fillStyle = isFirst ? '#22d3ee' : '#818cf8';
            ctx.fillText((m.index).toString(), x + 4, markersHeight + 4);
            
            // Draw TS on first
            if (isFirst) {
                 ctx.fillStyle = 'rgba(255,255,255,0.3)';
                 ctx.fillText(`${gridConfig.tsTop}/${gridConfig.tsBottom}`, x + 4, markersHeight + 16);
            }
            // Draw "R" for rubato/custom duration
            if (m.duration !== undefined) {
                 ctx.fillStyle = '#f59e0b';
                 ctx.fillText(`R`, x + 4, height - 14);
            }

            // Draw Drag Handle Area (Visual only)
            ctx.fillStyle = 'rgba(255,255,255,0.05)';
            ctx.fillRect(x - 4, markersHeight, 8, height - markersHeight);
        }
        
        currentT += measureDuration;
        if (currentT * zoom > totalWidth) break; 
    }
    
    // 4. Draw Markers
    markers.forEach(marker => {
        const mx = marker.time * zoom;
        if (mx >= -20 && mx < totalWidth + 20) {
            // Line
            ctx.beginPath();
            ctx.strokeStyle = '#ef4444'; // Red-500
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 2]);
            ctx.moveTo(mx, markersHeight);
            ctx.lineTo(mx, height);
            ctx.stroke();
            ctx.setLineDash([]);

            // Flag Head
            ctx.fillStyle = '#ef4444';
            ctx.beginPath();
            ctx.moveTo(mx, 0);
            ctx.lineTo(mx, markersHeight);
            ctx.lineTo(mx + 8, markersHeight - 6);
            ctx.lineTo(mx + 8, 6);
            ctx.lineTo(mx, 0);
            ctx.fill();
            
            // Label
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 10px Inter';
            ctx.fillText(marker.label, mx + 12, 6);
        }
    });

    // 5. Draw Selection (UNIFIED GREEN COLOR)
    if (selection.active) {
        const startX = selection.start * zoom;
        const endX = selection.end * zoom;
        const selWidth = endX - startX;
        
        // Change from Cyan to Green to match "Loop" state visual
        ctx.fillStyle = 'rgba(34, 197, 94, 0.2)'; // Green-500 equivalent transparent
        ctx.fillRect(startX, markersHeight, selWidth, height - markersHeight);
        
        // Borders
        ctx.strokeStyle = 'rgba(34, 197, 94, 0.6)';
        ctx.lineWidth = 1;
        ctx.strokeRect(startX, markersHeight, selWidth, height - markersHeight);
    }

    // 6. Draw Playhead
    const playheadX = currentTime * zoom;
    ctx.strokeStyle = '#f59e0b'; // Amber
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, height);
    ctx.stroke();

    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.moveTo(playheadX - 6, 0);
    ctx.lineTo(playheadX + 6, 0);
    ctx.lineTo(playheadX, 10);
    ctx.fill();
    
    // Restore context for next draw
    ctx.restore();

  }, [buffer, duration, zoom, gridConfig, currentTime, measures, markers, selection]);

  // Mouse Interaction helpers
  const getMouseTime = (e: React.MouseEvent) => {
    const x = e.nativeEvent.offsetX - LEFT_PADDING; // adjust for padding
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
          if (Math.abs(time - t) < (10 / zoom)) return i + 1;
      }
      return -1;
  };
  
  const getHoveredMarkerId = (time: number, y: number) => {
      // Allow clicking on top bar or slightly below
      if (y > 40) return null; 
      const tolerance = 15 / zoom; 
      const found = markers.find(m => Math.abs(m.time - time) < tolerance);
      return found ? found.id : null;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only left click
    setContextMenu(null);

    const time = getMouseTime(e);
    const y = e.nativeEvent.offsetY;
    
    // Check marker click first
    const markerId = getHoveredMarkerId(time, y);
    if (markerId) {
        const m = markers.find(mark => mark.id === markerId);
        if (m) onSeek(m.time);
        return;
    }

    const closestIndex = getClosestMeasureLine(time);

    if (closestIndex !== -1 && y > 24) {
      setDraggingLine(closestIndex);
    } else {
      // Start Selection or Seek
      // We seek on down, but if we drag, we become a selection
      setIsSelecting(true);
      setSelectionStart(time);
      onSeek(time);
      
      // Reset Selection on new click
      onUpdateSelection({ active: false, start: 0, end: 0 });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const time = getMouseTime(e);
    const y = e.nativeEvent.offsetY;
    
    const markerId = getHoveredMarkerId(time, y);
    const closestIndex = getClosestMeasureLine(time);
    
    // Cursor logic
    if (markerId) {
        canvas.style.cursor = 'pointer';
    } else if (draggingLine !== null) {
        canvas.style.cursor = 'ew-resize';
    } else if (closestIndex !== -1 && y > 24) {
        canvas.style.cursor = 'ew-resize';
    } else if (isSelecting) {
        canvas.style.cursor = 'text';
    } else {
        canvas.style.cursor = 'text';
    }

    // Logic
    if (draggingLine !== null) {
      e.preventDefault();
      const newTime = Math.max(0, time);

      if (draggingLine === 0) {
        onConfigChange({ ...gridConfig, offset: newTime });
      } else {
         const measureIndex = draggingLine - 1;
         if (measures[measureIndex]) {
             let startT = gridConfig.offset;
             const standardDur = getStandardDuration();
             
             for (let i = 0; i < measureIndex; i++) {
                 startT += (measures[i].duration !== undefined ? measures[i].duration! : standardDur);
             }
             
             const newDuration = newTime - startT;
             if (newDuration > 0.1) {
                 onMeasureDurationChange(measures[measureIndex].index, newDuration);
             }
         }
      }
    } else if (isSelecting) {
        // Update selection visual
        const start = Math.min(selectionStart, time);
        const end = Math.max(selectionStart, time);
        if (end - start > 0.1) {
             onUpdateSelection({ active: true, start, end });
        }
    }
  };

  const handleMouseUp = () => {
    if (draggingLine !== null) {
        onCommitChanges();
    }
    setDraggingLine(null);
    setIsSelecting(false);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    const time = getMouseTime(e);
    const y = e.nativeEvent.offsetY;
    
    // Marker Edit?
    const markerId = getHoveredMarkerId(time, y);
    if (markerId) {
        handleRenameMarker(markerId, e);
        return;
    }

    if (time < gridConfig.offset) return;

    // Find which measure and play it
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
  
  const handleContextMenu = (e: React.MouseEvent) => {
      e.preventDefault();
      const time = getMouseTime(e);
      const y = e.nativeEvent.offsetY;
      
      const markerId = getHoveredMarkerId(time, y);
      
      setContextMenu({
          x: e.clientX,
          y: e.clientY,
          time: time,
          markerId: markerId || undefined
      });
  };

  // Context Menu Actions
  const handleAddMarker = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!contextMenu) return;
      const id = Date.now().toString();
      const num = markers.length + 1;
      const newMarker: Marker = {
          id,
          time: contextMenu.time,
          label: `${num}`
      };
      onUpdateMarkers([...markers, newMarker]);
      setContextMenu(null);
  };
  
  const handleDeleteMarker = (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      onUpdateMarkers(markers.filter(m => m.id !== id));
      setContextMenu(null);
  };
  
  const handleRenameMarker = (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const marker = markers.find(m => m.id === id);
      if (!marker) return;
      
      // Use prompt safely
      // We close context menu AFTER processing
      const newLabel = prompt("Nombre de la marca:", marker.label);
      if (newLabel !== null) {
          const updated = markers.map(m => m.id === id ? { ...m, label: newLabel } : m);
          onUpdateMarkers(updated);
      }
      setContextMenu(null);
  };

  return (
    <div className="flex flex-col border-b border-slate-800 bg-slate-900 relative">
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
                onContextMenu={handleContextMenu}
                className="block touch-none"
            />
        </div>
        <div className="px-4 py-1 bg-slate-950/50 text-[10px] text-slate-500 flex gap-4">
            <span><strong className="text-green-400">Click + Arrastre:</strong> Seleccionar Región</span>
            <span><strong className="text-indigo-400">Arrastre Líneas:</strong> Ajustar Tiempo</span>
            <span><strong className="text-red-400">Click Derecho/Doble Click:</strong> Marcas</span>
        </div>

        {/* Context Menu Overlay */}
        {contextMenu && (
            <>
                <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)}></div>
                <div 
                    className="fixed z-50 bg-slate-800 border border-slate-700 rounded shadow-xl py-1 min-w-[120px]"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                >
                    {contextMenu.markerId ? (
                        <>
                            <button 
                                className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
                                onClick={(e) => handleRenameMarker(contextMenu.markerId!, e)}
                            >
                                Renombrar Marca
                            </button>
                            <button 
                                className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-slate-700"
                                onClick={(e) => handleDeleteMarker(contextMenu.markerId!, e)}
                            >
                                Eliminar Marca
                            </button>
                        </>
                    ) : (
                         <button 
                            className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
                            onClick={handleAddMarker}
                        >
                            Agregar Marca Aquí
                        </button>
                    )}
                </div>
            </>
        )}
    </div>
  );
};