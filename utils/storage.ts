
import { GridConfig, Measure, Marker, ProcessingParams, ProjectMeta } from '../types';

const DB_NAME = 'EscuchameDB';
const DB_VERSION = 2; // Incremented version for new store
const STORE_AUDIO = 'audio';
const STORE_STATE = 'state';
const STORE_META = 'meta';

export interface PersistedState {
  measures: Measure[];
  gridConfig: GridConfig;
  markers: Marker[];
  params: ProcessingParams;
  fileName: string;
  timestamp: number;
}

export interface PersistedAudio {
  blob: Blob;
  fileName: string;
  type: string;
}

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_AUDIO)) {
        db.createObjectStore(STORE_AUDIO); // Key is projectId
      }
      if (!db.objectStoreNames.contains(STORE_STATE)) {
        db.createObjectStore(STORE_STATE); // Key is projectId
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'id' });
      }
    };
  });
};

// --- Meta Operations (Projects List) ---

export const getProjects = async (): Promise<ProjectMeta[]> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_META, 'readonly');
    const store = transaction.objectStore(STORE_META);
    const request = store.getAll();
    request.onsuccess = () => {
        // Sort by lastOpened desc
        const res = (request.result as ProjectMeta[]).sort((a,b) => b.lastOpened - a.lastOpened);
        resolve(res);
    };
    request.onerror = () => reject(request.error);
  });
};

export const saveProjectMeta = async (meta: ProjectMeta) => {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_META, 'readwrite');
    const store = transaction.objectStore(STORE_META);
    const request = store.put(meta);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const deleteProject = async (projectId: string) => {
    const db = await openDB();
    return new Promise<void>((resolve, reject) => {
        const t = db.transaction([STORE_META, STORE_AUDIO, STORE_STATE], 'readwrite');
        
        t.objectStore(STORE_META).delete(projectId);
        t.objectStore(STORE_AUDIO).delete(projectId);
        t.objectStore(STORE_STATE).delete(projectId);
        
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
    });
};

// --- Audio & State Operations ---

export const saveAudioToDB = async (file: File | Blob, fileName: string, projectId: string) => {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_AUDIO, 'readwrite');
    const store = transaction.objectStore(STORE_AUDIO);
    
    const data: PersistedAudio = {
      blob: file,
      fileName: fileName,
      type: file.type
    };

    const request = store.put(data, projectId);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const loadAudioFromDB = async (projectId: string): Promise<PersistedAudio | null> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_AUDIO, 'readonly');
    const store = transaction.objectStore(STORE_AUDIO);
    const request = store.get(projectId);

    request.onsuccess = () => {
      if (request.result) {
        resolve(request.result as PersistedAudio);
      } else {
        resolve(null);
      }
    };
    request.onerror = () => reject(request.error);
  });
};

export const saveStateToDB = async (state: PersistedState, projectId: string) => {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_STATE, 'readwrite');
    const store = transaction.objectStore(STORE_STATE);
    const request = store.put(state, projectId);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const loadStateFromDB = async (projectId: string): Promise<PersistedState | null> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_STATE, 'readonly');
    const store = transaction.objectStore(STORE_STATE);
    const request = store.get(projectId);

    request.onsuccess = () => {
      resolve(request.result ? (request.result as PersistedState) : null);
    };
    request.onerror = () => reject(request.error);
  });
};

export const clearDB = async () => {
    const db = await openDB();
    const t = db.transaction([STORE_AUDIO, STORE_STATE, STORE_META], 'readwrite');
    t.objectStore(STORE_AUDIO).clear();
    t.objectStore(STORE_STATE).clear();
    t.objectStore(STORE_META).clear();
};
