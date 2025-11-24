
import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as Tone from 'tone';
import { Controls } from './components/Controls';
import { MeasureGrid } from './components/MeasureGrid';
import { GuitarTuner } from './components/GuitarTuner';
import { AudioState, LoadingState, ProcessingParams, Measure, GridConfig, Marker, RegionSelection, ProjectMeta } from './types';
import { GRAIN_SIZE, OVERLAP } from './constants';
import { WaveformTimeline } from './components/WaveformTimeline';
import { ConfirmationModal, AlertModal } from './components/Modals';

type GrainPlayerType = Tone.GrainPlayer;

interface HistoryState {
    measures: Measure[];
    gridConfig: GridConfig;
    markers: Marker[];
}

// In-memory cache for tabs so we don't lose data when switching
interface CachedProjectData {
    measures: Measure[];
    gridConfig: GridConfig;
    markers: Marker[];
    params: ProcessingParams;
    history: HistoryState[];
    historyIndex: number;
    // Audio Data
    audioBuffer: Tone.ToneAudioBuffer | null;
    audioFileName: string;
    audioUrl: string | null;
    audioDuration: number;
}

const NOTES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTES_FLAT  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// Helper to convert circle of fifths to key string
const fifthsToKey = (fifths: number, mode: string = 'major'): string => {
    const majorKeys: {[key: number]: string} = {
        0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#',
        [-1]: 'F', [-2]: 'Bb', [-3]: 'Eb', [-4]: 'Ab', [-5]: 'Db', [-6]: 'Gb', [-7]: 'Cb'
    };

    let key = majorKeys[fifths] || 'C';
    
    if (mode === 'minor') {
       let idx = NOTES_SHARP.indexOf(key);
       if (idx === -1) idx = NOTES_FLAT.indexOf(key);
       if (idx !== -1) {
           let minIdx = (idx - 3 + 12) % 12;
           const useFlat = fifths < 0 || key.includes('b');
           key = (useFlat ? NOTES_FLAT[minIdx] : NOTES_SHARP[minIdx]) + 'm';
       }
    }
    return key;
};

// Helper to convert key string to circle of fifths number
const keyToFifths = (keyStr: string): number => {
    const isMinor = keyStr.endsWith('m');
    let root = keyStr.replace('m', '');
    
    if (isMinor) {
        let idx = NOTES_SHARP.indexOf(root);
        if (idx === -1) idx = NOTES_FLAT.indexOf(root);
        if (idx !== -1) {
            let majIdx = (idx + 3) % 12;
            root = NOTES_SHARP[majIdx]; 
            if (['D#', 'G#', 'A#'].includes(root)) root = NOTES_FLAT[majIdx]; 
        }
    }

    const majorFifths: {[key: string]: number} = {
        'C': 0, 'G': 1, 'D': 2, 'A': 3, 'E': 4, 'B': 5, 'F#': 6, 'C#': 7,
        'F': -1, 'Bb': -2, 'Eb': -3, 'Ab': -4, 'Db': -5, 'Gb': -6, 'Cb': -7
    };

    return majorFifths[root] !== undefined ? majorFifths[root] : 0;
};


