import { useState, useEffect } from 'react';

const CHORDS_PER_ROW = 4;
const LINE_CHARS = 52;

function chordWidths(row) {
  const totalDur = row.reduce((s, seg) => s + Math.max(seg.endTime - seg.startTime, 0.1), 0);
  return row.map(seg => {
    const dur = Math.max(seg.endTime - seg.startTime, 0.1);
    return Math.max(seg.chord.length + 3, Math.floor((dur / totalDur) * LINE_CHARS));
  });
}

export function ChordSheet({ segments, lyricsLines = [], chordStartSec = 0, lyricsCurrentTime = null }) {
  const [lyrics, setLyrics] = useState([]);

  const rows = [];
  for (let i = 0; i < segments.length; i += CHORDS_PER_ROW) {
    rows.push(segments.slice(i, i + CHORDS_PER_ROW));
  }

  useEffect(() => {
    setLyrics(rows.map(() => ''));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments.length]);

  // Pre-fill from fetched/detected lyrics
  useEffect(() => {
    if (!lyricsLines.length || !segments.length) return;
    setLyrics(rows.map((row) => {
      const absStart = row[0].startTime + chordStartSec;
      const absEnd   = row[row.length - 1].endTime + chordStartSec;
      return lyricsLines
        .filter(l => l.start < absEnd + 0.5 && (l.end ?? Infinity) > absStart - 0.5)
        .map(l => l.text)
        .join(' ');
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lyricsLines, chordStartSec, segments.length]);

  function buildCopyText() {
    return rows.map((row, ri) => {
      const ws = chordWidths(row);
      const chordLine = row.map((seg, ci) => seg.chord.padEnd(ws[ci])).join('');
      const lyricLine = (lyrics[ri] || '').trimEnd();
      return lyricLine ? chordLine + '\n' + lyricLine : chordLine;
    }).join('\n\n');
  }

  if (!segments.length) return null;

  return (
    <div className="ug-chord-display">
      <div className="ug-chord-header">
        <span className="ug-chord-count">{segments.length} chords detected</span>
        <button type="button" className="btn-copy" onClick={() => navigator.clipboard.writeText(buildCopyText())}>
          Copy
        </button>
      </div>
      <div className="ug-chord-scroll">
        {rows.map((row, ri) => {
          const ws = chordWidths(row);
          const absStart = row[0].startTime + chordStartSec;
          const absEnd   = row[row.length - 1].endTime + chordStartSec;
          const isActive = lyricsCurrentTime !== null
            && lyricsCurrentTime >= absStart && lyricsCurrentTime < absEnd;
          return (
            <div key={ri} className={`ug-chord-block${isActive ? ' ug-chord-block-active' : ''}`}>
              <div className="ug-chord-line">
                {row.map((seg, ci) => (
                  <span key={ci} className="ug-chord-name" style={{ width: `${ws[ci]}ch` }}>
                    {seg.chord}
                  </span>
                ))}
              </div>
              <input
                className="ug-lyrics-input"
                type="text"
                placeholder="Type lyrics for this line…"
                value={lyrics[ri] ?? ''}
                onChange={e => {
                  const val = e.target.value;
                  setLyrics(prev => {
                    const next = [...prev];
                    next[ri] = val;
                    return next;
                  });
                }}
              />
              <div className="ug-chord-times">
                {row.map((seg, ci) => (
                  <span key={ci} style={{ width: `${ws[ci]}ch`, display: 'inline-block' }}>
                    {formatTime(seg.startTime)}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
