import { useRef, useEffect } from 'react';
import { useTabStore } from '../tabStore';
import { STRING_LABELS, SUBDIVISIONS, COLS_PER_MEASURE } from '../tabGenerator';

const BEATS_PER_SYSTEM = 32;

const TECH_CLASS = { h: 'hammer', p: 'pull', b: 'bend', '/': 'slide', '\\': 'slide' };

function beatText(val, tech, colW) {
  if (val === null) return '-'.repeat(colW + 2);
  const s = String(val) + (tech || '');
  return '-'.repeat(Math.max(0, colW + 2 - s.length)) + s;
}

function sysLyrics(start, end, bpm, lyricsLines, tabStartSec) {
  if (!lyricsLines || !lyricsLines.length) return '';
  const secsPerCol = 60 / ((bpm || 120) * SUBDIVISIONS);
  const absStart = tabStartSec + start * secsPerCol;
  const absEnd   = tabStartSec + end   * secsPerCol;
  return lyricsLines
    .filter(l => l.start < absEnd + 0.5 && (l.end ?? Infinity) > absStart - 0.5)
    .map(l => l.text)
    .join(' ');
}

function buildPlainText(activeTab, activeTech, labels, totalBeats, colW, bpm, lyricsLines, tabStartSec) {
  const systems = [];
  for (let start = 0; start < totalBeats; start += BEATS_PER_SYSTEM) {
    const end = Math.min(start + BEATS_PER_SYSTEM, totalBeats);
    const lines = labels.map((label, si) => {
      let line = `${label}|`;
      for (let bi = start; bi < end; bi++) {
        line += beatText(activeTab[si]?.[bi] ?? null, activeTech[si]?.[bi] ?? null, colW[bi]);
        if ((bi + 1) % COLS_PER_MEASURE === 0 || bi === totalBeats - 1) line += '|';
      }
      return line;
    });
    const words = sysLyrics(start, end, bpm, lyricsLines, tabStartSec);
    if (words) lines.push(words);
    systems.push(lines.join('\n'));
  }
  return systems.join('\n\n');
}

function BeatCell({ val, tech, colW, isActive }) {
  if (val === null) {
    return <span className={`ug-beat${isActive ? ' ug-beat-active' : ''}`}>{'-'.repeat(colW + 2)}</span>;
  }
  const s = String(val);
  const techChar = tech || '';
  const dashes = '-'.repeat(Math.max(0, colW + 2 - s.length - techChar.length));
  return (
    <span className={`ug-beat${isActive ? ' ug-beat-active' : ''}`}>
      {dashes}{s}
      {techChar && (
        <span className={`tab-tech tab-tech-${TECH_CLASS[techChar] || 'other'}`}>{techChar}</span>
      )}
    </span>
  );
}

export function TabGrid({ source, lyricsLines = [], tabStartSec = 0, lyricsCurrentTime = null }) {
  const {
    tab, techniques,
    leadTab, leadTechniques,
    rhythmTab, rhythmTechniques,
    stringCount, playheadBeat, totalBeats, bpm,
  } = useTabStore();

  const activeTab  = source === 'lead'   ? leadTab
                   : source === 'rhythm' ? rhythmTab
                   : tab;
  const activeTech = source === 'lead'   ? leadTechniques
                   : source === 'rhythm' ? rhythmTechniques
                   : techniques;

  const labels = STRING_LABELS[stringCount] ?? [];
  const activeRef = useRef(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [playheadBeat]);

  if (activeTab.every(row => row.every(cell => cell === null))) return null;

  const colW = Array.from({ length: totalBeats }, (_, bi) => {
    let max = 1;
    for (let si = 0; si < activeTab.length; si++) {
      if (activeTab[si][bi] !== null) {
        const len = String(activeTab[si][bi]).length + (activeTech[si]?.[bi] ? 1 : 0);
        max = Math.max(max, len);
      }
    }
    return max;
  });

  const systems = [];
  for (let start = 0; start < totalBeats; start += BEATS_PER_SYSTEM) {
    systems.push({ start, end: Math.min(start + BEATS_PER_SYSTEM, totalBeats) });
  }

  return (
    <div className="ug-tab-wrapper">
      <div className="ug-tab-actions">
        <button
          type="button"
          className="btn-copy"
          onClick={() => navigator.clipboard.writeText(
            buildPlainText(activeTab, activeTech, labels, totalBeats, colW, bpm, lyricsLines, tabStartSec)
          )}
        >
          Copy Tab
        </button>
      </div>
      <div className="ug-tab-scroll">
        {systems.map(({ start, end }, sysIdx) => {
          const words = sysLyrics(start, end, bpm, lyricsLines, tabStartSec);
          const secsPerCol = 60 / ((bpm || 120) * SUBDIVISIONS);
          const absStart = tabStartSec + start * secsPerCol;
          const absEnd   = tabStartSec + end   * secsPerCol;
          const lyricsActive = words && lyricsCurrentTime !== null
            && lyricsCurrentTime >= absStart && lyricsCurrentTime < absEnd;
          return (
            <div key={sysIdx} className="ug-tab-system">
              {labels.map((label, si) => (
                <div key={si} className="ug-tab-row">
                  <span className="ug-tab-label">{label}|</span>
                  {Array.from({ length: end - start }, (_, i) => {
                    const bi = start + i;
                    const isActive = bi === playheadBeat;
                    const isBarEnd = (bi + 1) % COLS_PER_MEASURE === 0 || bi === totalBeats - 1;
                    return (
                      <span key={bi} ref={si === 0 && isActive ? activeRef : null}>
                        <BeatCell
                          val={activeTab[si]?.[bi] ?? null}
                          tech={activeTech[si]?.[bi] ?? null}
                          colW={colW[bi]}
                          isActive={isActive}
                        />
                        {isBarEnd && <span className="ug-beat">|</span>}
                      </span>
                    );
                  })}
                </div>
              ))}
              {words && (
                <div className={`ug-tab-lyrics${lyricsActive ? ' ug-tab-lyrics-active' : ''}`}>
                  {words}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