const App: React.FC = () => {
  // --- State ---
  const [loadingState, setLoadingState] = useState<LoadingState>(LoadingState.IDLE);
  const [statusMessage, setStatusMessage] = useState('');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'dirty'>('saved');
  
  // Projects System (Memory Only)
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [showNewProjectModal, setShowNewProjectModal] = useState(true);
  
  // Modals
  const [confirmationModal, setConfirmationModal] = useState<{ isOpen: boolean; message: string; onConfirm: () => void; onCancel: () => void } | null>(null);
  const [alertModal, setAlertModal] = useState<{ isOpen: boolean; message: string; onClose: () => void } | null>(null);

  // Cache to hold state of inactive tabs
  const projectCache = useRef<Record<string, CachedProjectData>>({});

  const [audioState, setAudioState] = useState<AudioState>({
    url: null,
    fileName: '',
    isLoaded: false,
    isPlaying: false,
    duration: 0,
    currentTime: 0,
    buffer: null,
  });

  const [params, setParams] = useState<ProcessingParams>({
    speed: 1.0,
    pitch: 0,
    volume: -5,
    eqLow: 0,
    eqMid: 0,
    eqHigh: 0
  });

  const [selection, setSelection] = useState<RegionSelection>({
    active: false,
    start: 0,
    end: 0
  });

  const [selectedMeasureIndices, setSelectedMeasureIndices] = useState<number[]>([]);

  const [showTuner, setShowTuner] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isCompactMode, setIsCompactMode] = useState(false);

  // -- Composition (Grid) Data --
  const [gridConfig, setGridConfig] = useState<GridConfig>({
    bpm: 120,
    tsTop: 4,
    tsBottom: 4,
    keySignature: 'C',
    offset: 0,
    beatUnit: 'quarter'
  });
  const [measures, setMeasures] = useState<Measure[]>([]);
  const [markers, setMarkers] = useState<Marker[]>([]);

  // -- History State --
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // --- Refs ---
  const playerRef = useRef<GrainPlayerType | null>(null);
  const eqRef = useRef<Tone.EQ3 | null>(null);
  const analyserRef = useRef<Tone.Waveform | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const xmlInputRef = useRef<HTMLInputElement>(null);
  
  // Playback Timing Refs
  const playbackStartTimeRef = useRef<number>(0);
  const playbackOffsetRef = useRef<number>(0);

  // --- Helpers ---
  const getStandardDuration = useCallback(() => {
    let effectiveBpm = gridConfig.bpm;
    if (gridConfig.beatUnit === 'eighth') effectiveBpm = effectiveBpm / 2;
    if (gridConfig.beatUnit === 'dotted-quarter') effectiveBpm = effectiveBpm * 1.5;

    const beats = gridConfig.tsTop * (4 / gridConfig.tsBottom);
    return (beats * 60) / effectiveBpm;
  }, [gridConfig]);

  const syncSelectionWithMeasures = useCallback((indices: number[]) => {
    if (indices.length === 0) {
        setSelection({ active: false, start: 0, end: 0 });
        return;
    }

    const sortedIndices = [...indices].sort((a, b) => a - b);
    const minIdx = sortedIndices[0];
    const maxIdx = sortedIndices[sortedIndices.length - 1];

    let t = gridConfig.offset;
    let start = -1;
    let end = -1;
    const stdDur = getStandardDuration();

    const sortedMeasures = [...measures].sort((a,b) => a.index - b.index);

    for (const m of sortedMeasures) {
        const dur = m.duration !== undefined ? m.duration : stdDur;
        if (m.index === minIdx) start = t;
        if (m.index === maxIdx) end = t + dur;
        t += dur;
        if (start !== -1 && end !== -1) break;
    }

    if (start !== -1 && end !== -1) {
        const newSel = { active: true, start, end };
        setSelection(newSel);
        if (!audioState.isPlaying) {
             setAudioState(prev => ({ ...prev, currentTime: start }));
        }
    }
  }, [measures, gridConfig, getStandardDuration, audioState.isPlaying]);


  // --- Audio Initialization ---
  const initAudio = async (buffer: Tone.ToneAudioBuffer, currentParams: ProcessingParams = params) => {
    if (playerRef.current) {
      playerRef.current.dispose();
      playerRef.current = null;
    }
    if (eqRef.current) {
      eqRef.current.dispose();
      eqRef.current = null;
    }
    
    const player = new Tone.GrainPlayer(buffer);
    player.grainSize = GRAIN_SIZE;
    player.overlap = OVERLAP;
    
    const eq = new Tone.EQ3(currentParams.eqLow, currentParams.eqMid, currentParams.eqHigh);
    const analyser = new Tone.Waveform(256);
    analyserRef.current = analyser;

    player.chain(eq, analyser, Tone.Destination);

    playerRef.current = player;
    eqRef.current = eq;

    player.playbackRate = currentParams.speed;
    player.detune = currentParams.pitch * 100;
    player.volume.value = currentParams.volume;

    let effectiveBpm = gridConfig.bpm;
    if (gridConfig.beatUnit === 'eighth') effectiveBpm = effectiveBpm / 2;
    if (gridConfig.beatUnit === 'dotted-quarter') effectiveBpm = effectiveBpm * 1.5;
    Tone.Transport.bpm.value = effectiveBpm;

    setAudioState(prev => ({
      ...prev,
      isLoaded: true,
      duration: buffer.duration,
      buffer: buffer
    }));
    
    setLoadingState(LoadingState.READY);
  };

  // --- Project Management Functions ---

  // Startup Logic
  useEffect(() => {
      if (projects.length === 0) {
          setShowNewProjectModal(true);
      }
  }, [projects]);

  // Helper: Save current tab state to memory cache
  const saveCurrentToCache = (projectId: string) => {
      projectCache.current[projectId] = {
          measures,
          gridConfig,
          markers,
          params,
          history,
          historyIndex,
          audioBuffer: audioState.buffer,
          audioFileName: audioState.fileName,
          audioUrl: audioState.url,
          audioDuration: audioState.duration
      };
  };

  // Helper: Load tab state from memory cache
  const loadFromCache = async (projectId: string) => {
      const data = projectCache.current[projectId];
      if (!data) return;

      setLoadingState(LoadingState.PROCESSING);
      setStatusMessage('Cambiando proyecto...');
      
      // Stop current playback
      if (playerRef.current) {
          playerRef.current.stop();
          setAudioState(prev => ({ ...prev, isPlaying: false }));
      }

      setMeasures(data.measures);
      setGridConfig(data.gridConfig);
      setMarkers(data.markers);
      setParams(data.params);
      setHistory(data.history);
      setHistoryIndex(data.historyIndex);

      setAudioState(prev => ({
          ...prev,
          fileName: data.audioFileName,
          url: data.audioUrl,
          duration: data.audioDuration,
          currentTime: 0,
          buffer: data.audioBuffer,
          isLoaded: !!data.audioBuffer
      }));

      // Re-initialize audio node if buffer exists
      if (data.audioBuffer) {
          await initAudio(data.audioBuffer, data.params);
      } else {
          setLoadingState(LoadingState.IDLE);
      }
      
      setStatusMessage('');
  };

  const handleSwitchProject = (newProjectId: string) => {
      if (activeProjectId === newProjectId) return;
      
      // Save current
      if (activeProjectId) {
          saveCurrentToCache(activeProjectId);
      }
      
      // Set new active
      setActiveProjectId(newProjectId);
      
      // Load new
      loadFromCache(newProjectId);
  };

  const createBlankProject = () => {
      const newId = crypto.randomUUID();
      const newProject: ProjectMeta = {
          id: newId,
          name: 'Proyecto Cuchá',
          lastOpened: Date.now()
      };
      
      // Initialize Cache for this new project
      projectCache.current[newId] = {
          measures: [],
          gridConfig: { bpm: 120, tsTop: 4, tsBottom: 4, keySignature: 'C', offset: 0, beatUnit: 'quarter' },
          markers: [],
          params: { speed: 1.0, pitch: 0, volume: -5, eqLow: 0, eqMid: 0, eqHigh: 0 },
          history: [],
          historyIndex: -1,
          audioBuffer: null,
          audioFileName: '',
          audioUrl: null,
          audioDuration: 0
      };

      // If we are switching from another project, save that first
      if (activeProjectId) {
          saveCurrentToCache(activeProjectId);
      }

      setProjects(prev => [...prev, newProject]);
      setActiveProjectId(newId);
      loadFromCache(newId);
      setShowNewProjectModal(false);
  };

  const handleImportProjectJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (ev) => {
          try {
              const data = JSON.parse(ev.target?.result as string);
              const newId = crypto.randomUUID();
              const newName = data.fileName || "Proyecto Importado";

              const importedState: CachedProjectData = {
                  measures: data.measures || [],
                  gridConfig: data.gridConfig || { bpm: 120, tsTop: 4, tsBottom: 4, keySignature: 'C', offset: 0, beatUnit: 'quarter' },
                  markers: data.markers || data.measuresMarkers || [],
                  params: data.params || { speed: 1.0, pitch: 0, volume: -5, eqLow: 0, eqMid: 0, eqHigh: 0 },
                  history: [], // Start with empty history for simplicity
                  historyIndex: -1,
                  audioBuffer: null, // Audio is NOT in JSON
                  audioFileName: newName,
                  audioUrl: null,
                  audioDuration: 0
              };

              projectCache.current[newId] = importedState;
              
              if (activeProjectId) {
                  saveCurrentToCache(activeProjectId);
              }

              const newProjectMeta: ProjectMeta = { id: newId, name: newName, lastOpened: Date.now() };
              setProjects(prev => [...prev, newProjectMeta]);
              setActiveProjectId(newId);
              loadFromCache(newId);
              setShowNewProjectModal(false);

          } catch(err) {
              console.error(err);
              setAlertModal({ isOpen: true, message: "Error al importar el archivo de proyecto.", onClose: () => setAlertModal(null) });
          }
      };
      reader.readAsText(file);
  };

  const handleDownloadProject = () => {
      if (!activeProjectId) return;
      setSaveStatus('saving');
      
      const projectData = {
          fileName: audioState.fileName,
          gridConfig,
          measures,
          markers,
          params
      };
      
      const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${audioState.fileName || 'cucha-project'}.json`;
      a.click();
      URL.revokeObjectURL(url);

      setTimeout(() => {
          setSaveStatus('saved');
      }, 500);
  };

  const performCloseProject = (projectId: string) => {
      // Remove from cache
      delete projectCache.current[projectId];
      
      const newProjects = projects.filter(p => p.id !== projectId);
      setProjects(newProjects);
      
      if (activeProjectId === projectId) {
          if (newProjects.length > 0) {
              // Switch to the first available
              handleSwitchProject(newProjects[0].id);
          } else {
              // Logic handled by useEffect -> Show Modal
              setActiveProjectId(null);
          }
      }
      setConfirmationModal(null);
  };

  const handleCloseProject = (e: React.MouseEvent, projectId: string) => {
      e.stopPropagation(); 
      e.preventDefault();

      setConfirmationModal({
        isOpen: true,
        message: '¿Cerrar este proyecto? Los cambios no guardados en archivo se perderán.',
        onConfirm: () => performCloseProject(projectId),
        onCancel: () => setConfirmationModal(null)
      });
  };

  // 3. DIRTY STATE CHECK 
  useEffect(() => {
    if (!activeProjectId) return;
    if (loadingState !== LoadingState.READY && loadingState !== LoadingState.IDLE) return;
    setSaveStatus('dirty');
  }, [measures, gridConfig, markers, params, audioState.fileName]);


  // --- File Handling ---
  const processFile = async (file: File | Blob, fileName?: string) => {
    setLoadingState(LoadingState.PROCESSING);
    setStatusMessage('Decodificando audio...');

    try {
      const arrayBuffer = await file.arrayBuffer();
      if (Tone.getContext().state === 'suspended') {
          await Tone.getContext().resume();
      }
      const audioContext = Tone.getContext().rawContext;
      const decodedBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const toneBuffer = new Tone.ToneAudioBuffer(decodedBuffer);
      
      await initAudio(toneBuffer);
      
      const name = fileName || (file as File).name || 'Audio Importado';
      const url = URL.createObjectURL(file);

      setAudioState(prev => ({
        ...prev,
        fileName: name,
        url: url
      }));

      // Update name in tabs if generic
      if (activeProjectId) {
          const currentProj = projects.find(p => p.id === activeProjectId);
          if (currentProj && currentProj.name === 'Proyecto Cuchá') {
               setProjects(projects.map(p => p.id === activeProjectId ? { ...p, name: name } : p));
          }
      }

      if (measures.length === 0) {
           initializeMeasures(toneBuffer.duration, gridConfig.bpm, gridConfig.tsTop, gridConfig.tsBottom);
      }

      setSaveStatus('dirty'); 
      setStatusMessage('');

    } catch (err) {
      console.error(err);
      setLoadingState(LoadingState.ERROR);
      setStatusMessage('Error al cargar audio.');
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) await processFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file && file.type.startsWith('audio/')) {
          await processFile(file);
      }
  };
  
  const initializeMeasures = (duration: number, bpm: number, tsTop: number, tsBottom: number) => {
      const secondsPerBeat = 60 / bpm; 
      const secondsPerMeasure = secondsPerBeat * (tsTop * (4/tsBottom));
      const count = Math.ceil(duration / secondsPerMeasure);
      
      const newMeasures: Measure[] = [];
      for(let i=1; i<=count; i++) {
          newMeasures.push({
              index: i,
              chords: '',
              lyrics: ''
          });
      }
      setMeasures(newMeasures);
      addToHistory(newMeasures, gridConfig, markers);
  };

  // --- History Management ---
  const addToHistory = (ms: Measure[], gc: GridConfig, mks: Marker[]) => {
      const newState = { 
          measures: JSON.parse(JSON.stringify(ms)), 
          gridConfig: { ...gc },
          markers: JSON.parse(JSON.stringify(mks))
      };
      
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(newState);
      
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
  };

  const undo = useCallback(() => {
      if (historyIndex > 0) {
          const prevState = history[historyIndex - 1];
          setMeasures(prevState.measures);
          setGridConfig(prevState.gridConfig);
          setMarkers(prevState.markers);
          setHistoryIndex(historyIndex - 1);
      }
  }, [history, historyIndex]);

  const redo = useCallback(() => {
      if (historyIndex < history.length - 1) {
          const nextState = history[historyIndex + 1];
          setMeasures(nextState.measures);
          setGridConfig(nextState.gridConfig);
          setMarkers(nextState.markers);
          setHistoryIndex(historyIndex + 1);
      }
  }, [history, historyIndex]);

  const handleCommitChanges = () => {
      addToHistory(measures, gridConfig, markers);
      setSaveStatus('dirty');
  };

  // --- Playback Controls ---
  const togglePlay = useCallback(async () => {
    if (!playerRef.current) return;

    if (Tone.getContext().state !== 'running') {
      await Tone.start();
    }

    if (audioState.isPlaying) {
      playerRef.current.stop();
      setAudioState(prev => ({ ...prev, isPlaying: false }));
    } else {
      playerRef.current.loop = false;
      playerRef.current.start(undefined, audioState.currentTime);
      
      playbackStartTimeRef.current = Tone.now();
      playbackOffsetRef.current = audioState.currentTime;

      setAudioState(prev => ({ ...prev, isPlaying: true }));
    }
  }, [audioState.isPlaying, audioState.currentTime]);

  const handleSeek = (time: number) => {
    const newTime = Math.max(0, Math.min(time, audioState.duration));
    
    if (playerRef.current && audioState.isPlaying) {
        playerRef.current.stop();
        playerRef.current.start(undefined, newTime);
        playbackStartTimeRef.current = Tone.now();
        playbackOffsetRef.current = newTime;
    }
    
    setAudioState(prev => ({ ...prev, currentTime: newTime }));
  };

  const handlePlayRegion = (start: number, duration: number) => {
      if (!playerRef.current) return;
      if (Tone.getContext().state !== 'running') Tone.start();

      playerRef.current.stop();
      playerRef.current.loop = false;
      playerRef.current.start(undefined, start, duration);
      
      playbackStartTimeRef.current = Tone.now();
      playbackOffsetRef.current = start;
      
      setSelection({ active: true, start: start, end: start + duration });
      setAudioState(prev => ({ ...prev, isPlaying: true, currentTime: start }));
  };

  // --- Duplicate Logic ---
  const handleDuplicateSelection = useCallback(() => {
      if (selectedMeasureIndices.length === 0) return;

      const sortedIndices = [...selectedMeasureIndices].sort((a, b) => a - b);
      const insertPointIndex = sortedIndices[sortedIndices.length - 1];
      
      const measuresToDuplicate = measures.filter(m => sortedIndices.includes(m.index));
      if (measuresToDuplicate.length === 0) return;

      const newBlock = measuresToDuplicate.map(m => ({
          ...m,
          index: 0
      }));

      const newMeasuresList = [...measures];
      newMeasuresList.splice(insertPointIndex, 0, ...newBlock);

      const reindexed = newMeasuresList.map((m, i) => ({
          ...m,
          index: i + 1
      }));

      setMeasures(reindexed);
      addToHistory(reindexed, gridConfig, markers);
      setSaveStatus('dirty');

      const newSelectionStart = insertPointIndex + 1;
      const newSelectionEnd = insertPointIndex + newBlock.length;
      const newSelectionIndices = [];
      for(let i=newSelectionStart; i<=newSelectionEnd; i++) newSelectionIndices.push(i);
      
      setSelectedMeasureIndices(newSelectionIndices);
      
      let t = gridConfig.offset;
      let start = -1, end = -1;
      const stdDur = getStandardDuration();
      
      for (const m of reindexed) {
          const dur = m.duration !== undefined ? m.duration : stdDur;
          if (m.index === newSelectionStart) start = t;
          if (m.index === newSelectionEnd) end = t + dur;
          t += dur;
          if (start !== -1 && end !== -1) break;
      }
      
      if (start !== -1 && end !== -1) {
          setSelection({ active: true, start, end });
          if (!audioState.isPlaying) {
             setAudioState(prev => ({ ...prev, currentTime: start }));
          }
      }

  }, [measures, selectedMeasureIndices, gridConfig, markers, history, historyIndex, getStandardDuration, audioState.isPlaying]);


  // --- Keyboard Shortcuts ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = (target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'text') || 
                      (target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'number') ||
                      target.tagName === 'TEXTAREA' || 
                      target.isContentEditable;
      
      if (!isInput) {
          if (e.code === 'Space') {
            e.preventDefault(); 
            togglePlay();
            return;
          }
          if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
             e.preventDefault();
             handleDownloadProject();
             return;
          }
          if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && !e.shiftKey) {
              e.preventDefault();
              undo();
              return;
          }
          if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyR' || (e.shiftKey && e.code === 'KeyZ'))) {
              e.preventDefault();
              redo();
              return;
          }
          if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
             e.preventDefault();
             const lastSelected = selectedMeasureIndices.length > 0 
                ? Math.max(...selectedMeasureIndices) 
                : 0;

             let nextIndex = lastSelected;
             if (e.code === 'ArrowRight') nextIndex = Math.min(measures.length, lastSelected + 1);
             if (e.code === 'ArrowLeft') nextIndex = Math.max(1, lastSelected - 1);

             if (nextIndex !== lastSelected && nextIndex > 0) {
                 const newIndices = [nextIndex];
                 setSelectedMeasureIndices(newIndices);
                 syncSelectionWithMeasures(newIndices);
             }
             return;
          }
          if ((e.ctrlKey || e.metaKey) && e.code === 'KeyD') {
              e.preventDefault();
              handleDuplicateSelection();
              return;
          }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, selectedMeasureIndices, measures, gridConfig, handleDuplicateSelection, syncSelectionWithMeasures, undo, redo, handleDownloadProject]);

  // --- Fullscreen Logic ---
  useEffect(() => {
    const handleFullscreenChange = () => {
        setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
      if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(err => {
              console.error("Error attempting to enable fullscreen:", err);
          });
      } else {
          document.exitFullscreen();
      }
  };

  const toggleCompactMode = () => {
      setIsCompactMode(!isCompactMode);
  };

  // --- MusicXML Handler ---
  const handleExportXML = () => {
      const fifths = keyToFifths(gridConfig.keySignature);
      const mode = gridConfig.keySignature.endsWith('m') ? 'minor' : 'major';
      
      let xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1">
      <part-name>Music</part-name>
    </score-part>
  </part-list>
  <part id="P1">`;

      measures.forEach((m, index) => {
          xml += `
    <measure number="${m.index}">`;
          
          if (index === 0) {
              xml += `
      <attributes>
        <divisions>1</divisions>
        <key>
          <fifths>${fifths}</fifths>
          <mode>${mode}</mode>
        </key>
        <time>
          <beats>${gridConfig.tsTop}</beats>
          <beat-type>${gridConfig.tsBottom}</beat-type>
        </time>
        <clef>
          <sign>G</sign>
          <line>2</line>
        </clef>
      </attributes>`;
          }

          if (m.chords.trim()) {
              const match = m.chords.match(/^([A-G])([#b]?)(.*)$/);
              if (match) {
                  const rootStep = match[1];
                  const alterSign = match[2];
                  const kindStr = match[3];
                  
                  let alter = 0;
                  if (alterSign === '#') alter = 1;
                  if (alterSign === 'b') alter = -1;

                  let kind = 'major';
                  if (kindStr.includes('m') && !kindStr.includes('maj')) kind = 'minor';
                  if (kindStr.includes('7')) kind = 'dominant'; 
                  
                  xml += `
      <harmony>
        <root>
          <root-step>${rootStep}</root-step>${alter !== 0 ? `
          <root-alter>${alter}</root-alter>` : ''}
        </root>
        <kind>${kind}</kind>
      </harmony>`;
              }
          }

          xml += `
      <note>
        <rest/>
        <duration>${gridConfig.tsTop}</duration>
        ${m.lyrics.trim() ? `
        <lyric>
          <syllabic>single</syllabic>
          <text>${m.lyrics}</text>
        </lyric>` : ''}
      </note>`;

          xml += `
    </measure>`;
      });

      xml += `
  </part>
</score-partwise>`;

      const blob = new Blob([xml], { type: 'application/vnd.recordare.musicxml+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${audioState.fileName || 'score'}.musicxml`;
      a.click();
      URL.revokeObjectURL(url);
  };

  const handleLoadXML = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = '';

      const reader = new FileReader();
      reader.onload = (ev) => {
          const text = ev.target?.result as string;
          try {
              const parser = new DOMParser();
              const doc = parser.parseFromString(text, "text/xml");
              
              const parserError = doc.querySelector('parsererror');
              if (parserError) throw new Error("XML Parsing Error");

              const parts = doc.getElementsByTagName('part');
              let targetPart: Element | null = null;
              for(let i=0; i<parts.length; i++) {
                  if (parts[i].getElementsByTagName('measure').length > 0) {
                      targetPart = parts[i];
                      break;
                  }
              }

              if (!targetPart) throw new Error("No part found with measures");

              const xmlMeasures = targetPart.getElementsByTagName('measure');
              const newMeasures: Measure[] = [];
              let currentKeySig = gridConfig.keySignature;
              let currentTop = gridConfig.tsTop;
              let currentBottom = gridConfig.tsBottom;

              for (let i = 0; i < xmlMeasures.length; i++) {
                  const xm = xmlMeasures[i];

                  const attributes = xm.getElementsByTagName('attributes')[0];
                  if (attributes) {
                      const keyEl = attributes.getElementsByTagName('key')[0];
                      if (keyEl) {
                          const fifths = keyEl.getElementsByTagName('fifths')[0]?.textContent;
                          const mode = keyEl.getElementsByTagName('mode')[0]?.textContent;
                          if (fifths) {
                             currentKeySig = fifthsToKey(parseInt(fifths), mode || 'major');
                          }
                      }
                      const timeEl = attributes.getElementsByTagName('time')[0];
                      if (timeEl) {
                          const beats = timeEl.getElementsByTagName('beats')[0]?.textContent;
                          const beatType = timeEl.getElementsByTagName('beat-type')[0]?.textContent;
                          if (beats && beatType) {
                              currentTop = parseInt(beats);
                              currentBottom = parseInt(beatType);
                          }
                      }
                  }

                  let chords = '';
                  const harmony = xm.getElementsByTagName('harmony')[0];
                  if (harmony) {
                      const root = harmony.getElementsByTagName('root')[0];
                      const step = root?.getElementsByTagName('root-step')[0]?.textContent || '';
                      const alterEl = root?.getElementsByTagName('root-alter')[0];
                      const kind = harmony.getElementsByTagName('kind')[0]?.textContent || '';

                      let alter = '';
                      if (alterEl && alterEl.textContent) {
                          const val = parseInt(alterEl.textContent);
                          if (val === 1) alter = '#';
                          if (val === -1) alter = 'b';
                      }

                      let suffix = '';
                      if (kind === 'minor') suffix = 'm';
                      else if (kind === 'dominant') suffix = '7';
                      else if (kind.includes('seventh')) suffix = '7'; 
                      else if (kind === 'diminished') suffix = 'dim';
                      
                      chords = `${step}${alter}${suffix}`;
                  }

                  let lyrics = '';
                  const notes = xm.getElementsByTagName('note');
                  for(let j=0; j<notes.length; j++) {
                      const lyricEl = notes[j].getElementsByTagName('lyric')[0];
                      if (lyricEl) {
                          const textEl = lyricEl.getElementsByTagName('text')[0];
                          if (textEl && textEl.textContent) {
                              if (lyrics) lyrics += ' ';
                              lyrics += textEl.textContent;
                          }
                      }
                  }

                  newMeasures.push({
                      index: i + 1,
                      chords,
                      lyrics
                  });
              }
              
              setMeasures(newMeasures);
              const newConfig = {
                  ...gridConfig,
                  keySignature: currentKeySig,
                  tsTop: currentTop,
                  tsBottom: currentBottom
              };
              setGridConfig(newConfig);
              addToHistory(newMeasures, newConfig, markers);
              setSaveStatus('dirty');

          } catch(err) {
              console.error(err);
              setAlertModal({ isOpen: true, message: "Error al importar MusicXML. Asegúrate de que el formato sea válido.", onClose: () => setAlertModal(null) });
          }
      };
      reader.readAsText(file);
  };

  // --- Update Loop (Animation Frame) ---
  useEffect(() => {
    let rafId: number;

    const updateLoop = () => {
      if (playerRef.current && audioState.isLoaded && audioState.isPlaying) {
         const now = Tone.now();
         const elapsed = now - playbackStartTimeRef.current;
         const currentSpeed = playerRef.current.playbackRate;
         
         let nextTime = playbackOffsetRef.current + (elapsed * currentSpeed);
         
         if (nextTime >= audioState.duration) {
              nextTime = audioState.duration;
              playerRef.current.stop();
              setAudioState(prev => ({ ...prev, isPlaying: false, currentTime: nextTime }));
         } else if (selection.active && selection.end > selection.start && nextTime >= selection.end) {
              playerRef.current.stop();
              setAudioState(prev => ({ ...prev, isPlaying: false, currentTime: selection.start }));
         } else {
              setAudioState(prev => ({ ...prev, currentTime: nextTime }));
         }
      }
      rafId = requestAnimationFrame(updateLoop);
    };

    rafId = requestAnimationFrame(updateLoop);
    return () => cancelAnimationFrame(rafId);
  }, [audioState.isLoaded, audioState.isPlaying, selection, audioState.duration]);


  // --- Param Changes ---
  const handleParamChange = (key: keyof ProcessingParams, value: number) => {
    setParams(prev => ({ ...prev, [key]: value }));
    setSaveStatus('dirty');
    
    if (!playerRef.current || !eqRef.current) return;

    if (key === 'speed') {
        if (audioState.isPlaying) {
             const now = Tone.now();
             const currentSpeed = playerRef.current.playbackRate; 
             const elapsed = now - playbackStartTimeRef.current;
             playbackOffsetRef.current = playbackOffsetRef.current + (elapsed * currentSpeed);
             playbackStartTimeRef.current = now;
        }
        playerRef.current.playbackRate = value;
    }
    if (key === 'pitch') playerRef.current.detune = value * 100;
    if (key === 'volume') playerRef.current.volume.value = value;
    
    if (key === 'eqLow') eqRef.current.low.value = value;
    if (key === 'eqMid') eqRef.current.mid.value = value;
    if (key === 'eqHigh') eqRef.current.high.value = value;
  };

  const handleUpdateSelection = (sel: RegionSelection) => {
      setSelection(sel);
  };

  // --- Grid/Measure Handlers ---
  const handleMeasureUpdate = (index: number, field: keyof Measure, value: any) => {
      const newMeasures = measures.map(m => {
          if (m.index === index) {
              return { ...m, [field]: value };
          }
          return m;
      });
      setMeasures(newMeasures);
      setSaveStatus('dirty');
  };

  const handleMeasureDurationChange = (index: number, newDuration: number) => {
      const newMeasures = measures.map(m => {
          if (m.index === index) {
              return { ...m, duration: newDuration > 0 ? newDuration : undefined };
          }
          return m;
      });
      setMeasures(newMeasures);
      setSaveStatus('dirty');
  };
  
  const handleAddMeasures = () => {
      const lastIndex = measures.length > 0 ? measures[measures.length-1].index : 0;
      const newMeasures = [...measures];
      for(let i=1; i<=4; i++) {
          newMeasures.push({ index: lastIndex + i, chords: '', lyrics: '' });
      }
      setMeasures(newMeasures);
      addToHistory(newMeasures, gridConfig, markers);
      setSaveStatus('dirty');
  };
  
  const handleDeleteMeasure = (index: number) => {
      const newMeasures = measures.filter(m => m.index !== index)
          .map((m, i) => ({ ...m, index: i + 1 })); 
      setMeasures(newMeasures);
      setSelectedMeasureIndices(prev => prev.filter(i => i !== index));
      addToHistory(newMeasures, gridConfig, markers);
      setSaveStatus('dirty');
  };

  const handleInsertMeasure = (targetIndex: number, position: 'before' | 'after') => {
      const newMeasures = [...measures];
      const insertIndex = position === 'before' ? targetIndex - 1 : targetIndex;
      
      newMeasures.splice(insertIndex, 0, {
          index: 0,
          chords: '',
          lyrics: ''
      });
      
      const reindexed = newMeasures.map((m, i) => ({ ...m, index: i + 1 }));
      setMeasures(reindexed);
      addToHistory(reindexed, gridConfig, markers);
      setSaveStatus('dirty');
  };

  const handleMeasureSelect = (index: number, isShift: boolean, isCtrl: boolean) => {
      let newIndices = [];
      if (isShift) {
          const lastSelected = selectedMeasureIndices.length > 0 
              ? selectedMeasureIndices[selectedMeasureIndices.length - 1] 
              : index;
          
          const start = Math.min(lastSelected, index);
          const end = Math.max(lastSelected, index);
          for(let i=start; i<=end; i++) newIndices.push(i);
          
          if (isCtrl) {
              const newSet = new Set([...selectedMeasureIndices, ...newIndices]);
              newIndices = Array.from(newSet);
          }
      } else if (isCtrl) {
          if (selectedMeasureIndices.includes(index)) {
              newIndices = selectedMeasureIndices.filter(i => i !== index);
          } else {
              newIndices = [...selectedMeasureIndices, index];
          }
      } else {
          newIndices = [index];
      }
      
      setSelectedMeasureIndices(newIndices);
      syncSelectionWithMeasures(newIndices);
  };

  const handleTranspose = (semitones: number) => {
      const transposeNote = (note: string, amount: number) => {
           let idx = NOTES_SHARP.indexOf(note);
           if (idx === -1) idx = NOTES_FLAT.indexOf(note);
           if (idx === -1) return note;

           let newIdx = (idx + amount + 12) % 12;
           const isFlat = note.includes('b');
           return isFlat ? NOTES_FLAT[newIdx] : NOTES_SHARP[newIdx];
      };

      const transposeChord = (chord: string, amount: number) => {
         return chord.replace(/([A-G][#b]?)/g, (match) => {
             return transposeNote(match, amount);
         });
      };
      
      const newMeasures = measures.map(m => {
          return {
              ...m,
              chords: transposeChord(m.chords, semitones)
          };
      });

      let newGridConfig = { ...gridConfig };
      const currentRoot = gridConfig.keySignature.replace('m', '');
      const isMinor = gridConfig.keySignature.endsWith('m');
      
      const newRoot = transposeNote(currentRoot, semitones);
      newGridConfig.keySignature = newRoot + (isMinor ? 'm' : '');

      setMeasures(newMeasures);
      setGridConfig(newGridConfig);
      addToHistory(newMeasures, newGridConfig, markers);
      setSaveStatus('dirty');
  };
  
  const handleUpdateMarkers = (newMarkers: Marker[]) => {
      setMarkers(newMarkers);
      addToHistory(measures, gridConfig, newMarkers);
      setSaveStatus('dirty');
  };

  return (
    <div className={`flex flex-col h-screen bg-slate-950 text-slate-200 overflow-hidden font-sans selection:bg-cyan-500/30 ${isCompactMode ? 'border-2 border-slate-800' : ''}`}>
      
      {/* 1. Top Row: Branding & Tabs */}
      {!isCompactMode && (
      <div className="flex h-11 bg-slate-950 border-b border-slate-800 shrink-0 select-none">
          {/* Branding */}
          <div className="flex items-center gap-2 px-4 border-r border-slate-800 bg-slate-950 min-w-fit">
            <div className="w-5 h-5 bg-gradient-to-br from-cyan-400 to-indigo-500 rounded flex items-center justify-center text-slate-900 font-bold text-[10px]">
                C
            </div>
            <h1 className="font-bold text-sm tracking-tight text-slate-200 hidden md:block">Cuchá</h1>
          </div>

          {/* Tabs Area */}
          <div className="flex-1 flex items-end px-2 gap-1 overflow-x-auto no-scrollbar">
              {projects.map(p => (
                  <div 
                    key={p.id}
                    onClick={() => handleSwitchProject(p.id)}
                    className={`group flex items-center gap-2 px-3 py-1.5 rounded-t-lg text-xs font-bold border-t border-r border-l cursor-pointer min-w-[120px] max-w-[200px] select-none transition-all relative -mb-px h-8 ${
                        activeProjectId === p.id 
                        ? 'bg-slate-900 border-slate-700 text-cyan-400 z-10' 
                        : 'bg-slate-950 border-transparent text-slate-500 hover:bg-slate-900 hover:text-slate-300'
                    }`}
                  >
                      <span className="truncate flex-1">{p.name}</span>
                      <button 
                        onClick={(e) => handleCloseProject(e, p.id)}
                        className="flex-shrink-0 w-5 h-5 -mr-1 flex items-center justify-center rounded-full hover:bg-slate-800 hover:text-red-400 text-slate-600 transition-colors z-20 cursor-pointer pointer-events-auto opacity-0 group-hover:opacity-100"
                        title="Cerrar Proyecto"
                      >
                          <svg className="pointer-events-none" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                      </button>
                  </div>
              ))}
              <button 
                onClick={() => setShowNewProjectModal(true)}
                className="flex items-center justify-center w-8 h-8 rounded-t hover:bg-slate-900 text-slate-500 hover:text-cyan-400 transition-colors"
                title="Nuevo Proyecto"
              >
                  +
              </button>
          </div>
      </div>
      )}

      {/* 2. Project Toolbar */}
      {!isCompactMode && activeProjectId && (
      <div className="h-14 bg-slate-900 border-b border-slate-800 flex items-center px-4 justify-between shrink-0 gap-4 select-none shadow-sm z-20">
          {/* Left: Project Actions (Save, Audio, XML) */}
          <div className="flex items-center gap-3 overflow-x-auto no-scrollbar">
             
             {/* Save & Status */}
             <div className="flex items-center gap-2 mr-2">
                 <button 
                    onClick={handleDownloadProject} 
                    className="group flex items-center gap-2 px-3 py-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded transition-colors shadow-lg shadow-emerald-900/20 border border-emerald-500/50"
                    title="Descargar Proyecto (JSON)"
                 >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    <span>Guardar proyecto</span>
                 </button>
                 
                 {/* Status Indicator */}
                 <div 
                    title={saveStatus === 'saved' ? 'Todo guardado' : saveStatus === 'saving' ? 'Guardando...' : 'Cambios sin guardar'} 
                    className={`w-2 h-2 rounded-full transition-colors ${saveStatus === 'saved' ? 'bg-emerald-500' : saveStatus === 'saving' ? 'bg-amber-500 animate-pulse' : 'bg-slate-600'}`}
                 ></div>
             </div>
             
             <div className="h-6 w-[1px] bg-slate-800 shrink-0"></div>

             {/* Audio & XML Inputs */}
             <div className="flex items-center gap-1">
                <button 
                    onClick={() => fileInputRef.current?.click()} 
                    className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 hover:text-cyan-400 rounded border border-slate-700 transition-colors"
                    title="Cambiar archivo de audio"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                    <span className="whitespace-nowrap">Cambiar audio</span>
                </button>
                <input ref={fileInputRef} type="file" accept="audio/*" onChange={handleFileUpload} className="hidden" />

                {/* Load XML */}
                <button 
                    onClick={() => xmlInputRef.current?.click()} 
                    className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 hover:text-orange-400 rounded border border-slate-700 transition-colors"
                    title="Importar información de partitura desde MusicXML"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 15v4c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2v-4M17 9l-5 5-5-5M12 12.8V2.5"/></svg>
                    <span className="whitespace-nowrap">Importar información de partitura (MusicXML)</span>
                </button>
                <input ref={xmlInputRef} type="file" accept=".musicxml,.xml" onChange={handleLoadXML} className="hidden" />

                <button 
                    onClick={handleExportXML} 
                    disabled={!audioState.isLoaded} 
                    className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 hover:text-indigo-400 rounded border border-slate-700 transition-colors disabled:opacity-50"
                    title="Exportar a MusicXML"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                    <span className="whitespace-nowrap">Guardar partitura (MusicXML)</span>
                </button>
             </div>
          </div>

          {/* Right: View & Tools */}
          <div className="flex items-center gap-3 ml-auto">
             {/* Undo Redo */}
             <div className="flex bg-slate-800 rounded border border-slate-700">
                 <button onClick={undo} disabled={historyIndex <= 0} className="p-1.5 text-slate-400 hover:text-white disabled:opacity-30 border-r border-slate-700"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg></button>
                 <button onClick={redo} disabled={historyIndex >= history.length - 1} className="p-1.5 text-slate-400 hover:text-white disabled:opacity-30"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/></svg></button>
             </div>
             
             {/* Tuner */}
             <button 
                onClick={() => setShowTuner(true)}
                className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 hover:text-cyan-400 rounded border border-slate-700 transition-colors"
             >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M2 12h20M4.93 4.93l14.14 14.14M4.93 19.07l14.14-14.14"/></svg>
                <span className="hidden lg:inline">Afinador</span>
             </button>

             <div className="h-6 w-[1px] bg-slate-800"></div>

             {/* Window Controls */}
             <div className="flex gap-1">
                 <button onClick={toggleCompactMode} className="p-1.5 text-slate-500 hover:text-white transition-colors" title="Modo Compacto">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>
                 </button>
                 <button onClick={toggleFullscreen} className="p-1.5 text-slate-500 hover:text-white transition-colors" title="Pantalla Completa">
                    {isFullscreen ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>
                    ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
                    )}
                 </button>
             </div>
          </div>
      </div>
      )}

      {/* Floating Restore Button for Compact Mode */}
      {isCompactMode && (
          <button 
            onClick={toggleCompactMode}
            className="absolute top-2 right-2 z-50 p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 shadow-lg"
            title="Salir de Modo Compacto"
          >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
          </button>
      )}

      {/* Main Content Area */}
      {audioState.isLoaded ? (
         <>
            {/* Waveform Timeline */}
            <div className="shrink-0 z-10">
                <WaveformTimeline 
                    buffer={audioState.buffer}
                    measures={measures}
                    markers={markers}
                    gridConfig={gridConfig}
                    currentTime={audioState.currentTime}
                    duration={audioState.duration}
                    selection={selection}
                    onConfigChange={(newConf) => { setGridConfig(newConf); handleCommitChanges(); }}
                    onMeasureDurationChange={handleMeasureDurationChange}
                    onCommitChanges={handleCommitChanges}
                    onSeek={handleSeek}
                    onPlayRegion={handlePlayRegion}
                    autoScroll={autoScroll}
                    onUpdateMarkers={handleUpdateMarkers}
                    onUpdateSelection={handleUpdateSelection}
                />
            </div>

            {/* Main Workspace (Grid) */}
            <div className="flex-1 overflow-hidden relative">
                <MeasureGrid 
                    measures={measures} 
                    selectedMeasureIndices={selectedMeasureIndices}
                    gridConfig={gridConfig}
                    audioState={audioState}
                    onConfigChange={setGridConfig}
                    onMeasureUpdate={handleMeasureUpdate}
                    onMeasureDurationChange={handleMeasureDurationChange}
                    onMeasureSelect={handleMeasureSelect}
                    onCommitChanges={handleCommitChanges}
                    onSeek={handleSeek}
                    onAddMeasures={handleAddMeasures}
                    onPlayRegion={handlePlayRegion}
                    onDeleteMeasure={handleDeleteMeasure}
                    onInsertMeasure={handleInsertMeasure}
                    onDuplicateSelection={handleDuplicateSelection}
                    autoScroll={autoScroll}
                    onToggleAutoScroll={() => setAutoScroll(!autoScroll)}
                    onTranspose={handleTranspose}
                />
            </div>

            {/* Bottom Controls */}
            <div className="shrink-0 bg-slate-900 border-t border-slate-800 z-30">
                <Controls 
                    params={params} 
                    audioState={audioState} 
                    onParamChange={handleParamChange} 
                    onTogglePlay={togglePlay}
                    onSeek={handleSeek}
                    onJump={(delta) => handleSeek(audioState.currentTime + delta)}
                />
            </div>
         </>
      ) : (
        <div 
            className={`flex-1 flex flex-col items-center justify-center p-8 text-slate-500 transition-all w-full h-full ${isDragging ? 'bg-slate-800/80 border-4 border-cyan-500/50 border-dashed' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
             {/* Only show Drop Zone if we have a project but no audio */}
             {activeProjectId && (
                 <>
                    <div className="w-24 h-24 mb-6 rounded-full bg-slate-900 border-2 border-dashed border-slate-700 flex items-center justify-center pointer-events-none">
                        <svg className="w-10 h-10 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/></svg>
                    </div>
                    
                    {loadingState === LoadingState.PROCESSING ? (
                        <div className="flex flex-col items-center">
                            <div className="w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                            <p className="text-lg font-medium text-cyan-400 animate-pulse">{statusMessage}</p>
                        </div>
                    ) : (
                        <>
                            <p className="text-lg font-medium text-slate-400 mb-2 pointer-events-none">Falta el Audio</p>
                            <p className="text-sm mb-6 pointer-events-none text-center max-w-sm">Arrastra y suelta el archivo de audio para este proyecto.</p>
                            <button onClick={() => fileInputRef.current?.click()} className="px-6 py-3 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-lg shadow-lg shadow-cyan-600/20 transition-all transform hover:scale-105 z-10">
                                Seleccionar Archivo
                            </button>
                        </>
                    )}
                 </>
             )}
        </div>
      )}

      {/* Overlays */}
      {showTuner && <GuitarTuner onClose={() => setShowTuner(false)} />}
      
      {/* Confirmation Modal */}
      {confirmationModal && (
        <ConfirmationModal 
            isOpen={confirmationModal.isOpen} 
            message={confirmationModal.message} 
            onConfirm={confirmationModal.onConfirm} 
            onCancel={confirmationModal.onCancel} 
        />
      )}

      {/* Alert Modal */}
      {alertModal && (
          <AlertModal
            isOpen={alertModal.isOpen}
            message={alertModal.message}
            onClose={alertModal.onClose}
          />
      )}

      {/* NEW PROJECT MODAL */}
      {showNewProjectModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-md">
              <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-8 w-full max-w-lg">
                  <div className="flex justify-between items-center mb-8">
                      <div className="flex flex-col">
                          <h2 className="text-2xl font-bold text-white tracking-tight">Cuchá</h2>
                          <p className="text-slate-500 text-sm">Espacio de trabajo para transcripción musical</p>
                      </div>
                      {/* Allow closing ONLY if there are projects already */}
                      {projects.length > 0 && (
                          <button onClick={() => setShowNewProjectModal(false)} className="text-slate-500 hover:text-white">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                          </button>
                      )}
                  </div>
                  
                  <div className="grid grid-cols-2 gap-6">
                      <button 
                        onClick={createBlankProject}
                        className="flex flex-col items-center justify-center p-8 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-cyan-500/50 rounded-xl transition-all group shadow-lg"
                      >
                          <div className="w-12 h-12 mb-4 bg-slate-900 rounded-full flex items-center justify-center group-hover:bg-cyan-900/30 transition-colors">
                              <span className="text-2xl font-bold text-cyan-500">+</span>
                          </div>
                          <span className="font-bold text-lg text-slate-200">Nuevo Proyecto</span>
                          <span className="text-xs text-slate-500 mt-2">Lienzo en blanco</span>
                      </button>

                      <button 
                        onClick={() => jsonInputRef.current?.click()}
                        className="flex flex-col items-center justify-center p-8 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-indigo-500/50 rounded-xl transition-all group shadow-lg"
                      >
                           <div className="w-12 h-12 mb-4 bg-slate-900 rounded-full flex items-center justify-center group-hover:bg-indigo-900/30 transition-colors">
                              <svg width="24" height="24" className="text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                          </div>
                          <span className="font-bold text-lg text-slate-200">Abrir Proyecto</span>
                          <span className="text-xs text-slate-500 mt-2">Cargar archivo .JSON</span>
                      </button>
                      
                      {/* Hidden Input for Modal Action */}
                      <input ref={jsonInputRef} type="file" accept=".json" onChange={handleImportProjectJSON} className="hidden" />
                  </div>
              </div>
          </div>
      )}

    </div>
  );
};

export default App;
