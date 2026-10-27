// Open-string MIDI values — index 0 = highest string (top of grid)
const OPEN_MIDIS = {
  6: [64, 59, 55, 50, 45, 40],      // e B G D A E
  7: [64, 59, 55, 50, 45, 40, 35],  // + low B
  4: [43, 38, 33, 28],              // G D A E (bass)
};

export const STRING_LABELS = {
  6: ['e', 'B', 'G', 'D', 'A', 'E'],
  7: ['e', 'B', 'G', 'D', 'A', 'E', 'B'],
  4: ['G', 'D', 'A', 'E'],
};

// Each tab column = one 16th note, so fast runs land in distinct columns
export const SUBDIVISIONS = 4;
export const COLS_PER_MEASURE = 4 * SUBDIVISIONS; // 16

function findPosition(notes, openMidis) {
  let bestPos = 0, bestCount = -1;
  for (let pos = 0; pos <= 20; pos++) {
    let count = 0;
    for (const note of notes) {
      for (const open of openMidis) {
        const fret = note.pitchMidi - open;
        if (fret >= pos && fret <= pos + 4) { count++; break; }
      }
    }
    if (count > bestCount) { bestCount = count; bestPos = pos; }
  }
  return bestPos;
}

export function notesToTab(notes, bpm, stringCount) {
  const openMidis = OPEN_MIDIS[stringCount];
  const colsPerSec = (bpm / 60) * SUBDIVISIONS;
  const position = findPosition(notes, openMidis);

  let maxCol = 0;
  for (const note of notes) {
    const col = Math.round(note.startTimeSeconds * colsPerSec);
    if (col > maxCol) maxCol = col;
  }
  const totalBeats = Math.max(
    COLS_PER_MEASURE * 2,
    Math.ceil((maxCol + COLS_PER_MEASURE) / COLS_PER_MEASURE) * COLS_PER_MEASURE,
  );

  const tab = Array.from({ length: stringCount }, () => new Array(totalBeats).fill(null));
  const techniques = Array.from({ length: stringCount }, () => new Array(totalBeats).fill(null));

  const colMap = new Map();
  for (const note of notes) {
    const col = Math.round(note.startTimeSeconds * colsPerSec);
    if (col >= totalBeats) continue;
    if (!colMap.has(col)) colMap.set(col, []);
    colMap.get(col).push(note);
  }

  // Track per-string note assignments for technique detection
  const stringNotes = Array.from({ length: stringCount }, () => []);

  for (const [col, colNotes] of colMap) {
    const sorted = [...colNotes].sort((a, b) => b.amplitude - a.amplitude);
    const used = new Set();
    for (const note of sorted) {
      const candidates = [];
      for (let si = 0; si < openMidis.length; si++) {
        const fret = note.pitchMidi - openMidis[si];
        if (fret < 0 || fret > 24) continue;
        candidates.push({ si, fret, inPos: fret >= position && fret <= position + 4 });
      }
      const best =
        candidates.find(c => c.inPos && !used.has(c.si)) ||
        candidates.find(c => !used.has(c.si)) ||
        candidates.find(c => c.inPos) ||
        candidates[0];
      if (best) {
        tab[best.si][col] = best.fret;
        used.add(best.si);
        stringNotes[best.si].push({
          col,
          fret: best.fret,
          startTime: note.startTimeSeconds,
          endTime: note.startTimeSeconds + (note.durationSeconds || 0),
        });
      }
    }
  }

  // Detect guitar techniques between consecutive notes on the same string:
  //   bend (b)    — notes overlap in time (second starts before first ends), ascending
  //   hammer-on   — gap < 90ms, ascending pitch
  //   pull-off    — gap < 90ms, descending pitch
  //   slide up    — gap 90-350ms, ascending, within 7 frets
  //   slide down  — gap 90-350ms, descending, within 7 frets
  for (let si = 0; si < stringCount; si++) {
    const sNotes = stringNotes[si].sort((a, b) => a.col - b.col);
    for (let i = 0; i < sNotes.length - 1; i++) {
      const n1 = sNotes[i];
      const n2 = sNotes[i + 1];
      const gap = n2.startTime - n1.endTime;
      const fretDiff = n2.fret - n1.fret;
      if (fretDiff === 0) continue;

      if (gap < -0.03) {
        // Notes overlap: bend (ascending only)
        if (fretDiff > 0) techniques[si][n1.col] = 'b';
      } else if (gap < 0.09) {
        // Very fast legato: hammer-on or pull-off
        techniques[si][n1.col] = fretDiff > 0 ? 'h' : 'p';
      } else if (gap < 0.35 && Math.abs(fretDiff) <= 7) {
        // Moderate gap: slide
        techniques[si][n1.col] = fretDiff > 0 ? '/' : '\\';
      }
    }
  }

  // Split into lead (single-note columns) and rhythm (multi-note columns)
  const leadTab        = Array.from({ length: stringCount }, () => new Array(totalBeats).fill(null));
  const leadTechniques = Array.from({ length: stringCount }, () => new Array(totalBeats).fill(null));
  const rhythmTab        = Array.from({ length: stringCount }, () => new Array(totalBeats).fill(null));
  const rhythmTechniques = Array.from({ length: stringCount }, () => new Array(totalBeats).fill(null));

  for (let col = 0; col < totalBeats; col++) {
    let count = 0;
    for (let si = 0; si < stringCount; si++) {
      if (tab[si][col] !== null) count++;
    }
    if (count === 1) {
      for (let si = 0; si < stringCount; si++) {
        leadTab[si][col]        = tab[si][col];
        leadTechniques[si][col] = techniques[si][col];
      }
    } else if (count >= 2) {
      for (let si = 0; si < stringCount; si++) {
        rhythmTab[si][col]        = tab[si][col];
        rhythmTechniques[si][col] = techniques[si][col];
      }
    }
  }

  return { tab, techniques, leadTab, leadTechniques, rhythmTab, rhythmTechniques, totalBeats };
}
