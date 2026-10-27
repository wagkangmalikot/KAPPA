import { useState } from 'react';
import { useTabStore } from '../tabStore';

export function TransportBar({ onPlay, onPause, onStop, isPlayingAudio = false, hasAudio = false }) {
  const { bpm, setBpm } = useTabStore();
  const [localBpm, setLocalBpm] = useState(String(bpm));

  function commitBpm() {
    const parsed = parseInt(localBpm, 10);
    if (!isNaN(parsed)) setBpm(parsed);
    setLocalBpm(String(useTabStore.getState().bpm));
  }

  return (
    <div className="transport-bar">
      <button
        className="transport-btn transport-btn-play"
        onClick={onPlay}
        disabled={isPlayingAudio || !hasAudio}
      >
        ▶ Play
      </button>
      <button
        className="transport-btn"
        onClick={onPause}
        disabled={!isPlayingAudio}
      >
        ⏸ Pause
      </button>
      <button className="transport-btn" onClick={onStop} disabled={!hasAudio}>
        ⏹ Stop
      </button>

      <div className="transport-bpm">
        <label htmlFor="tab-bpm">BPM</label>
        <input
          id="tab-bpm"
          className="transport-bpm-input"
          type="number"
          min={40}
          max={240}
          value={localBpm}
          onChange={e => setLocalBpm(e.target.value)}
          onBlur={commitBpm}
          onKeyDown={e => e.key === 'Enter' && commitBpm()}
        />
      </div>
    </div>
  );
}
