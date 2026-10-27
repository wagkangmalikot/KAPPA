import { create } from 'zustand';

const DEFAULT_BEATS = 32;
const EXPAND_BY = 16;

function makeEmptyTab(strings, beats) {
  return Array.from({ length: strings }, () => new Array(beats).fill(null));
}

const initialState = {
  tab:              makeEmptyTab(6, DEFAULT_BEATS),
  techniques:       makeEmptyTab(6, DEFAULT_BEATS),
  leadTab:          makeEmptyTab(6, DEFAULT_BEATS),
  leadTechniques:   makeEmptyTab(6, DEFAULT_BEATS),
  rhythmTab:        makeEmptyTab(6, DEFAULT_BEATS),
  rhythmTechniques: makeEmptyTab(6, DEFAULT_BEATS),
  stringCount: 6,
  bpm: 120,
  playheadBeat: 0,
  totalBeats: DEFAULT_BEATS,
  isPlaying: false,
};

export const useTabStore = create((set, get) => ({
  ...initialState,

  setCell: (stringIndex, beat, fret) => {
    const { tab, totalBeats } = get();
    const newTab = tab.map((row, si) =>
      si === stringIndex
        ? row.map((cell, bi) => (bi === beat ? fret : cell))
        : [...row]
    );
    let newTotalBeats = totalBeats;
    if (beat === totalBeats - 1 && fret !== null) {
      newTotalBeats = totalBeats + EXPAND_BY;
      newTab.forEach(row => {
        while (row.length < newTotalBeats) row.push(null);
      });
    }
    set({ tab: newTab, totalBeats: newTotalBeats });
  },

  setStringCount: (count) => {
    const { tab, techniques, leadTab, leadTechniques, rhythmTab, rhythmTechniques, totalBeats } = get();
    const resize = (arr) => {
      if (count < arr.length) return arr.slice(0, count);
      const copy = [...arr];
      while (copy.length < count) copy.push(new Array(totalBeats).fill(null));
      return copy;
    };
    set({
      stringCount:      count,
      tab:              resize(tab),
      techniques:       resize(techniques),
      leadTab:          resize(leadTab),
      leadTechniques:   resize(leadTechniques),
      rhythmTab:        resize(rhythmTab),
      rhythmTechniques: resize(rhythmTechniques),
    });
  },

  setBpm: (bpm) => set({ bpm: Math.min(240, Math.max(40, bpm)) }),

  setPlayheadBeat: (beat) => set({ playheadBeat: beat }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),

  loadTab: (newTab, newTechniques, newLeadTab, newLeadTechs, newRhythmTab, newRhythmTechs, newTotalBeats) => {
    const { stringCount } = get();
    const pad = (src) => Array.from({ length: stringCount }, (_, si) => {
      const row = src?.[si] ?? [];
      const out = [...row];
      while (out.length < newTotalBeats) out.push(null);
      return out;
    });
    set({
      tab:              pad(newTab),
      techniques:       pad(newTechniques),
      leadTab:          pad(newLeadTab),
      leadTechniques:   pad(newLeadTechs),
      rhythmTab:        pad(newRhythmTab),
      rhythmTechniques: pad(newRhythmTechs),
      totalBeats:       newTotalBeats,
      playheadBeat:     0,
    });
  },

  clearTab: () => {
    const { stringCount } = get();
    set({
      tab:              makeEmptyTab(stringCount, DEFAULT_BEATS),
      techniques:       makeEmptyTab(stringCount, DEFAULT_BEATS),
      leadTab:          makeEmptyTab(stringCount, DEFAULT_BEATS),
      leadTechniques:   makeEmptyTab(stringCount, DEFAULT_BEATS),
      rhythmTab:        makeEmptyTab(stringCount, DEFAULT_BEATS),
      rhythmTechniques: makeEmptyTab(stringCount, DEFAULT_BEATS),
      playheadBeat:     0,
      totalBeats:       DEFAULT_BEATS,
    });
  },

  isTabEmpty: () => get().tab.every(row => row.every(cell => cell === null)),
}));

if (import.meta.env.DEV) window.__tabStore = useTabStore;
