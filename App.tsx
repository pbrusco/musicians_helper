
import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as Tone from 'tone';
import { Controls } from './components/Controls';
import { Visualizer } from './components/Visualizer';
import { MeasureGrid } from './components/MeasureGrid';
import { GuitarTuner } from './components/GuitarTuner';
import { AudioState, LoadingState, ProcessingParams, LoopState, Measure, GridConfig } from './types';
import { GRAIN_SIZE, OVERLAP } from './constants';

type GrainPlayerType = Tone.GrainPlayer;

interface HistoryState {
    measures: Measure[];
    gridConfig: GridConfig;
}

const App: React.FC = () => {
  // --- State ---
  const [loadingState, setLoadingState] = useState<LoadingState>(LoadingState.IDLE);
  const [statusMessage, setStatusMessage] = useState('');
  
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

  const [isMetronomeOn, setIsMetronomeOn] = useState(false);
  const [showTuner, setShowTuner] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);

  // -- Composition (Grid) Data --
  const [gridConfig, setGridConfig] = useState<GridConfig>({
    bpm: 120,
    tsTop: 4,
    tsBottom: 4,
    offset: 0
  });
  const [measures, setMeasures] = useState<Measure[]>([]);

  // -- History State --
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // --- Refs ---
  const playerRef = useRef<GrainPlayerType | null>(null);
  const eqRef = useRef<Tone.EQ3 | null>(null);
  const analyserRef = useRef<Tone.Waveform | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const xmlInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const rafRef = useRef<number | null>(null);
  const metronomeSynthRef = useRef<Tone.MembraneSynth | null>(null);
  const metronomeLoopRef = useRef<Tone.Loop | null>(null); 
  
  // Refs to hold latest state for history commits to avoid stale closures
  const measuresRef = useRef(measures);
  const gridConfigRef = useRef(gridConfig);

  useEffect(() => {
      measuresRef.current = measures;
      gridConfigRef.current = gridConfig;
  }, [measures, gridConfig]);

  // --- Initialization ---
  useEffect(() => {
    analyserRef.current = new Tone.Waveform(256);
    eqRef.current = new Tone.EQ3({
      low: 0,
      mid: 0,
      high: 0,
      lowFrequency: 400,
      highFrequency: 2500
    });
    
    // Metronome setup
    metronomeSynthRef.current = new Tone.MembraneSynth({
        pitchDecay: 0.008,
        octaves: 4,
        oscillator: { type: 'sine' },
        envelope: {
            attack: 0.001,
            decay: 0.2,
            sustain: 0,
            release: 0.1
        }
    }).toDestination();
    metronomeSynthRef.current.volume.value = params.metronomeVolume;

    // Init initial measures
    const initialMeasures = Array.from({ length: 16 }, (_, i) => ({
        index: i + 1,
        chords: '',
        lyrics: ''
    }));
    
    // Set Initial State and History
    setMeasures(initialMeasures);
    const initialState = { measures: initialMeasures, gridConfig: { bpm: 120, tsTop: 4, tsBottom: 4, offset: 0 } };
    setHistory([initialState]);
    setHistoryIndex(0);

    return () => {
      playerRef.current?.dispose();
      analyserRef.current?.dispose();
      eqRef.current?.dispose();
      metronomeSynthRef.current?.dispose();
      metronomeLoopRef.current?.dispose();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // --- History Logic ---
  const pushToHistory = useCallback((newMeasures: Measure[], newConfig: GridConfig) => {
      setHistory(prev => {
          const newHistory = prev.slice(0, historyIndex + 1);
          newHistory.push({ 
              measures: JSON.parse(JSON.stringify(newMeasures)), 
              gridConfig: { ...newConfig } 
          });
          // Limit history size
          if (newHistory.length > 50) newHistory.shift();
          return newHistory;
      });
      setHistoryIndex(prev => Math.min(prev + 1, 49));
  }, [historyIndex]);

  // Wrapper to update state AND history (for atomic actions like Add/Delete)
  const updateStateAndHistory = (newMeasures: Measure[], newConfig: GridConfig) => {
      setMeasures(newMeasures);
      setGridConfig(newConfig);
      pushToHistory(newMeasures, newConfig);
  };

  // Wrapper to commit current state (used for onBlur or onDragEnd)
  const commitCurrentState = useCallback(() => {
      pushToHistory(measuresRef.current, gridConfigRef.current);
  }, [pushToHistory]);

  const undo = useCallback(() => {
      if (historyIndex > 0) {
          const prevIndex = historyIndex - 1;
          const prevState = history[prevIndex];
          setMeasures(prevState.measures);
          setGridConfig(prevState.gridConfig);
          setHistoryIndex(prevIndex);
      }
  }, [history, historyIndex]);

  const redo = useCallback(() => {
      if (historyIndex < history.length - 1) {
          const nextIndex = historyIndex + 1;
          const nextState = history[nextIndex];
          setMeasures(nextState.measures);
          setGridConfig(nextState.gridConfig);
          setHistoryIndex(nextIndex);
      }
  }, [history, historyIndex]);

  // --- Metronome Logic ---
  useEffect(() => {
      const realBPM = gridConfig.bpm * params.speed;
      Tone.Transport.bpm.value = realBPM;
      
      if (metronomeSynthRef.current) {
          metronomeSynthRef.current.volume.rampTo(params.metronomeVolume, 0.1);
      }

      if (metronomeLoopRef.current) {
          metronomeLoopRef.current.dispose();
          metronomeLoopRef.current = null;
      }

      if (isMetronomeOn) {
        const loopInterval = "4n"; 
        metronomeLoopRef.current = new Tone.Loop((time) => {
            if (!metronomeSynthRef.current) return;
             metronomeSynthRef.current.triggerAttackRelease("C4", "32n", time);
        }, loopInterval).start(0);
      }

  }, [gridConfig.bpm, params.speed, isMetronomeOn, params.metronomeVolume]);

  const syncTransport = (time: number) => {
      const relativeTime = time - gridConfig.offset;
      Tone.Transport.seconds = Math.max(0, relativeTime);
  };

  // --- Audio Loading ---
  const loadAudioBuffer = async (url: string, name: string) => {
    try {
      setLoadingState(LoadingState.PROCESSING);
      setStatusMessage('Decodificando audio...');

      await Tone.start();
      
      if (playerRef.current) {
        playerRef.current.stop();
        playerRef.current.dispose();
      }

      const player = new Tone.GrainPlayer({
        url: url,
        grainSize: GRAIN_SIZE,
        overlap: OVERLAP,
        onload: () => {
          setLoadingState(LoadingState.READY);
          setStatusMessage('Listo.');
          setAudioState(prev => ({
            ...prev,
            isLoaded: true,
            duration: player.buffer.duration,
            url: url,
            fileName: name,
            currentTime: 0,
            buffer: player.buffer
          }));
        },
        onerror: (err) => {
            console.error(err);
            setLoadingState(LoadingState.ERROR);
            setStatusMessage('Error al cargar audio.');
        }
      });

      if (eqRef.current && analyserRef.current) {
        player.connect(eqRef.current);
        eqRef.current.connect(analyserRef.current);
        analyserRef.current.toDestination();
      } else {
        player.toDestination();
      }

      playerRef.current = player;
      updatePlayerParams(params);

    } catch (error) {
      console.error("Error loading:", error);
      setLoadingState(LoadingState.ERROR);
      setStatusMessage('Error crítico.');
    }
  };

  // --- Player Logic ---
  const updatePlayerParams = (newParams: ProcessingParams) => {
    if (!playerRef.current) return;
    playerRef.current.playbackRate = newParams.speed;
    playerRef.current.detune = newParams.pitch * 100;
    playerRef.current.volume.value = newParams.volume;

    if (eqRef.current) {
      eqRef.current.low.value = newParams.eqLow;
      eqRef.current.mid.value = newParams.eqMid;
      eqRef.current.high.value = newParams.eqHigh;
    }
  };

  const handleParamChange = (key: keyof ProcessingParams, value: number) => {
    const newParams = { ...params, [key]: value };
    setParams(newParams);
    updatePlayerParams(newParams);
  };

  const handleSeek = (time: number) => {
    if (!playerRef.current) return;
    const t = Math.max(0, Math.min(time, audioState.duration));
    syncTransport(t);
    if (audioState.isPlaying) {
      playerRef.current.stop();
      playerRef.current.start(Tone.now(), t);
      if (isMetronomeOn) Tone.Transport.start();
    }
    setAudioState(prev => ({ ...prev, currentTime: t }));
  };

  const handleJump = (delta: number) => {
    if (!playerRef.current) return;
    const newTime = audioState.currentTime + delta;
    handleSeek(newTime);
  };

  const togglePlay = async () => {
    if (!playerRef.current || !audioState.isLoaded) return;
    await Tone.context.resume();

    if (audioState.isPlaying) {
      playerRef.current.stop();
      Tone.Transport.stop();
      setAudioState(prev => ({ ...prev, isPlaying: false }));
    } else {
      syncTransport(audioState.currentTime);
      playerRef.current.start(Tone.now(), audioState.currentTime);
      if (isMetronomeOn) Tone.Transport.start();
      setAudioState(prev => ({ ...prev, isPlaying: true }));
    }
  };

  const handlePlayRegion = async (start: number, duration: number) => {
     if (!playerRef.current || !audioState.isLoaded) return;
     await Tone.context.resume();
     playerRef.current.stop();
     Tone.Transport.stop();
     syncTransport(start);
     playerRef.current.start(Tone.now(), start, duration);
     if (isMetronomeOn) {
         Tone.Transport.start();
         Tone.Transport.stop(Tone.now() + (duration / params.speed)); 
     }
     setAudioState(prev => ({ ...prev, isPlaying: true, currentTime: start }));
     setTimeout(() => {
         setAudioState(prev => ({...prev, isPlaying: false}));
     }, (duration / params.speed) * 1000);
  };

  const handleSetLoop = (type: 'start' | 'end' | 'clear' | 'toggle') => {
    if (!playerRef.current) return;
    const now = audioState.currentTime;

    if (type === 'start') {
      setLoopState(prev => ({ ...prev, start: now, active: true }));
      playerRef.current.loopStart = now;
      if (loopState.end && loopState.end > now) playerRef.current.loop = true;
    } else if (type === 'end') {
      setLoopState(prev => ({ ...prev, end: now, active: true }));
      playerRef.current.loopEnd = now;
      if (loopState.start !== null && now > loopState.start) playerRef.current.loop = true;
    } else if (type === 'clear') {
      setLoopState({ active: false, start: null, end: null });
      playerRef.current.loop = false;
    } else if (type === 'toggle') {
        const newState = !loopState.active;
        setLoopState(prev => ({ ...prev, active: newState }));
        playerRef.current.loop = newState;
    }
  };

  // --- Polling ---
  useEffect(() => {
    let interval: number;
    if (audioState.isPlaying) {
      interval = window.setInterval(() => {
        setAudioState(prev => {
           const delta = 0.1 * params.speed; 
           const next = prev.currentTime + delta;
           const player = playerRef.current;
           if (player && player.loop && player.loopEnd) {
               const loopEnd = Tone.Time(player.loopEnd).toSeconds();
               if (next >= loopEnd) {
                   const loopStart = Tone.Time(player.loopStart).toSeconds();
                   syncTransport(loopStart); 
                   return { ...prev, currentTime: loopStart };
               }
           }
           return { ...prev, currentTime: Math.min(next, prev.duration) };
        });
      }, 100);
    }
    return () => clearInterval(interval);
  }, [audioState.isPlaying, params.speed]);

  // --- Keyboard ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Undo/Redo Shortcuts
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
          if (e.shiftKey) {
              e.preventDefault();
              redo();
          } else {
              e.preventDefault();
              undo();
          }
          return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
          e.preventDefault();
          redo();
          return;
      }

      const isTyping = e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement;
      if (isTyping) {
         if (e.code === 'F1') { e.preventDefault(); handleJump(-5); return; }
         if (e.code === 'F2') { e.preventDefault(); handleJump(5); return; }
         return; 
      }
      switch(e.code) {
        case 'Space':
        case 'Escape':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
        case 'F1':
          e.preventDefault();
          handleJump(-5);
          break;
        case 'ArrowRight':
        case 'F2':
          e.preventDefault();
          handleJump(5);
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [audioState, params, undo, redo]); 

  // --- File Upload ---
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    loadAudioBuffer(objectUrl, file.name);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('audio/')) {
        const objectUrl = URL.createObjectURL(file);
        loadAudioBuffer(objectUrl, file.name);
    }
  };

  // --- Project Save/Load ---
  const handleSaveProject = () => {
      const projectState = {
          version: 1,
          timestamp: Date.now(),
          audioFileName: audioState.fileName,
          measures: measures,
          gridConfig: gridConfig,
          params: params,
          loopState: loopState
      };
      
      const jsonString = JSON.stringify(projectState, null, 2);
      const blob = new Blob([jsonString], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      
      const safeName = audioState.fileName 
        ? audioState.fileName.replace(/\.[^/.]+$/, "") 
        : "proyecto_transcribime";
        
      a.href = url;
      a.download = `${safeName}.trb.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
  };

  const handleLoadProject = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = (event) => {
          try {
              const content = event.target?.result as string;
              const data = JSON.parse(content);
              
              // Basic validation
              if (data.measures && data.gridConfig) {
                  // Restore Grid and Measures (History handled)
                  updateStateAndHistory(data.measures, data.gridConfig);
                  
                  // Restore Parameters
                  if (data.params) {
                      setParams(data.params);
                      updatePlayerParams(data.params);
                  }
                  
                  // Restore Loop State
                  if (data.loopState) {
                      setLoopState(data.loopState);
                  }
                  
                  let msg = `Proyecto "${file.name}" cargado con éxito.`;
                  if (data.audioFileName && (!audioState.isLoaded || audioState.fileName !== data.audioFileName)) {
                      msg += ` Por favor carga el audio original: ${data.audioFileName}`;
                  }
                  setStatusMessage(msg);
              } else {
                  setStatusMessage('Error: Formato de archivo de proyecto inválido.');
              }
          } catch (err) {
              console.error(err);
              setStatusMessage('Error al leer el archivo de proyecto.');
          }
      };
      reader.readAsText(file);
      // Reset input
      e.target.value = '';
  };

  // --- XML Processing ---
  const parseMusicXML = (xmlText: string) => {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, "text/xml");
      const newMeasures: Measure[] = [];
      const part = xmlDoc.querySelector('part');
      if (!part) return;

      const measuresList = part.querySelectorAll('measure');
      let newBpm = gridConfig.bpm;
      let globalTsTop = gridConfig.tsTop;
      let globalTsBottom = gridConfig.tsBottom;
      let firstMeasureProcessed = false;

      measuresList.forEach((m, index) => {
          const measureIndex = index + 1;
          let chordsText = '';
          let lyricsText = '';

          const attributes = m.querySelector('attributes');
          
          if (!firstMeasureProcessed && attributes) {
             const time = attributes.querySelector('time');
             if (time) {
                 const beats = time.querySelector('beats')?.textContent;
                 const type = time.querySelector('beat-type')?.textContent;
                 if (beats && type) {
                     globalTsTop = parseInt(beats);
                     globalTsBottom = parseInt(type);
                     firstMeasureProcessed = true;
                 }
             }
          }
          
          const directions = m.querySelectorAll('direction');
          directions.forEach(d => {
              const sound = d.querySelector('sound');
              if (sound && sound.hasAttribute('tempo')) {
                  newBpm = parseFloat(sound.getAttribute('tempo') || '120');
              }
          });

          // Chords
          const harmonies = m.querySelectorAll('harmony');
          const chordsInMeasure: string[] = [];
          harmonies.forEach(h => {
              const root = h.querySelector('root-step')?.textContent;
              const alter = h.querySelector('root-alter')?.textContent;
              const kind = h.querySelector('kind')?.textContent; 
              const bass = h.querySelector('bass > bass-step')?.textContent;
              const bassAlter = h.querySelector('bass > bass-alter')?.textContent;

              if (root) {
                  let chord = root;
                  if (alter === '1') chord += '#';
                  if (alter === '-1') chord += 'b';
                  if (kind === 'minor') chord += 'm';
                  else if (kind === 'augmented') chord += 'aug';
                  else if (kind === 'diminished') chord += 'dim';
                  else if (kind === 'dominant') chord += '7';
                  else if (kind === 'major-seventh') chord += 'maj7';
                  else if (kind === 'minor-seventh') chord += 'm7';
                  if (bass) {
                      let bassNote = bass;
                      if (bassAlter === '1') bassNote += '#';
                      if (bassAlter === '-1') bassNote += 'b';
                      chord += `/${bassNote}`;
                  }
                  chordsInMeasure.push(chord);
              }
          });
          chordsText = chordsInMeasure.join(' ');

          // Lyrics
          const notes = m.querySelectorAll('note');
          const lyricsInMeasure: string[] = [];
          notes.forEach(n => {
              const lyric = n.querySelector('lyric');
              if (lyric) {
                  const text = lyric.querySelector('text')?.textContent;
                  if (text) lyricsInMeasure.push(text);
              }
          });
          lyricsText = lyricsInMeasure.join(' ');

          newMeasures.push({
              index: measureIndex,
              chords: chordsText,
              lyrics: lyricsText,
          });
      });

      const newConfig = {
          ...gridConfig,
          bpm: newBpm,
          tsTop: globalTsTop,
          tsBottom: globalTsBottom
      };
      
      updateStateAndHistory(newMeasures, newConfig);
      setStatusMessage(`Importado: ${newMeasures.length} compases (Métrica ${globalTsTop}/${globalTsBottom}).`);
  };

  const handleXmlUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
          if (event.target?.result) parseMusicXML(event.target.result as string);
      };
      reader.readAsText(file);
  };

  // --- Grid Mode Logic ---
  
  // 1. Realtime updates (visual only, no history)
  const handleMeasureUpdate = (index: number, field: keyof Measure, value: any) => {
    setMeasures(prev => prev.map(m => m.index === index ? { ...m, [field]: value } : m));
  };
  
  const handleMeasureDurationChange = (index: number, newDuration: number) => {
      setMeasures(prev => prev.map(m => m.index === index ? { ...m, duration: newDuration } : m));
  };

  // 2. Atomic actions (update + history)
  const handleAddMeasures = () => {
    const lastMeasure = measures[measures.length - 1];
    const lastIndex = lastMeasure ? lastMeasure.index : 0;
    const newBlock = Array.from({ length: 4 }, (_, i) => ({
        index: lastIndex + i + 1,
        chords: '',
        lyrics: ''
    }));
    updateStateAndHistory([...measures, ...newBlock], gridConfig);
  };

  const handleInsertMeasure = (targetIndex: number, position: 'before' | 'after') => {
    const insertionIndex = position === 'before' ? targetIndex - 1 : targetIndex;
    const newMeasure: Measure = { index: 0, chords: '', lyrics: '' };
    const newArr = [...measures];
    newArr.splice(insertionIndex, 0, newMeasure);
    const reindexed = newArr.map((m, i) => ({ ...m, index: i + 1 }));
    updateStateAndHistory(reindexed, gridConfig);
  };

  const handleDeleteMeasure = (indexToDelete: number) => {
     if (measures.length <= 1) return;
     const newArr = measures.filter(m => m.index !== indexToDelete);
     const reindexed = newArr.map((m, i) => ({ ...m, index: i + 1 }));
     updateStateAndHistory(reindexed, gridConfig);
  };

  // --- Transposition Logic ---
  const transposeNote = (note: string, semitones: number): string => {
      const notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
      const flatsMap: {[key: string]: string} = { "Db": "C#", "Eb": "D#", "Gb": "F#", "Ab": "G#", "Bb": "A#" };
      
      // Normalize to sharp
      let normalized = flatsMap[note] || note;
      let index = notes.indexOf(normalized);
      
      if (index === -1) return note; 

      let newIndex = (index + semitones) % 12;
      if (newIndex < 0) newIndex += 12;
      
      return notes[newIndex];
  };

  const transposeChordStr = (chordStr: string, semitones: number): string => {
      if (!chordStr) return "";
      
      const processPart = (part: string) => {
          const match = part.match(/^([A-G][#b]?)(.*)/);
          if (match) {
              const note = match[1];
              const suffix = match[2];
              const newNote = transposeNote(note, semitones);
              return newNote + suffix;
          }
          return part;
      };

      // Handle slash chords e.g. C/G
      const parts = chordStr.split('/');
      if (parts.length === 2) {
          return processPart(parts[0]) + '/' + processPart(parts[1]);
      }
      
      return processPart(chordStr);
  };

  const handleTranspose = (semitones: number) => {
      const newMeasures = measures.map(m => {
          if (!m.chords) return m;
          // Handle multiple chords in one measure (e.g. "C G Am")
          const transposed = m.chords.split(/\s+/).map(c => transposeChordStr(c, semitones)).join(' ');
          return { ...m, chords: transposed };
      });
      updateStateAndHistory(newMeasures, gridConfig);
      setStatusMessage(`Transpuesto ${semitones > 0 ? '+' : ''}${semitones} semitonos.`);
  };

  // --- Export Logic ---
  const exportMusicXML = () => {
    if (!audioState.fileName) return;
    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work><work-title>${audioState.fileName.replace(/\.[^/.]+$/, "")}</work-title></work>
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>${gridConfig.tsTop}</beats><beat-type>${gridConfig.tsBottom}</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      ${measures[0].chords ? `<direction placement="above"><direction-type><words font-weight="bold" font-size="12" color="#4f46e5">${measures[0].chords}</words></direction-type></direction>` : ''}
      ${measures[0].lyrics ? `<direction placement="below"><direction-type><words font-size="10">${measures[0].lyrics.replace(/[<>&'"]/g, '')}</words></direction-type></direction>` : ''}
      <note><rest/><duration>${gridConfig.tsTop}</duration></note>
    </measure>
`;
    for (let i = 1; i < measures.length; i++) {
        const m = measures[i];
        xml += `    <measure number="${m.index}">\n`;
        if (m.chords) {
             xml += `      <direction placement="above"><direction-type><words font-weight="bold" font-size="12" color="#4f46e5">${m.chords}</words></direction-type></direction>\n`;
        }
        if (m.lyrics) {
            xml += `      <direction placement="below"><direction-type><words font-size="10">${m.lyrics.replace(/[<>&'"]/g, '')}</words></direction-type></direction>\n`;
        }
        xml += `      <note><rest/><duration>${gridConfig.tsTop}</duration></note>\n`;
        xml += `    </measure>\n`;
    }
    xml += `  </part></score-partwise>`;

    const blob = new Blob([xml], { type: 'application/vnd.recordare.musicxml+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${audioState.fileName.replace(/\.[^/.]+$/, "")}.musicxml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };


  return (
    <div 
        className="h-screen bg-slate-950 text-slate-200 flex flex-col overflow-hidden"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
    >
      {/* Tuner Overlay */}
      {showTuner && <GuitarTuner onClose={() => setShowTuner(false)} />}

      {/* Header */}
      <header className="bg-slate-900 border-b border-slate-800 p-4 flex justify-between items-center h-16 shrink-0">
        <div className="flex items-center gap-6">
            <div>
                <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-indigo-500">
                Transcribime <span className="text-slate-600 text-sm font-mono font-normal">| Studio</span>
                </h1>
            </div>
            {/* Undo / Redo Buttons */}
            <div className="flex items-center gap-2 border-l border-slate-700 pl-6">
                 <button 
                    onClick={undo} 
                    disabled={historyIndex <= 0}
                    className={`p-2 rounded transition-colors ${historyIndex > 0 ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-700 cursor-not-allowed'}`}
                    title="Deshacer (Ctrl+Z)"
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13"/></svg>
                 </button>
                 <button 
                    onClick={redo}
                    disabled={historyIndex >= history.length - 1}
                    className={`p-2 rounded transition-colors ${historyIndex < history.length - 1 ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-700 cursor-not-allowed'}`}
                    title="Rehacer (Ctrl+Y)"
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 019-9 9 9 0 016 2.3l3 2.7"/></svg>
                 </button>
            </div>
        </div>

        <div className="flex gap-3 items-center">
            <button 
                onClick={() => setShowTuner(true)}
                className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-emerald-400 text-sm font-semibold px-3 py-2 rounded transition-colors border border-slate-700"
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2c-5.5 0-10 4.5-10 10s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 18c-4.4 0-8-3.6-8-8s3.6-8 8-8 8 3.6 8 8-3.6 8-8 8z"/><polygon points="12,6 12,12 16,14"/></svg>
                Afinador
            </button>

            {/* Project Save/Load */}
            <div className="flex items-center gap-1 bg-slate-800 rounded border border-slate-700">
                <input type="file" id="project-upload" accept=".json,.trb" className="hidden" ref={projectInputRef} onChange={handleLoadProject}/>
                <button onClick={() => projectInputRef.current?.click()} className="flex items-center gap-2 hover:bg-slate-700 text-indigo-300 text-sm font-semibold px-3 py-2 rounded-l transition-colors" title="Cargar Proyecto (.trb.json)">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                </button>
                <div className="w-[1px] h-4 bg-slate-700"></div>
                <button onClick={handleSaveProject} className="flex items-center gap-2 hover:bg-slate-700 text-indigo-300 text-sm font-semibold px-3 py-2 rounded-r transition-colors" title="Guardar Proyecto">
                     <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                </button>
            </div>

            <input type="file" id="xml-upload" accept=".xml,.musicxml" className="hidden" ref={xmlInputRef} onChange={handleXmlUpload}/>
            <div className="flex items-center gap-1 bg-slate-800 rounded border border-slate-700">
                 <button onClick={() => xmlInputRef.current?.click()} className="flex items-center gap-2 hover:bg-slate-700 text-slate-300 text-sm font-semibold px-3 py-2 rounded-l transition-colors" title="Importar MusicXML">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                </button>
                 <div className="w-[1px] h-4 bg-slate-700"></div>
                <button onClick={exportMusicXML} className="flex items-center gap-2 hover:bg-slate-700 text-slate-300 text-sm font-semibold px-3 py-2 rounded-r transition-colors" title="Exportar MusicXML">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                </button>
            </div>
            
            <input type="file" id="file-upload" accept="audio/*" className="hidden" ref={fileInputRef} onChange={handleFileUpload}/>
            <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold px-4 py-2 rounded transition-colors shadow-lg shadow-cyan-900/20">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg> Abrir Audio
            </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Left Column */}
        <div className="lg:w-[380px] w-full bg-slate-900 border-r border-slate-800 flex flex-col overflow-y-auto p-4 gap-4 shrink-0 z-10 shadow-2xl">
            <div className="bg-slate-800/50 rounded p-3 border border-slate-700 text-center relative overflow-hidden group">
                {audioState.fileName ? <div className="text-cyan-400 font-mono text-sm truncate relative z-10">{audioState.fileName}</div> : <div className="text-slate-500 text-sm italic relative z-10">Arrastra un archivo de audio aquí</div>}
                 {loadingState === LoadingState.PROCESSING && <div className="text-xs text-yellow-400 mt-1 relative z-10">Procesando...</div>}
                 {statusMessage && <div className="text-xs text-slate-400 mt-1 relative z-10 animate-pulse">{statusMessage}</div>}
            </div>
            <div className="bg-slate-950 rounded-lg border border-slate-800 overflow-hidden shrink-0 shadow-inner">
                <Visualizer analyser={analyserRef.current} isPlaying={audioState.isPlaying} />
            </div>
            <Controls 
                params={params} 
                audioState={audioState} 
                loopState={loopState}
                onParamChange={handleParamChange}
                onTogglePlay={togglePlay}
                onSeek={handleSeek}
                onJump={handleJump}
                onSetLoop={handleSetLoop}
            />
        </div>

        {/* Right Column */}
        <div className="flex-1 bg-slate-950 flex flex-col relative overflow-hidden">
             <MeasureGrid 
                    measures={measures}
                    gridConfig={gridConfig}
                    audioState={audioState}
                    onConfigChange={setGridConfig}
                    onMeasureUpdate={handleMeasureUpdate}
                    onMeasureDurationChange={handleMeasureDurationChange}
                    onCommitChanges={commitCurrentState} 
                    onSeek={handleSeek}
                    onAddMeasures={handleAddMeasures}
                    onPlayRegion={handlePlayRegion}
                    onToggleMetronome={() => setIsMetronomeOn(!isMetronomeOn)}
                    isMetronomeOn={isMetronomeOn}
                    onDeleteMeasure={handleDeleteMeasure}
                    onInsertMeasure={handleInsertMeasure}
                    autoScroll={autoScroll}
                    onToggleAutoScroll={() => setAutoScroll(!autoScroll)}
                    onTranspose={handleTranspose}
                />
        </div>
      </main>
    </div>
  );
};

export default App;
