import { useEffect, useRef, useState, useCallback } from 'react';
import * as Tone from 'tone';
import { useTabStore } from '../tabStore';
import { STRING_LABELS } from '../tabGenerator';

const SAMPLE_BASE = 'https://nbrosowsky.github.io/tonejs-instruments/samples/guitar-acoustic/';
const SAMPLE_MAP = {
  E2: 'E2.mp3', A2: 'A2.mp3', D3: 'D3.mp3',
  G3: 'G3.mp3', B3: 'B3.mp3', E4: 'E4.mp3',
};

// Open-string note names matching tabGenerator OPEN_MIDIS
const OPEN_NOTES = {
  6: ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'],
  7: ['E4', 'B3', 'G3', 'D3', 'A2', 'E2', 'B1'],
  4: ['G2', 'D2', 'A1', 'E1'],
};

function getNoteForFret(stringIndex, fret, stringCount) {
  const open = OPEN_NOTES[stringCount]?.[stringIndex];
  if (!open) return null;
  return Tone.Frequency(open).transpose(fret).toNote();
}

export function useTabAudio() {
  const samplerRef = useRef(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    const sampler = new Tone.Sampler({
      urls: SAMPLE_MAP,
      baseUrl: SAMPLE_BASE,
      onload: () => setIsLoaded(true),
      onerror: () => setLoadError('Could not load guitar samples (requires internet).'),
    }).toDestination();
    samplerRef.current = sampler;
    return () => {
      sampler.dispose();
      Tone.getTransport().cancel();
      Tone.getTransport().stop();
    };
  }, []);

  const play = useCallback(async () => {
    if (!samplerRef.current || !isLoaded) return;
    const store = useTabStore.getState();
    if (store.isPlaying) {
      Tone.getTransport().cancel();
      store.setIsPlaying(false);
    }
    await Tone.start();

    const { tab, bpm, totalBeats, stringCount, setPlayheadBeat, setIsPlaying } = useTabStore.getState();
    Tone.getTransport().bpm.value = bpm;
    Tone.getTransport().cancel();

    let beat = useTabStore.getState().playheadBeat;

    Tone.getTransport().scheduleRepeat((time) => {
      const currentBeat = beat;
      if (currentBeat >= totalBeats) {
        Tone.getTransport().stop();
        setPlayheadBeat(0);
        setIsPlaying(false);
        return;
      }
      tab.forEach((row, si) => {
        const fret = row[currentBeat];
        if (fret !== null) {
          const note = getNoteForFret(si, fret, stringCount);
          if (note) samplerRef.current.triggerAttack(note, time);
        }
      });
      setPlayheadBeat(currentBeat);
      beat++;
    }, '4n');

    Tone.getTransport().start();
    setIsPlaying(true);
  }, [isLoaded]);

  const pause = useCallback(() => {
    Tone.getTransport().pause();
    useTabStore.getState().setIsPlaying(false);
  }, []);

  const stop = useCallback(() => {
    Tone.getTransport().stop();
    Tone.getTransport().cancel();
    useTabStore.getState().setPlayheadBeat(0);
    useTabStore.getState().setIsPlaying(false);
  }, []);

  const seekTo = useCallback((beat) => {
    const wasPlaying = useTabStore.getState().isPlaying;
    if (wasPlaying) Tone.getTransport().pause();
    useTabStore.getState().setPlayheadBeat(beat);
    if (wasPlaying) {
      Tone.getTransport().cancel();
      void play();
    }
  }, [play]);

  return { play, pause, stop, seekTo, isLoaded, loadError };
}
