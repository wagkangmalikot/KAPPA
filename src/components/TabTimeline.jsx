import { useTabStore } from '../tabStore';
import { SUBDIVISIONS, COLS_PER_MEASURE } from '../tabGenerator';

export function TabTimeline({ onSeek }) {
  const { playheadBeat, totalBeats } = useTabStore();
  const pct = totalBeats > 0 ? (playheadBeat / totalBeats) * 100 : 0;

  const totalMeasures = Math.ceil(totalBeats / COLS_PER_MEASURE);
  const currentMeasure = Math.floor(playheadBeat / COLS_PER_MEASURE) + 1;
  const currentBeat = Math.floor((playheadBeat % COLS_PER_MEASURE) / SUBDIVISIONS) + 1;

  function handleClick(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const col = Math.min(totalBeats - 1, Math.floor(Math.max(0, Math.min(1, ratio)) * totalBeats));
    onSeek(col);
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      onSeek(Math.min(totalBeats - 1, playheadBeat + SUBDIVISIONS));
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onSeek(Math.max(0, playheadBeat - SUBDIVISIONS));
    }
  }

  return (
    <div className="tab-timeline">
      <div
        className="tab-timeline-track"
        role="slider"
        aria-valuenow={playheadBeat}
        aria-valuemin={0}
        aria-valuemax={totalBeats - 1}
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
      >
        <div className="tab-timeline-fill" style={{ width: `${pct}%` }} />
        <div className="tab-timeline-thumb" style={{ left: `${pct}%` }} />
      </div>
      <div className="tab-timeline-counter">
        M{currentMeasure} B{currentBeat} / {totalMeasures}m
      </div>
    </div>
  );
}
