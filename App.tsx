

import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as Tone from 'tone';
import { Controls } from './components/Controls';
import { MeasureGrid } from './components/MeasureGrid';
import { GuitarTuner } from './components/GuitarTuner';
import { AudioState, LoadingState, ProcessingParams, LoopState, Measure, GridConfig, Marker, RegionSelection, ProjectMeta } from './types';
import { GRAIN_SIZE, OVERLAP } from './constants';
import { WaveformTimeline } from './components/WaveformTimeline';
import { saveAudioToDB, loadAudioFromDB, saveStateToDB, loadStateFromDB, clearDB, getProjects, saveProjectMeta, deleteProject } from './utils/storage';

type GrainPlayerType = Tone.GrainPlayer;

interface HistoryState {
    measures: Measure[];
    gridConfig: GridConfig;
    markers: Marker[];
}

const NOTES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTES_FLAT  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// Helper to convert circle of fifths to key string
const fifthsToKey = (fifths: number, mode: string = 'major'): string => {
    // Circle of fifths map for Major keys
    const majorKeys: {[key: number]: string} = {
        0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#',
        [-1]: 'F', [-2]: 'Bb', [-3]: 'Eb', [-4]: 'Ab', [-5]: 'Db', [-6]: 'Gb', [-7]: 'Cb'
    };

    let key = majorKeys[fifths] || 'C';
    
    // If minor mode, convert relative major to minor
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
  
  // Projects System
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

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
    eqHigh: 0,
    metronomeVolume: -10
  });

  const [loopState, setLoopState] = useState<LoopState>({
    active: false,
    start: null,
    end: null
  });

  const [selection, setSelection] = useState<RegionSelection>({
    active: false,
    start: 0,
    end: 0
  });

  const [selectedMeasureIndices, setSelectedMeasureIndices] = useState<number[]>([]);

  const [isMetronomeOn, setIsMetronomeOn] = useState(false);
  const [showTuner, setShowTuner] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isCompactMode, setIsCompactMode] = useState(false);
  const [restoring, setRestoring] = useState(true);

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
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Helpers ---
  const getStandardDuration = useCallback(() => {
    let multiplier = 1;
    if (gridConfig.beatUnit === 'eighth') multiplier = 0.5;
    if (gridConfig.beatUnit === 'dotted-quarter') multiplier = 1.5;

    const beats = gridConfig.tsTop * (4 / gridConfig.tsBottom);
    return (beats * 60) / (gridConfig.bpm * (1/multiplier)); // Inverse because duration depends on pulse time
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
        setLoopState({ active: true, start, end });
        setAudioState(prev => ({ ...prev, currentTime: start }));
    }
  }, [measures, gridConfig, getStandardDuration]);


  // --- Audio Initialization ---
  const initAudio = async (buffer: Tone.ToneAudioBuffer) => {
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
    
    const eq = new Tone.EQ3(params.eqLow, params.eqMid, params.eqHigh);
    const analyser = new Tone.Waveform(256);
    analyserRef.current = analyser;

    player.chain(eq, analyser, Tone.Destination);

    playerRef.current = player;
    eqRef.current = eq;

    player.playbackRate = params.speed;
    player.detune = params.pitch * 100;
    player.volume.value = params.volume;

    Tone.Transport.bpm.value = gridConfig.bpm;

    setAudioState(prev => ({
      ...prev,
      isLoaded: true,
      duration: buffer.duration,
      buffer: buffer
    }));
    
    setLoadingState(LoadingState.READY);
  };

  // --- Persistence & Multi-Project Logic ---

  // 1. Initial Load of Projects List
  useEffect(() => {
      const loadProjectsList = async () => {
          try {
              const list = await getProjects();
              setProjects(list);
              
              if (list.length > 0) {
                  // Load the most recently opened project
                  setActiveProjectId(list[0].id);
              } else {
                  // Create a default new project
                  handleCreateProject();
              }
          } catch (err) {
              console.error("Failed to load projects", err);
              // Fallback default
              handleCreateProject();
          }
      };
      loadProjectsList();
  }, []);

  // 2. Load Project Content when ID changes
  useEffect(() => {
    if (!activeProjectId) return;

    const restoreSession = async () => {
      try {
        // Cleanup previous audio context if needed
        if (playerRef.current) {
             playerRef.current.stop();
             // We don't dispose context, just the nodes usually, but initAudio handles replacement
        }
        
        setRestoring(true);
        setStatusMessage('Cargando proyecto...');
        setLoadingState(LoadingState.PROCESSING);

        // Reset memory state before loading
        setMeasures([]);
        setMarkers([]);
        setAudioState(prev => ({ ...prev, isLoaded: false, buffer: null, url: null }));

        // A. Restore Audio
        const savedAudio = await loadAudioFromDB(activeProjectId);
        
        // B. Restore State
        const savedState = await loadStateFromDB(activeProjectId);

        if (savedState) {
          setMeasures(savedState.measures);
          setGridConfig(savedState.gridConfig);
          setMarkers(savedState.markers);
          setParams(savedState.params);
          setHistory([{
            measures: savedState.measures,
            gridConfig: savedState.gridConfig,
            markers: savedState.markers
          }]);
          setHistoryIndex(0);
        } else {
            // New project default state
             setGridConfig({
                bpm: 120, tsTop: 4, tsBottom: 4, keySignature: 'C', offset: 0, beatUnit: 'quarter'
            });
            setParams({
                speed: 1.0, pitch: 0, volume: -5, eqLow: 0, eqMid: 0, eqHigh: 0, metronomeVolume: -10
            });
            setHistory([]);
            setHistoryIndex(-1);
        }

        if (savedAudio) {
           await processFile(savedAudio.blob, savedAudio.fileName, false); 
        } else {
           setLoadingState(LoadingState.IDLE);
           setStatusMessage('');
        }

        // Update Last Opened
        const project = projects.find(p => p.id === activeProjectId);
        if (project) {
            await saveProjectMeta({ ...project, lastOpened: Date.now() });
        }

      } catch (err) {
        console.error("Failed to restore session", err);
        setLoadingState(LoadingState.IDLE);
      } finally {
        setRestoring(false);
      }
    };

    restoreSession();
  }, [activeProjectId]);

  // 3. Auto-Save Effect
  useEffect(() => {
    if (restoring || !activeProjectId) return;
    if (loadingState !== LoadingState.READY && loadingState !== LoadingState.IDLE) return;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    setSaveStatus('dirty');

    saveTimeoutRef.current = setTimeout(async () => {
       setSaveStatus('saving');
       try {
         await saveStateToDB({
           measures,
           gridConfig,
           markers,
           params,
           fileName: audioState.fileName,
           timestamp: Date.now()
         }, activeProjectId);
         setSaveStatus('saved');
       } catch (err) {
         console.error("Auto-save failed", err);
       }
    }, 2000); 

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };

  }, [measures, gridConfig, markers, params, audioState.fileName, restoring, loadingState, activeProjectId]);


  // --- Project Management Functions ---

  const handleCreateProject = async () => {
      const newId = crypto.randomUUID();
      const newProject: ProjectMeta = {
          id: newId,
          name: 'Nuevo Proyecto',
          lastOpened: Date.now()
      };
      
      await saveProjectMeta(newProject);
      setProjects(prev => [newProject, ...prev]);
      setActiveProjectId(newId);
  };

  const handleCloseProject = async (e: React.MouseEvent, projectId: string) => {
      e.stopPropagation(); // Don't switch to tab when clicking X
      if (confirm('¿Cerrar y eliminar este proyecto permanentemente?')) {
          await deleteProject(projectId);
          const newProjects = projects.filter(p => p.id !== projectId);
          setProjects(newProjects);
          
          if (activeProjectId === projectId) {
              if (newProjects.length > 0) {
                  setActiveProjectId(newProjects[0].id);
              } else {
                  handleCreateProject();
              }
          }
      }
  };

  const updateProjectName = async (name: string) => {
      if (!activeProjectId) return;
      const updatedProjects = projects.map(p => 
          p.id === activeProjectId ? { ...p, name: name } : p
      );
      setProjects(updatedProjects);
      
      const current = updatedProjects.find(p => p.id === activeProjectId);
      if (current) await saveProjectMeta(current);
  };


  // --- File Handling ---
  const processFile = async (file: File | Blob, fileName?: string, shouldSaveToDB: boolean = true) => {
    setLoadingState(LoadingState.PROCESSING);
    setStatusMessage('Decodificando audio...');

    try {
      const arrayBuffer = await file.arrayBuffer();
      // Ensure context is running/exists
      if (Tone.getContext().state === 'suspended') {
          await Tone.getContext().resume();
      }
      const audioContext = Tone.getContext().rawContext;
      const decodedBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const toneBuffer = new Tone.ToneAudioBuffer(decodedBuffer);
      
      await initAudio(toneBuffer);
      
      const name = fileName || (file as File).name || 'Audio Importado';

      setAudioState(prev => ({
        ...prev,
        fileName: name,
        url: URL.createObjectURL(file)
      }));

      // Update Project Name if it was generic
      if (activeProjectId) {
          const currentProj = projects.find(p => p.id === activeProjectId);
          if (currentProj && (currentProj.name === 'Nuevo Proyecto' || shouldSaveToDB)) {
              updateProjectName(name);
          }
      }

      if (measures.length === 0) {
           initializeMeasures(toneBuffer.duration, gridConfig.bpm, gridConfig.tsTop, gridConfig.tsBottom);
      }

      if (shouldSaveToDB && activeProjectId) {
        setStatusMessage('Guardando en caché...');
        await saveAudioToDB(file, name, activeProjectId);
        setStatusMessage('');
      }

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
  };

  // --- Playback Controls ---
  const togglePlay = useCallback(async () => {
    if (!playerRef.current) return;

    if (Tone.getContext().state !== 'running') {
      await Tone.start();
    }

    if (audioState.isPlaying) {
      playerRef.current.stop();
      Tone.Transport.stop();
      setAudioState(prev => ({ ...prev, isPlaying: false }));
    } else {
      if (loopState.active && loopState.start !== null && loopState.end !== null) {
          playerRef.current.loop = true;
          playerRef.current.loopStart = loopState.start;
          playerRef.current.loopEnd = loopState.end;
          
          if (audioState.currentTime < loopState.start || audioState.currentTime > loopState.end) {
               playerRef.current.start(undefined, loopState.start);
          } else {
               playerRef.current.start(undefined, audioState.currentTime);
          }
      } else {
          playerRef.current.loop = false;
          playerRef.current.start(undefined, audioState.currentTime);
      }
      
      if (isMetronomeOn) Tone.Transport.start();
      setAudioState(prev => ({ ...prev, isPlaying: true }));
    }
  }, [audioState.isPlaying, audioState.currentTime, loopState, isMetronomeOn]);

  const handleSeek = (time: number) => {
    const newTime = Math.max(0, Math.min(time, audioState.duration));
    
    if (playerRef.current && audioState.isPlaying) {
        playerRef.current.stop();
        playerRef.current.start(undefined, newTime);
    }
    
    setAudioState(prev => ({ ...prev, currentTime: newTime }));
  };

  const handlePlayRegion = (start: number, duration: number) => {
      if (!playerRef.current) return;
      if (Tone.getContext().state !== 'running') Tone.start();

      playerRef.current.stop();
      playerRef.current.loop = false;
      playerRef.current.start(undefined, start, duration);
      
      setLoopState({ active: true, start: start, end: start + duration });
      setSelection({ active: true, start: start, end: start + duration });
      setAudioState(prev => ({ ...prev, isPlaying: true, currentTime: start }));
      
      if (isMetronomeOn) Tone.Transport.start();
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
          setLoopState({ active: true, start, end });
          setAudioState(prev => ({ ...prev, currentTime: start }));
      }

  }, [measures, selectedMeasureIndices, gridConfig, markers, history, historyIndex, getStandardDuration]);


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
  }, [togglePlay, selectedMeasureIndices, measures, gridConfig, handleDuplicateSelection, syncSelectionWithMeasures, undo, redo]);

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

  // --- Metronome Logic ---
  const metronomeSynth = useRef<Tone.PolySynth | null>(null);
  const metronomeLoop = useRef<Tone.Sequence | null>(null);

  useEffect(() => {
      metronomeSynth.current = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: "triangle" }, 
          envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.1 }
      }).toDestination();
      
      metronomeSynth.current.volume.value = params.metronomeVolume;
      
      return () => {
          metronomeSynth.current?.dispose();
          metronomeLoop.current?.dispose();
      };
  }, []);

  useEffect(() => {
      if (metronomeSynth.current) {
          metronomeSynth.current.volume.value = params.metronomeVolume;
      }
  }, [params.metronomeVolume]);

  useEffect(() => {
      // Internal BPM adjustment based on beat unit
      let internalBpm = gridConfig.bpm;
      if (gridConfig.beatUnit === 'eighth') internalBpm = internalBpm / 2;
      if (gridConfig.beatUnit === 'dotted-quarter') internalBpm = internalBpm * 1.5;

      Tone.Transport.bpm.value = internalBpm;
      Tone.Transport.timeSignature = gridConfig.tsTop;
  }, [gridConfig.bpm, gridConfig.tsTop, gridConfig.beatUnit]);

  useEffect(() => {
      if (metronomeLoop.current) {
          metronomeLoop.current.dispose();
          metronomeLoop.current = null;
      }

      if (isMetronomeOn) {
          const accents = [];
          for(let i=0; i<gridConfig.tsTop; i++) {
              accents.push(i === 0 ? "G5" : "C5"); 
          }
          const subdivision = gridConfig.tsBottom === 8 ? "8n" : "4n";

          metronomeLoop.current = new Tone.Sequence((time, note) => {
             metronomeSynth.current?.triggerAttackRelease(note, "32n", time);
          }, accents, subdivision);
          
          metronomeLoop.current.start(gridConfig.offset);

          if (audioState.isPlaying) Tone.Transport.start();

      } else {
          if (!audioState.isPlaying) Tone.Transport.stop(); 
      }
  }, [isMetronomeOn, gridConfig.tsTop, gridConfig.tsBottom, gridConfig.offset, audioState.isPlaying]);


  // --- Update Loop (Animation Frame) ---
  useEffect(() => {
    let rafId: number;

    const updateLoop = () => {
      if (playerRef.current && audioState.isLoaded) {
        if (audioState.isPlaying) {
             setAudioState(prev => {
                 let nextTime = prev.currentTime + (0.016 * params.speed); 
                 
                 if (loopState.active && loopState.end && nextTime >= loopState.end) {
                     nextTime = loopState.start || 0;
                 }
                 
                 if (!loopState.active && selection.active && selection.end > selection.start) {
                     if (nextTime >= selection.end) {
                         if (playerRef.current) playerRef.current.stop();
                         Tone.Transport.stop();
                         return { ...prev, isPlaying: false, currentTime: selection.start }; 
                     }
                 }

                 if (nextTime > prev.duration) {
                     nextTime = prev.duration; 
                 }
                 return { ...prev, currentTime: nextTime };
             });
        }
      }
      rafId = requestAnimationFrame(updateLoop);
    };

    rafId = requestAnimationFrame(updateLoop);
    return () => cancelAnimationFrame(rafId);
  }, [audioState.isLoaded, audioState.isPlaying, params.speed, loopState, selection]);


  // --- Param Changes ---
  const handleParamChange = (key: keyof ProcessingParams, value: number) => {
    setParams(prev => ({ ...prev, [key]: value }));
    
    if (!playerRef.current || !eqRef.current) return;

    if (key === 'speed') playerRef.current.playbackRate = value;
    if (key === 'pitch') playerRef.current.detune = value * 100;
    if (key === 'volume') playerRef.current.volume.value = value;
    
    if (key === 'eqLow') eqRef.current.low.value = value;
    if (key === 'eqMid') eqRef.current.mid.value = value;
    if (key === 'eqHigh') eqRef.current.high.value = value;
  };

  const handleSetLoop = (type: 'start' | 'end' | 'clear' | 'toggle') => {
      setLoopState(prev => {
          let newState = { ...prev };
          if (type === 'start') newState.start = audioState.currentTime;
          if (type === 'end') newState.end = audioState.currentTime;
          if (type === 'clear') { newState.start = null; newState.end = null; newState.active = false; }
          if (type === 'toggle') newState.active = !newState.active;
          
          if (newState.start !== null && newState.end !== null && newState.start > newState.end) {
              const temp = newState.start;
              newState.start = newState.end;
              newState.end = temp;
          }
          
          if (playerRef.current) {
              playerRef.current.loop = newState.active;
              if (newState.start !== null) playerRef.current.loopStart = newState.start;
              if (newState.end !== null) playerRef.current.loopEnd = newState.end;
          }

          if (newState.start !== null && newState.end !== null) {
              setSelection({ active: newState.active, start: newState.start, end: newState.end });
          } else {
              setSelection(prevSel => ({ ...prevSel, active: false }));
          }

          return newState;
      });
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
  };

  const handleMeasureDurationChange = (index: number, newDuration: number) => {
      const newMeasures = measures.map(m => {
          if (m.index === index) {
              return { ...m, duration: newDuration > 0 ? newDuration : undefined };
          }
          return m;
      });
      setMeasures(newMeasures);
  };
  
  const handleAddMeasures = () => {
      const lastIndex = measures.length > 0 ? measures[measures.length-1].index : 0;
      const newMeasures = [...measures];
      for(let i=1; i<=4; i++) {
          newMeasures.push({ index: lastIndex + i, chords: '', lyrics: '' });
      }
      setMeasures(newMeasures);
      addToHistory(newMeasures, gridConfig, markers);
  };
  
  const handleDeleteMeasure = (index: number) => {
      const newMeasures = measures.filter(m => m.index !== index)
          .map((m, i) => ({ ...m, index: i + 1 })); 
      setMeasures(newMeasures);
      setSelectedMeasureIndices(prev => prev.filter(i => i !== index));
      addToHistory(newMeasures, gridConfig, markers);
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
          if (selectedMeasureIndices.length > 0 && !selectedMeasureIndices.includes(m.index)) {
              return m;
          }
          return {
              ...m,
              chords: transposeChord(m.chords, semitones)
          };
      });

      let newGridConfig = { ...gridConfig };
      if (selectedMeasureIndices.length === 0 || selectedMeasureIndices.length === measures.length) {
          const currentRoot = gridConfig.keySignature.replace('m', '');
          const isMinor = gridConfig.keySignature.endsWith('m');
          
          const newRoot = transposeNote(currentRoot, semitones);
          newGridConfig.keySignature = newRoot + (isMinor ? 'm' : '');
      }

      setMeasures(newMeasures);
      setGridConfig(newGridConfig);
      addToHistory(newMeasures, newGridConfig, markers);
  };

  const saveProject = () => {
      const projectData = {
          fileName: audioState.fileName,
          gridConfig,
          measures,
          measuresMarkers: markers // Backup prop
      };
      const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${audioState.fileName || 'escuchame'}-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
  };

  const loadProject = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = (ev) => {
          try {
              const data = JSON.parse(ev.target?.result as string);
              if (data.gridConfig) setGridConfig(data.gridConfig);
              if (data.measures) setMeasures(data.measures);
              if (data.markers || data.measuresMarkers) setMarkers(data.markers || data.measuresMarkers);
              addToHistory(data.measures || [], data.gridConfig || gridConfig, data.markers || []);
          } catch(err) {
              alert('Error al leer archivo de proyecto');
          }
      };
      reader.readAsText(file);
  };
  
  const handleUpdateMarkers = (newMarkers: Marker[]) => {
      setMarkers(newMarkers);
      addToHistory(measures, gridConfig, newMarkers);
  };

  const handleUpdateSelection = (sel: RegionSelection) => {
      setSelection(sel);
      if (sel.active) {
          setLoopState({
              active: true,
              start: sel.start,
              end: sel.end
          });
      }
  };

  return (
    <div className={`flex flex-col h-screen bg-slate-950 text-slate-200 overflow-hidden font-sans selection:bg-cyan-500/30 ${isCompactMode ? 'border-2 border-slate-800' : ''}`}>
      
      {/* Tab Bar - New */}
      {!isCompactMode && (
      <div className="flex items-center bg-slate-950 border-b border-slate-800 px-2 pt-2 gap-1 overflow-x-auto no-scrollbar">
          {projects.map(p => (
              <div 
                key={p.id}
                onClick={() => setActiveProjectId(p.id)}
                className={`group flex items-center gap-2 px-3 py-1.5 rounded-t-lg text-xs font-bold border-t border-r border-l cursor-pointer min-w-[120px] max-w-[200px] select-none transition-colors ${
                    activeProjectId === p.id 
                    ? 'bg-slate-900 border-slate-700 text-cyan-400 z-10' 
                    : 'bg-slate-900/40 border-slate-800 text-slate-500 hover:bg-slate-900/60 hover:text-slate-400'
                }`}
              >
                  <span className="truncate flex-1">{p.name}</span>
                  <button 
                    onClick={(e) => handleCloseProject(e, p.id)}
                    className="opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-slate-800 rounded p-0.5 transition-all"
                    title="Cerrar Pestaña"
                  >
                      ×
                  </button>
              </div>
          ))}
          <button 
            onClick={handleCreateProject}
            className="flex items-center justify-center w-8 h-8 rounded hover:bg-slate-800 text-slate-500 hover:text-cyan-400 transition-colors"
            title="Nuevo Proyecto"
          >
              +
          </button>
      </div>
      )}

      {/* Header - Hidden in Compact Mode */}
      {!isCompactMode && (
      <header className="flex items-center justify-between px-6 py-2 bg-slate-900 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-cyan-400 to-indigo-500 rounded-lg flex items-center justify-center text-slate-900 font-bold text-lg">
                E
            </div>
            <h1 className="font-bold text-lg tracking-tight text-slate-100 hidden md:block">Escuchame</h1>
            
            {audioState.isLoaded && (
                <div className="ml-2 px-2 py-0.5 rounded text-[10px] font-mono tracking-wider flex items-center gap-1.5 transition-colors duration-500">
                    {saveStatus === 'saving' && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>}
                    {saveStatus === 'saved' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>}
                    {saveStatus === 'dirty' && <span className="w-1.5 h-1.5 rounded-full bg-slate-500"></span>}
                    <span className="text-slate-500">
                        {saveStatus === 'saving' ? 'GUARDANDO...' : saveStatus === 'saved' ? 'GUARDADO' : 'MODIFICADO'}
                    </span>
                </div>
            )}
        </div>

        <div className="flex items-center gap-4">
             {loadingState === LoadingState.PROCESSING && (
                 <span className="text-xs text-cyan-400 animate-pulse">{statusMessage}</span>
             )}
             
             <div className="flex gap-2">
                 <button onClick={() => fileInputRef.current?.click()} className="px-3 py-1.5 text-xs font-bold bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded transition-colors text-slate-300">
                    ABRIR AUDIO
                 </button>
                 <input ref={fileInputRef} type="file" accept="audio/*" onChange={handleFileUpload} className="hidden" />

                 <button onClick={() => jsonInputRef.current?.click()} className="px-3 py-1.5 text-xs font-bold bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded transition-colors text-slate-300">
                    CARGAR JSON
                 </button>
                 <input ref={jsonInputRef} type="file" accept=".json" onChange={loadProject} className="hidden" />

                 <button onClick={saveProject} className="px-3 py-1.5 text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-colors shadow-lg shadow-indigo-500/20">
                    EXPORTAR JSON
                 </button>
             </div>
             
             <div className="h-6 w-[1px] bg-slate-800"></div>

             <div className="flex gap-1">
                 <button onClick={undo} disabled={historyIndex <= 0} className="p-1.5 text-slate-400 hover:text-white disabled:opacity-30"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg></button>
                 <button onClick={redo} disabled={historyIndex >= history.length - 1} className="p-1.5 text-slate-400 hover:text-white disabled:opacity-30"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/></svg></button>
             </div>

             <button 
                onClick={() => setShowTuner(true)}
                className="p-2 text-slate-400 hover:text-cyan-400 transition-colors"
                title="Afinador"
             >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M2 12h20M4.93 4.93l14.14 14.14M4.93 19.07l14.14-14.14"/></svg>
             </button>

             <button 
                onClick={toggleCompactMode}
                className="p-2 text-slate-400 hover:text-white transition-colors"
                title="Modo Ventana Flotante / Compacto"
             >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>
             </button>

             <button 
                onClick={toggleFullscreen}
                className="p-2 text-slate-400 hover:text-white transition-colors"
                title={isFullscreen ? "Salir de Pantalla Completa" : "Pantalla Completa"}
             >
                {isFullscreen ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>
                ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
                )}
             </button>
        </div>
      </header>
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
                    onToggleMetronome={() => setIsMetronomeOn(!isMetronomeOn)}
                    isMetronomeOn={isMetronomeOn}
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
                    loopState={loopState}
                    onParamChange={handleParamChange} 
                    onTogglePlay={togglePlay}
                    onSeek={handleSeek}
                    onJump={(delta) => handleSeek(audioState.currentTime + delta)}
                    onSetLoop={handleSetLoop}
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
                    <p className="text-lg font-medium text-slate-400 mb-2 pointer-events-none">Comienza tu transcripción</p>
                    <p className="text-sm mb-6 pointer-events-none text-center max-w-sm">Arrastra y suelta un archivo aquí para este proyecto.</p>
                    <button onClick={() => fileInputRef.current?.click()} className="px-6 py-3 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-lg shadow-lg shadow-cyan-600/20 transition-all transform hover:scale-105 z-10">
                        Seleccionar Archivo de Audio
                    </button>
                 </>
             )}
        </div>
      )}

      {/* Overlays */}
      {showTuner && <GuitarTuner onClose={() => setShowTuner(false)} />}
      
    </div>
  );
};

export default App;
