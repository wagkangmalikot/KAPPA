// Pentatonic fretboard explorer — ported from the standalone pentatonic-fretboard app.
// mountPentatonic() owns everything inside `root`: it renders the markup once and
// then updates the DOM directly, so React only provides the container.
import { createBand, PARTS, STYLE_OPTIONS } from './band';
import { announcePlayback, onPlaybackStart } from '../playbackBus';

const rocker = (group, options) => `
  <div class="pt-rocker" data-rocker="${group}">
    <span class="pt-rocker-thumb"></span>
    ${options.map(([value, label]) => `<button type="button" class="pt-rocker-half" data-value="${value}" aria-pressed="false">${label}</button>`).join('')}
  </div>`;
const SCALE_TYPE_OPTIONS = [['major', 'Major'], ['minor', 'Minor']];
const NOTE_SET_OPTIONS = [['pentatonic', 'Penta'], ['full', 'Scale'], ['blues', 'Blues']];
const VIEW_OPTIONS = [['pattern', 'Pattern'], ['chords', 'Chords']];

// Desktop: settings + band live in the side panel. Phone: key controls become a
// chip bar above the fretboard, and the panel turns into a bottom sheet (⚙).
// The transport bar at the bottom is always present on both.
const TEMPLATE = `
<div class="workspace">
  <aside class="controls-panel pt-panel" data-el="panel" aria-label="Pentatonic settings">
    <div class="pt-sheet-head">
      <span>Settings</span>
      <button type="button" class="pt-sheet-close" data-el="sheetClose" aria-label="Close settings">✕</button>
    </div>
    <div class="pt-desktop-only">
      <div class="panel-label">Key</div>
      <div class="pt-root-row" data-el="rootRow"></div>
    </div>
    <div class="pt-desktop-only">
      <div class="panel-label">Scale</div>
      ${rocker('scaleType', SCALE_TYPE_OPTIONS)}
    </div>
    <div class="pt-desktop-only">
      <div class="panel-label">Notes</div>
      ${rocker('noteSet', NOTE_SET_OPTIONS)}
    </div>
    <div class="pt-desktop-only">
      <div class="panel-label">Layout</div>
      ${rocker('view', VIEW_OPTIONS)}
    </div>
    <div>
      <div class="panel-label pt-label-row"><span>Position</span><span class="pt-hint">one box shape</span></div>
      <div class="pt-pos-row" data-el="posRow"></div>
    </div>
    <div class="pt-panel-group">
      <div class="panel-label">Band</div>
      <div class="pt-band-row">
        <label class="pt-field"><span>Style</span><select class="pt-select" data-el="styleSelect"></select></label>
        <label class="pt-check"><input type="checkbox" data-el="countInBox" checked /> Count-in</label>
      </div>
      <div class="pt-mixer" data-el="mixer"></div>
    </div>
    <div class="pt-panel-foot">
      <div class="pt-shortcuts">Keys: <kbd>Space</kbd> play/stop · <kbd>←</kbd><kbd>→</kbd> key · <kbd>↑</kbd><kbd>↓</kbd> tempo</div>
      <div class="pt-credit">Sounds: Salamander Drumkit by Alexander Holm (CC BY-SA 3.0) · tonejs-instruments by Nicholas Brosowsky (CC BY 3.0)</div>
    </div>
  </aside>

  <div class="main-area pt-main">
    <div class="pt-chipbar pt-mobile-only">
      <select class="pt-chip" data-el="rootSelect" aria-label="Key"></select>
      ${rocker('scaleType', SCALE_TYPE_OPTIONS)}
      <select class="pt-chip" data-el="noteSetSelect" aria-label="Notes">
        ${NOTE_SET_OPTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
      </select>
      <button type="button" class="pt-chip pt-chip-icon" data-el="sheetOpen" aria-label="More settings: position, band, mixer" aria-expanded="false">⚙</button>
    </div>

    <div class="pt-header" aria-live="polite">
      <div class="pt-header-main">
        <span class="pt-header-key" data-el="lcdRoot"></span>
        <span class="pt-header-notes" data-el="lcdNotes"></span>
      </div>
      <div class="pt-header-meta">
        <span data-el="lcdView"></span>
        <span class="pt-header-range" data-el="lcdRange"></span>
        <button type="button" class="pt-info-btn" data-el="infoBtn" aria-expanded="false" aria-controls="pt-caption" title="About this scale">i</button>
      </div>
    </div>
    <div class="pt-caption" id="pt-caption" data-el="lcdCaption" hidden></div>

    <div class="pt-fb-wrap">
      <div class="pt-fb-inner">
        <div class="pt-fb-strlabels" data-el="fbStrLabels"></div>
        <div>
          <div class="pt-fretboard" data-el="fretboard"></div>
          <div class="pt-fret-numbers" data-el="fretNumbers"></div>
        </div>
      </div>
      <div class="pt-fb-legend">
        <span><i class="pt-key pt-key-root"></i>key root</span>
        <span><i class="pt-key pt-key-active"></i><span data-el="legendActive">scale note</span></span>
        <span data-el="legendOutside"><i class="pt-key pt-key-outside"></i>chord note outside the scale</span>
      </div>
    </div>

    <div class="pt-grid">
      <section class="pt-card">
        <div class="panel-label pt-label-row" data-el="stageLabel"></div>
        <div class="pt-mobile-only pt-stage-switch">${rocker('view', VIEW_OPTIONS)}</div>
        <div class="pt-stage" data-el="stage"></div>
      </section>

      <section class="pt-card">
        <div class="panel-label pt-label-row"><span>Progression</span><span class="pt-hint">1 bar per chord · tap a bar to preview</span></div>
        <div class="pt-prog-row" data-el="progRow"></div>
        <p class="pt-prog-empty" data-el="progEmpty">No progression yet — generate one, start a 12-bar blues, or tap <b>+</b> on a chord.</p>
        <div class="pt-actions">
          <button type="button" class="btn-action pt-btn-inline" data-el="progBtn">Generate</button>
          <button type="button" class="btn-action pt-btn-inline pt-btn-alt" data-el="bluesBtn">12-Bar Blues</button>
          <button type="button" class="btn-copy" data-el="progClearBtn" hidden>Clear</button>
        </div>
      </section>
    </div>

    <details class="pt-card pt-lick" data-el="lickDetails">
      <summary class="panel-label pt-label-row"><span>Lick Generator</span><span class="pt-hint">random phrase, single position</span></summary>
      <div class="pt-actions">
        <button type="button" class="btn-action pt-btn-inline" data-el="lickBtn">Generate Lick</button>
        <button type="button" class="btn-copy" data-el="lickClearBtn" hidden>Clear</button>
      </div>
      <pre class="pt-tab" data-el="tabOutput" hidden></pre>
      <div class="pt-tab-legend" data-el="tabLegend" hidden>
        <span class="tab-tech tab-tech-hammer">h</span> hammer-on &nbsp;·&nbsp;
        <span class="tab-tech tab-tech-pull">p</span> pull-off &nbsp;·&nbsp;
        <span class="tab-tech tab-tech-bend">b</span> bend
      </div>
    </details>
  </div>
</div>

<div class="pt-backdrop" data-el="backdrop" hidden></div>

<div class="pt-transport" data-el="transport">
  <button type="button" class="transport-btn transport-btn-play" data-el="playBtn">▶ Play</button>
  <div class="pt-mini-chord">
    <span class="pt-mini-now" data-el="miniNow"></span>
    <span class="pt-mini-next" data-el="miniNext"></span>
  </div>
  <span class="pt-mini-count" data-el="miniCount"></span>
  <span class="pt-transport-status" data-el="bandStatus" hidden></span>
  <span class="pt-mini-style pt-desktop-only" data-el="miniStyle"></span>
  <div class="pt-mini-bpm">
    <button type="button" data-el="bpmDown" aria-label="Slower">−</button>
    <input class="pt-bpm-input" data-el="bpmInput" type="number" inputmode="numeric" min="40" max="240" step="1" value="100" aria-label="Tempo in BPM" />
    <span class="pt-bpm-unit">bpm</span>
    <button type="button" data-el="bpmUp" aria-label="Faster">+</button>
  </div>
</div>
`;

/* ---------- note spelling ----------
   Notes are spelled by letter from the key (C7 is C E G B♭, not A♯), and keys
   are named the way they're written: B♭ major, not A♯ major. */
const LETTERS = 'CDEFGAB';
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const KEY_NAMES = {
  major: ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'],
  minor: ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'],
};
// keys whose signature is written with flats
const FLAT_KEYS = { major: ['F'], minor: ['D', 'G', 'C', 'F'] };
const AWKWARD = ['F♭', 'C♭', 'E♯', 'B♯'];
const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7 };

const keyPrefersFlats = (keyName, scaleType) => keyName.includes('♭') || FLAT_KEYS[scaleType].includes(keyName);
const degreeOfLabel = label => parseInt(label.replace(/[^0-9]/g, ''), 10);
const degreeOfNumeral = numeral => ROMAN[numeral.replace(/[^IViv]/g, '').toUpperCase()];

// the note `semis` above `baseName`, written as scale degree `degree` of it
function spellFrom(baseName, semis, degree, preferFlats) {
  const li = LETTERS.indexOf(baseName[0]);
  const acc = baseName[1] === '♯' ? 1 : baseName[1] === '♭' ? -1 : 0;
  const pc = (LETTER_PC[li] + acc + semis + 24) % 12;
  const tli = (li + degree - 1) % 7;
  let diff = ((pc - LETTER_PC[tli]) % 12 + 12) % 12;
  if (diff > 6) diff -= 12;
  const name = LETTERS[tli] + (diff === 1 ? '♯' : diff === -1 ? '♭' : '');
  // fall back to the plain enharmonic for double accidentals and F♭ / C♭ / E♯ / B♯
  if (Math.abs(diff) > 1 || AWKWARD.includes(name)) return (preferFlats ? FLAT_NAMES : SHARP_NAMES)[pc];
  return name;
}

const SCALE_TONES = {
  major: {
    pentatonic: { intervals: [0, 2, 4, 7, 9], degreeLabels: ['1', '2', '3', '5', '6'] },
    full: { intervals: [0, 2, 4, 5, 7, 9, 11], degreeLabels: ['1', '2', '3', '4', '5', '6', '7'] },
    blues: { intervals: [0, 2, 3, 4, 7, 9], degreeLabels: ['1', '2', '♭3', '3', '5', '6'] },
  },
  minor: {
    pentatonic: { intervals: [0, 3, 5, 7, 10], degreeLabels: ['1', '♭3', '4', '5', '♭7'] },
    full: { intervals: [0, 2, 3, 5, 7, 8, 10], degreeLabels: ['1', '2', '♭3', '4', '5', '♭6', '♭7'] },
    blues: { intervals: [0, 3, 5, 6, 7, 10], degreeLabels: ['1', '♭3', '4', '♭5', '5', '♭7'] },
  },
};
const CHORD_TONES = {
  major: {
    pentatonic: { intervals: [0, 2, 4, 7, 9], qualities: ['maj', 'min', 'min', 'maj', 'min'], numerals: ['I', 'ii', 'iii', 'V', 'vi'] },
    full: { intervals: [0, 2, 4, 5, 7, 9, 11], qualities: ['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim'], numerals: ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'] },
    blues: { intervals: [0, 2, 4, 7, 9], qualities: ['maj', 'min', 'min', 'maj', 'min'], numerals: ['I', 'ii', 'iii', 'V', 'vi'] },
  },
  minor: {
    pentatonic: { intervals: [0, 3, 5, 7, 10], qualities: ['min', 'maj', 'min', 'min', 'maj'], numerals: ['i', 'III', 'iv', 'v', 'VII'] },
    full: { intervals: [0, 2, 3, 5, 7, 8, 10], qualities: ['min', 'dim', 'maj', 'min', 'min', 'maj', 'maj'], numerals: ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'] },
    blues: { intervals: [0, 3, 5, 7, 10], qualities: ['min', 'maj', 'min', 'min', 'maj'], numerals: ['i', 'III', 'iv', 'v', 'VII'] },
  },
};
const CHORD_SHAPES = { maj: [0, 4, 7], min: [0, 3, 7], dim: [0, 3, 6], dom7: [0, 4, 7, 10], min7: [0, 3, 7, 10] };
const CHORD_SUFFIX = { maj: '', min: 'm', dim: '°', dom7: '7', min7: 'm7' };

// Progression steps are stored relative to the key ({ offset, quality, numeral }),
// so they transpose with the root and can hold chords outside the current scale.
const TWELVE_BAR = {
  major: [[0, 'I7'], [0, 'I7'], [0, 'I7'], [0, 'I7'], [5, 'IV7'], [5, 'IV7'], [0, 'I7'], [0, 'I7'], [7, 'V7'], [5, 'IV7'], [0, 'I7'], [7, 'V7']]
    .map(([offset, numeral]) => ({ offset, quality: 'dom7', numeral })),
  minor: [[0, 'i'], [0, 'i'], [0, 'i'], [0, 'i'], [5, 'iv'], [5, 'iv'], [0, 'i'], [0, 'i'], [8, '♭VI7'], [7, 'V7'], [0, 'i'], [7, 'V7']]
    .map(([offset, numeral]) => ({ offset, quality: offset === 0 || offset === 5 ? 'min7' : 'dom7', numeral })),
};

// string 1 (high e) first .. string 6 (low E) last, matching standard tab order top-to-bottom
const STRINGS = [
  { name: 'e', pc: 4 },
  { name: 'B', pc: 11 },
  { name: 'G', pc: 7 },
  { name: 'D', pc: 2 },
  { name: 'A', pc: 9 },
  { name: 'E', pc: 4 },
];
const OPEN_MIDI = [64, 59, 55, 50, 45, 40];
const FRET_COUNT = 17;
const MIN_FRET_W = 38; // below this the board scrolls sideways instead
const MAX_FRET_W = 64;
const NUT_W = 26;
const ROW_H = 34;
const INLAY_FRETS = [3, 5, 7, 9, 12, 15, 17];
const FRET_NUMBER_LABELS = [0, 3, 5, 7, 9, 12, 15, 17];

const CAPTIONS = {
  pentatonic: "Five tones, no half-step clashes — the shared root of blues, rock, folk and countless other traditions' lead lines. Root sets the key; tap a degree below to isolate it on the neck, or switch to Chords to see the triads built from these notes.",
  full: 'The complete seven-note scale, including the two tones pentatonic leaves out — closer intervals, more color, and an avoid note or two to navigate. Switch Notes back to Penta for the simplified five-tone form.',
  blues: "Pentatonic plus the ♭5 — the “blue note” whose clash against the natural 5th is the whole sound of blues, rock and jazz-blues phrasing. It doesn't slot into a clean fixed-count box shape, so position windows here are sized to fit the full scale rather than an even number per string.",
};
const NOTESET_LABEL = { pentatonic: 'PENTATONIC', full: 'SCALE', blues: 'BLUES SCALE' };

function pcOct(basePc, baseOct, addIv) {
  const total = basePc + addIv;
  return { pc: ((total % 12) + 12) % 12, octave: baseOct + Math.floor(total / 12) };
}

export function mountPentatonic(root) {
  root.innerHTML = TEMPLATE;
  const el = name => root.querySelector(`[data-el="${name}"]`);

  const state = {
    root: 0, scaleType: 'major', noteSet: 'pentatonic', view: 'pattern',
    chordIndex: 0, degreesOn: [true, true, true, true, true], lick: null, position: null,
    progression: null, // [{ offset, quality, numeral }]
    currentStep: null, // progression step shown on the neck, or null when a chord tile is
  };
  const band = createBand();

  const currentScale = () => SCALE_TONES[state.scaleType][state.noteSet];
  const currentChords = () => CHORD_TONES[state.scaleType][state.noteSet];
  const degreeCount = () => currentScale().intervals.length;
  const freshDegreesOn = () => Array.from({ length: degreeCount() }, () => true);

  const keyName = () => KEY_NAMES[state.scaleType][state.root];
  const prefersFlats = () => keyPrefersFlats(keyName(), state.scaleType);

  // scale tones with their spelled names: [{ pc, octave, name }]
  function scaleNotes() {
    const s = currentScale();
    return s.intervals.map((iv, i) => ({
      ...pcOct(state.root, 4, iv),
      name: spellFrom(keyName(), iv, degreeOfLabel(s.degreeLabels[i]), prefersFlats()),
    }));
  }
  function scalePcSet() {
    const set = {};
    scaleNotes().forEach(n => { set[n.pc] = true; });
    return set;
  }
  function buildChord({ offset, quality, numeral }) {
    const chordRoot = pcOct(state.root, 4, offset);
    const rootName = spellFrom(keyName(), offset, degreeOfNumeral(numeral), prefersFlats());
    const flats = prefersFlats() || rootName.includes('♭');
    const tones = CHORD_SHAPES[quality].map((tIv, i) => ({
      ...pcOct(chordRoot.pc, chordRoot.octave, tIv),
      name: spellFrom(rootName, tIv, [1, 3, 5, 7][i], flats),
    }));
    return { offset, rootPc: chordRoot.pc, quality, numeral, symbol: rootName + CHORD_SUFFIX[quality], tones };
  }
  function chordList() {
    const c = currentChords();
    return c.intervals.map((offset, i) => buildChord({ offset, quality: c.qualities[i], numeral: c.numerals[i] }));
  }
  // the chord lit on the neck in Chords layout: a progression step, or the selected tile
  function displayedChord() {
    if (state.currentStep !== null && state.progression && state.progression[state.currentStep]) {
      return buildChord(state.progression[state.currentStep]);
    }
    return chordList()[state.chordIndex];
  }

  // Box window for one scale degree, anchored where that degree first appears on
  // the low E string. Searches for the narrowest window (start may sit up to 2
  // frets before the anchor) giving every string exactly the target note count —
  // 2 for pentatonic, 3 for the full scale. Blues has no clean fixed count, so it
  // falls back to the narrowest window where every string has at least one note.
  function rawPositionWindow(degreeIndex) {
    const iv = currentScale().intervals[degreeIndex];
    const lowEPc = STRINGS[5].pc;
    const targetPc = pcOct(state.root, 4, iv).pc;
    const anchorFret = ((targetPc - lowEPc) % 12 + 12) % 12;
    const scalePcs = scalePcSet();
    const notesPerString = state.noteSet === 'pentatonic' ? 2 : state.noteSet === 'full' ? 3 : null;
    const maxWidth = state.noteSet === 'pentatonic' ? 6 : 5;

    const countsFor = (start, end) => STRINGS.map(s => {
      let c = 0;
      for (let f = start; f <= end; f++) { if (scalePcs[(s.pc + f) % 12]) c++; }
      return c;
    });

    function search(minWidth, maxW, accept) {
      for (let width = minWidth; width <= maxW; width++) {
        for (let startOff = -2; startOff <= 0; startOff++) {
          const start = anchorFret + startOff;
          if (start < 0) continue;
          const end = Math.min(FRET_COUNT, start + width);
          if (anchorFret < start || anchorFret > end) continue;
          if (countsFor(start, end).every(accept)) return { start, end };
        }
      }
      return null;
    }

    return (notesPerString !== null && search(notesPerString, maxWidth, c => c === notesPerString))
      || search(3, 8, c => c >= 1)
      // open-position edge case: no clean box exists this close to the nut
      || { start: anchorFret, end: Math.min(FRET_COUNT, anchorFret + 5) };
  }

  // Different degrees can land on the same window; collapse duplicates and order
  // by fret so "Position 1" is always the lowest on the neck.
  function computePositions() {
    const seen = {};
    const list = [];
    for (let i = 0; i < degreeCount(); i++) {
      const win = rawPositionWindow(i);
      const key = win.start + '_' + win.end;
      if (key in seen) {
        list[seen[key]].degrees.push(i);
      } else {
        seen[key] = list.length;
        list.push({ win, degrees: [i] });
      }
    }
    return list.sort((a, b) => a.win.start - b.win.start);
  }
  const positionWindow = i => computePositions()[i].win;

  // active pc -> label map for whatever is currently highlighted on the neck
  function activeMap() {
    const map = {};
    if (state.view === 'pattern') {
      scaleNotes().forEach((n, i) => {
        if (state.degreesOn[i]) map[n.pc] = n.name;
      });
    } else {
      displayedChord().tones.forEach(t => { map[t.pc] = t.name; });
    }
    return map;
  }

  /* ---------- fretboard ---------- */
  const fbWrapEl = root.querySelector('.pt-fb-wrap');
  const fretboardEl = el('fretboard');
  const fretNumbersEl = el('fretNumbers');
  const strLabelsEl = el('fbStrLabels');
  let fretW = MIN_FRET_W;
  const fretX = f => (f === 0 ? NUT_W / 2 : NUT_W + (f - 0.5) * fretW);

  // Stretch the frets to fill the card; narrow screens keep the minimum and scroll.
  // Returns false while the tab is hidden (nothing to measure).
  function fitFretWidth() {
    const style = getComputedStyle(fbWrapEl);
    const inner = fbWrapEl.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    if (inner <= 0) return false;
    const available = inner - strLabelsEl.offsetWidth - 8 - NUT_W;
    fretW = Math.max(MIN_FRET_W, Math.min(MAX_FRET_W, Math.floor(available / FRET_COUNT)));
    return true;
  }

  function layoutFretboard() {
    const before = fretW;
    if (!fitFretWidth() || (fretW === before && fretboardEl.childElementCount)) return;
    buildFretboardChrome();
    paintFretboard();
  }

  function buildFretboardChrome() {
    fretboardEl.innerHTML = '';
    fretNumbersEl.innerHTML = '';
    strLabelsEl.innerHTML = '';
    const totalW = NUT_W + FRET_COUNT * fretW;
    const totalH = STRINGS.length * ROW_H;
    fretboardEl.style.width = totalW + 'px';
    fretboardEl.style.height = totalH + 'px';
    fretNumbersEl.style.width = totalW + 'px';
    fretNumbersEl.style.height = '16px';

    for (let f = 0; f <= FRET_COUNT; f++) {
      const line = document.createElement('div');
      line.className = 'pt-fret-line' + (f === 0 ? ' nut' : '');
      line.style.left = (f === 0 ? NUT_W : NUT_W + f * fretW) + 'px';
      fretboardEl.appendChild(line);
    }
    STRINGS.forEach((s, si) => {
      const line = document.createElement('div');
      line.className = 'pt-string';
      line.style.top = (si * ROW_H + ROW_H / 2) + 'px';
      line.style.height = (1 + si * 0.3) + 'px';
      fretboardEl.appendChild(line);

      const label = document.createElement('span');
      label.textContent = s.name;
      strLabelsEl.appendChild(label);
    });
    const midY = totalH / 2;
    INLAY_FRETS.forEach(f => {
      const ys = f === 12 ? [midY - 9, midY + 9] : [midY];
      ys.forEach(y => {
        const dot = document.createElement('div');
        dot.className = 'pt-inlay';
        dot.style.left = fretX(f) + 'px';
        dot.style.top = y + 'px';
        fretboardEl.appendChild(dot);
      });
    });
    FRET_NUMBER_LABELS.forEach(f => {
      const lbl = document.createElement('span');
      lbl.style.left = fretX(f) + 'px';
      lbl.textContent = f;
      fretNumbersEl.appendChild(lbl);
    });
  }

  function paintFretboard() {
    fretboardEl.querySelectorAll('.pt-note').forEach(n => n.remove());
    const scalePcs = scalePcSet();
    const active = activeMap();
    const lickMap = state.lick ? lickPositionMap(state.lick) : null;
    const posWin = state.position !== null ? positionWindow(state.position) : null;
    STRINGS.forEach((s, si) => {
      for (let f = 0; f <= FRET_COUNT; f++) {
        if (posWin && (f < posWin.start || f > posWin.end)) continue;
        const pc = (s.pc + f) % 12;
        const inScale = !!scalePcs[pc];
        // in Chords layout, chord tones outside the scale are drawn too, as outlines
        const outside = !inScale && state.view === 'chords' && !!active[pc];
        if (!inScale && !outside) continue;
        const dot = document.createElement('div');
        dot.className = 'pt-note' + (outside ? ' is-outside' : '');
        if (pc === state.root) dot.classList.add('is-root-ctx');
        const label = active[pc];
        if (label) {
          if (!outside) dot.classList.add('is-active');
          if (pc === state.root) dot.classList.add('is-root');
          dot.textContent = label;
        }
        const orders = lickMap && lickMap[si + '_' + f];
        if (orders) {
          dot.classList.add('has-lick');
          const badge = document.createElement('span');
          badge.className = 'pt-lick-badge';
          badge.textContent = orders.join('·');
          dot.appendChild(badge);
        }
        dot.style.left = fretX(f) + 'px';
        dot.style.top = (si * ROW_H + ROW_H / 2) + 'px';
        fretboardEl.appendChild(dot);
      }
    });
  }

  /* ---------- lick generator ---------- */
  function buildPositionPool() {
    const win = positionWindow(state.position !== null ? state.position : 0);
    const scalePcs = scalePcSet();
    const pool = [];
    STRINGS.forEach((s, si) => {
      for (let f = win.start; f <= win.end; f++) {
        const pc = (s.pc + f) % 12;
        if (scalePcs[pc]) pool.push({ si, fret: f, pc, midi: OPEN_MIDI[si] + f });
      }
    });
    return pool.sort((a, b) => a.midi - b.midi);
  }

  function generateLick() {
    const pool = buildPositionPool();
    if (pool.length < 3) return null;
    const rootIndices = [];
    pool.forEach((p, i) => { if (p.pc === state.root) rootIndices.push(i); });

    const count = 8 + Math.floor(Math.random() * 5);
    let idx = rootIndices.length
      ? rootIndices[Math.floor(Math.random() * rootIndices.length)]
      : Math.floor(Math.random() * pool.length);
    const events = [];
    for (let i = 0; i < count; i++) {
      events.push(pool[idx]);
      const r = Math.random();
      let step;
      if (r < 0.55) step = Math.random() < 0.5 ? -1 : 1;
      else if (r < 0.80) step = Math.random() < 0.5 ? -2 : 2;
      else if (r < 0.90) step = 0;
      else step = Math.random() < 0.5 ? -3 : 3;
      idx = Math.max(0, Math.min(pool.length - 1, idx + step));
    }
    // resolve to the nearest root
    if (rootIndices.length) {
      const last = events[events.length - 1];
      let nearest = rootIndices[0];
      rootIndices.forEach(ri => {
        if (Math.abs(pool[ri].midi - last.midi) < Math.abs(pool[nearest].midi - last.midi)) nearest = ri;
      });
      events[events.length - 1] = pool[nearest];
    }
    return { events, technique: assignTechniques(events) };
  }

  // h = hammer-on, p = pull-off, b = bend — only on same-string moves within reach
  function assignTechniques(events) {
    const technique = [null];
    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1];
      const cur = events[i];
      let t = null;
      if (cur.si === prev.si) {
        const d = cur.fret - prev.fret;
        if (d > 0 && d <= 2) t = Math.random() < 0.5 ? 'b' : 'h';
        else if (d > 2 && d <= 4) t = Math.random() < 0.7 ? 'h' : null;
        else if (d < 0 && d >= -4) t = Math.random() < 0.7 ? 'p' : null;
      }
      technique.push(t);
    }
    return technique;
  }

  function lickPositionMap(lick) {
    const map = {};
    lick.events.forEach((e, i) => {
      const key = e.si + '_' + e.fret;
      (map[key] = map[key] || []).push(String(i + 1) + (lick.technique[i] || ''));
    });
    return map;
  }

  // consecutive notes linked by a technique share one tab column, e.g. "5h7p5"
  function buildTabColumns(lick) {
    const columns = [];
    let cur = null;
    lick.events.forEach((e, i) => {
      const tech = lick.technique[i];
      if (cur && tech) {
        cur.text += tech + e.fret;
      } else {
        if (cur) columns.push(cur);
        cur = { si: e.si, text: String(e.fret) };
      }
    });
    if (cur) columns.push(cur);
    return columns;
  }

  function buildTabLines(lick) {
    const rows = STRINGS.map(s => s.name + '|-');
    buildTabColumns(lick).forEach(col => {
      for (let si = 0; si < STRINGS.length; si++) {
        rows[si] += (si === col.si ? col.text : '-'.repeat(col.text.length)) + '-';
      }
    });
    return rows.map(r => r + '|').join('\n');
  }

  function clearLick() {
    state.lick = null;
    el('tabOutput').hidden = true;
    el('tabLegend').hidden = true;
    el('lickClearBtn').hidden = true;
  }

  function renderLick() {
    const has = !!state.lick;
    if (has) el('tabOutput').textContent = buildTabLines(state.lick);
    el('tabOutput').hidden = !has;
    el('tabLegend').hidden = !has;
    el('lickClearBtn').hidden = !has;
    paintFretboard();
  }

  el('lickBtn').addEventListener('click', () => {
    const lick = generateLick();
    if (!lick) return;
    state.lick = lick;
    renderLick();
  });
  el('lickClearBtn').addEventListener('click', () => {
    clearLick();
    paintFretboard();
  });

  /* ---------- chord progression ---------- */
  // A 4-chord sequence from the current key's chords, leaving from and resolving
  // back to the tonic. Stepping through it lights that chord in the Chords layout.
  function generateProgression() {
    const c = currentChords();
    if (c.intervals.length < 2) return null;
    const seq = [0];
    for (let i = 1; i < 3; i++) {
      let next;
      do { next = Math.floor(Math.random() * c.intervals.length); } while (next === seq[seq.length - 1]);
      seq.push(next);
    }
    seq.push(0);
    return seq.map(i => ({ offset: c.intervals[i], quality: c.qualities[i], numeral: c.numerals[i] }));
  }

  function addChordToProgression(chordIdx) {
    const c = currentChords();
    if (!state.progression) state.progression = [];
    state.progression.push({ offset: c.intervals[chordIdx], quality: c.qualities[chordIdx], numeral: c.numerals[chordIdx] });
    renderAll();
  }

  function removeProgressionStep(step) {
    if (!state.progression) return;
    state.progression.splice(step, 1);
    if (!state.progression.length) {
      state.progression = null;
      stopPlayback();
    }
    state.currentStep = null;
    renderAll();
  }

  function clearProgression() {
    stopPlayback();
    state.progression = null;
    state.currentStep = null;
  }

  function showStep(step) {
    state.currentStep = step;
    state.view = 'chords';
  }

  function setProgression(seq) {
    const wasPlaying = band.playing;
    state.progression = seq;
    showStep(0);
    renderAll();
    if (wasPlaying) startPlayback();
  }

  function renderProgression() {
    const progRow = el('progRow');
    progRow.innerHTML = '';
    const has = !!(state.progression && state.progression.length);
    progRow.hidden = !has;
    el('progEmpty').hidden = has;
    el('progClearBtn').hidden = !has;
    if (!has) return;

    // laid out like a chord chart, four bars per line
    state.progression.forEach((def, step) => {
      const ch = buildChord(def);
      const wrap = document.createElement('div');
      wrap.className = 'pt-prog-step-wrap';

      const btn = document.createElement('button');
      btn.type = 'button';
      const isCurrent = state.view === 'chords' && state.currentStep === step;
      btn.className = 'pt-prog-step' + (isCurrent ? ' is-current' : '');
      btn.innerHTML = `<span class="rn">${ch.numeral}</span><span class="sym">${ch.symbol}</span>`;
      btn.addEventListener('click', () => {
        showStep(step);
        renderAll();
      });

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'pt-prog-remove';
      removeBtn.title = 'remove step';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', e => {
        e.stopPropagation();
        removeProgressionStep(step);
      });

      wrap.appendChild(btn);
      wrap.appendChild(removeBtn);
      progRow.appendChild(wrap);
    });
  }

  el('progBtn').addEventListener('click', () => {
    const seq = generateProgression();
    if (seq) setProgression(seq);
  });
  el('bluesBtn').addEventListener('click', () => {
    el('styleSelect').value = 'blues';
    band.setStyle('blues');
    setProgression(TWELVE_BAR[state.scaleType].map(s => ({ ...s })));
  });
  el('progClearBtn').addEventListener('click', () => {
    clearProgression();
    renderAll();
  });

  /* ---------- backing band ---------- */
  let loading = false;
  let startAborted = false; // another player started while our samples were loading

  const unsubscribePlayback = onPlaybackStart(source => {
    if (source === 'pentatonic') return;
    if (loading) startAborted = true;
    if (band.playing) stopPlayback();
  });

  function setBandStatus(text, isError) {
    const status = el('bandStatus');
    status.hidden = !text;
    status.textContent = text || '';
    status.classList.toggle('is-error', !!isError);
  }

  async function startPlayback() {
    if (!state.progression || !state.progression.length) {
      const seq = generateProgression();
      if (!seq) return;
      state.progression = seq;
    }
    loading = true;
    startAborted = false;
    announcePlayback('pentatonic');
    if (el('countInBox').checked) state.currentStep = null;
    updatePlayButtonUI();
    setBandStatus('Loading instruments… (first time only, about 10 MB)');
    try {
      await band.start({
        countIn: el('countInBox').checked,
        // read the progression live each bar, so edits while playing take effect
        getChord: bar => {
          const prog = state.progression;
          const step = bar % prog.length;
          return { ...buildChord(prog[step]), loopStart: step === 0 };
        },
        onBar: bar => {
          if (!state.progression || !state.progression.length) { stopPlayback(); return; }
          showStep(bar % state.progression.length);
          renderAll();
        },
      });
      setBandStatus(null);
      if (startAborted) band.stop();
    } catch (err) {
      setBandStatus(err.message, true);
    }
    loading = false;
    updatePlayButtonUI();
  }

  function stopPlayback() {
    band.stop();
    updatePlayButtonUI();
  }

  const updatePlayButtonUI = () => updateTransport();

  el('playBtn').addEventListener('click', () => {
    if (band.playing) stopPlayback(); else startPlayback();
  });
  [['bpmDown', -5], ['bpmUp', 5]].forEach(([name, delta]) => {
    el(name).addEventListener('click', () => {
      bpmInput.value = bpm + delta;
      applyBpm(true);
    });
  });

  let bpm = 100;
  const bpmInput = el('bpmInput');
  function applyBpm(commit) {
    let v = parseInt(bpmInput.value, 10);
    if (isNaN(v) || v <= 0) v = bpm;
    v = Math.max(40, Math.min(240, v));
    bpm = v;
    band.setBpm(v);
    if (commit) bpmInput.value = v;
    saveSettings();
  }
  bpmInput.addEventListener('input', () => applyBpm(false));
  bpmInput.addEventListener('change', () => applyBpm(true));

  const styleSelect = el('styleSelect');
  styleSelect.innerHTML = STYLE_OPTIONS.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
  styleSelect.addEventListener('change', () => {
    band.setStyle(styleSelect.value);
    updateTransport();
    saveSettings();
  });
  el('countInBox').addEventListener('change', saveSettings);

  const PART_LABELS = { drums: '🥁 Drums', bass: '🎸 Bass', guitar: '🎸 Guitar', keys: '🎹 Keys' };
  function buildMixer() {
    const mixer = el('mixer');
    const mix = band.getMix();
    mixer.innerHTML = '';
    PARTS.forEach(part => {
      const row = document.createElement('div');
      row.className = 'pt-mix-row';
      row.innerHTML = `
        <button type="button" class="pt-mix-mute" aria-pressed="${mix[part].muted}">${PART_LABELS[part]}</button>
        <input type="range" class="pt-mix-vol" min="0" max="1" step="0.01" value="${mix[part].volume}" aria-label="${part} volume" />`;
      const mute = row.querySelector('.pt-mix-mute');
      mute.addEventListener('click', () => {
        const muted = mute.getAttribute('aria-pressed') !== 'true';
        mute.setAttribute('aria-pressed', String(muted));
        band.setMuted(part, muted);
        saveSettings();
      });
      row.querySelector('.pt-mix-vol').addEventListener('input', e => {
        band.setVolume(part, parseFloat(e.target.value));
        saveSettings();
      });
      mixer.appendChild(row);
    });
  }
  buildMixer();

  /* ---------- root row ---------- */
  function buildRootRow() {
    const rootRow = el('rootRow');
    rootRow.innerHTML = '';
    for (let pc = 0; pc < 12; pc++) {
      const btn = document.createElement('button');
      btn.className = 'pt-root-btn';
      btn.type = 'button';
      btn.dataset.pc = pc;
      // label is filled by renderAll, since it depends on major vs minor (D♭ vs C♯)
      btn.innerHTML = '<span class="pt-root-name"></span><span class="pt-dot"></span>';
      btn.addEventListener('click', () => setRoot(pc));
      rootRow.appendChild(btn);
    }
  }

  /* ---------- position row (one button per distinct box shape) ---------- */
  function buildPositionRow() {
    const posRow = el('posRow');
    posRow.innerHTML = '';
    const addBtn = (index, num, sub) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pt-pos-btn' + (state.position === index ? ' is-active' : '');
      btn.innerHTML = `<span class="num">${num}</span><span class="sub">${sub}</span>`;
      btn.addEventListener('click', () => {
        state.position = index;
        clearLick();
        renderAll();
      });
      posRow.appendChild(btn);
    };
    addBtn(null, 'ALL', 'neck');
    computePositions().forEach((p, i) => addBtn(i, i + 1, 'fret ' + p.win.start));
  }

  /* ---------- degree / chord stage ---------- */
  function buildStage() {
    const stageEl = el('stage');
    const stageLabelEl = el('stageLabel');
    stageEl.innerHTML = '';
    if (state.view === 'pattern') {
      stageLabelEl.innerHTML = '<span>Degrees</span><span class="pt-hint">tap to isolate</span>';
      const s = currentScale();
      scaleNotes().forEach((n, i) => {
        const peg = document.createElement('div');
        peg.className = 'pt-peg' + (state.degreesOn[i] ? ' is-active' : ' is-off');
        peg.innerHTML = `<div class="deg">${s.degreeLabels[i]}</div><div class="name">${n.name}</div>`;
        peg.addEventListener('click', () => {
          state.degreesOn[i] = !state.degreesOn[i];
          renderAll();
        });
        stageEl.appendChild(peg);
      });
    } else {
      stageLabelEl.innerHTML = '<span>Chords</span><span class="pt-hint">tap to select</span>';
      const shown = displayedChord();
      chordList().forEach((ch, i) => {
        const tile = document.createElement('div');
        tile.className = 'pt-tile' + (ch.rootPc === shown.rootPc ? ' is-active' : '');
        const noteStr = ch.tones.map(t => t.name).join(' · ');
        tile.innerHTML = `<button type="button" class="pt-tile-add" title="add to progression">+</button><span class="rn">${ch.numeral}</span><div class="sym">${ch.symbol}</div><div class="notes">${noteStr}</div>`;
        tile.addEventListener('click', () => {
          state.chordIndex = i;
          state.currentStep = null;
          renderAll();
        });
        tile.querySelector('.pt-tile-add').addEventListener('click', e => {
          e.stopPropagation();
          addChordToProgression(i);
        });
        stageEl.appendChild(tile);
      });
    }
  }

  function updateLcd() {
    el('lcdRoot').textContent =
      `${keyName()} ${state.scaleType === 'major' ? 'MAJOR' : 'MINOR'} ${NOTESET_LABEL[state.noteSet]}`;
    el('lcdCaption').textContent = CAPTIONS[state.noteSet];
    el('lcdView').textContent =
      state.view.toUpperCase() + (state.position !== null ? ' · POS ' + (state.position + 1) : '');
    if (state.position !== null) {
      const win = positionWindow(state.position);
      el('lcdRange').textContent = `FRETS ${win.start}–${win.end}`;
    } else {
      el('lcdRange').textContent = 'STANDARD TUNING';
    }
    if (state.view === 'pattern') {
      el('lcdNotes').textContent = scaleNotes().map(n => n.name).join(' · ');
    } else {
      const ch = displayedChord();
      el('lcdNotes').textContent = `${ch.numeral} ${ch.symbol}  (${ch.tones.map(t => t.name).join(' · ')})`;
    }
    el('legendActive').textContent = state.view === 'pattern' ? 'scale note' : 'chord note';
    el('legendOutside').hidden = state.view !== 'chords';
  }

  // The bottom bar: play button, what's playing / up next, tempo.
  function updateTransport() {
    const btn = el('playBtn');
    btn.disabled = loading;
    btn.textContent = loading ? 'Loading…' : band.playing ? '⏹ Stop' : '▶ Play';
    el('miniStyle').textContent = styleSelect.selectedOptions[0]?.textContent || '';

    const prog = state.progression;
    const has = !!prog && prog.length > 0;
    let now = '';
    let next = '';
    let count = '';
    if (loading) {
      now = 'Loading…';
    } else if (band.playing && has && state.currentStep !== null && prog[state.currentStep]) {
      const cur = buildChord(prog[state.currentStep]);
      now = `${cur.symbol} · ${cur.numeral}`;
      next = `next ${buildChord(prog[(state.currentStep + 1) % prog.length]).symbol}`;
      count = `bar ${state.currentStep + 1} / ${prog.length}`;
    } else if (band.playing) {
      now = 'Count-in…';
    } else if (has) {
      now = `${prog.length} bar${prog.length === 1 ? '' : 's'}`;
      next = `starts on ${buildChord(prog[0]).symbol}`;
    } else {
      now = 'Ready';
      next = 'Play starts a random progression';
    }
    el('miniNow').textContent = now;
    el('miniNext').textContent = next;
    el('miniCount').textContent = count;
  }

  function renderAll() {
    const pcs = scalePcSet();
    root.querySelectorAll('.pt-root-btn').forEach(b => {
      const pc = parseInt(b.dataset.pc, 10);
      b.querySelector('.pt-root-name').textContent = KEY_NAMES[state.scaleType][pc];
      b.classList.toggle('is-root', pc === state.root);
      b.classList.toggle('in-scale', !!pcs[pc] && pc !== state.root);
    });
    paintFretboard();
    buildPositionRow();
    buildStage();
    renderProgression();
    updateLcd();
    syncControls();
    updateTransport();
    saveSettings();
  }

  /* ---------- settings changes ----------
     Desktop switches, phone chips and keyboard shortcuts all go through these,
     and renderAll() → syncControls() brings every control back in line. */
  function setRoot(pc) {
    state.root = pc;
    clearLick();
    renderAll();
  }
  function setScaleType(v) {
    state.scaleType = v;
    state.degreesOn = freshDegreesOn();
    state.chordIndex = 0;
    state.position = null;
    clearLick();
    renderAll();
  }
  function setNoteSet(v) {
    state.noteSet = v;
    state.degreesOn = freshDegreesOn();
    state.chordIndex = 0;
    state.position = null;
    clearLick();
    clearProgression();
    renderAll();
  }
  function setView(v) {
    state.view = v;
    renderAll();
  }

  /* ---------- segmented switches ---------- */
  // A setting can have a switch in the panel and another on the phone layout
  // (data-rocker groups them). Options are equal-width, so the thumb is placed
  // in percentages: it stays right through resizes and while the tab is hidden.
  function syncRocker(group, value) {
    root.querySelectorAll(`[data-rocker="${group}"]`).forEach(r => {
      const thumb = r.querySelector('.pt-rocker-thumb');
      const halves = [...r.querySelectorAll('.pt-rocker-half')];
      halves.forEach((h, i) => {
        const match = h.dataset.value === value;
        h.setAttribute('aria-pressed', match ? 'true' : 'false');
        if (match) {
          thumb.style.width = `calc((100% - 6px) / ${halves.length})`;
          thumb.style.left = `calc(3px + (100% - 6px) * ${i} / ${halves.length})`;
        }
      });
    });
  }

  function wireRocker(group, onChange) {
    root.querySelectorAll(`[data-rocker="${group}"] .pt-rocker-half`).forEach(h => {
      h.addEventListener('click', () => onChange(h.dataset.value));
    });
  }
  wireRocker('scaleType', setScaleType);
  wireRocker('noteSet', setNoteSet);
  wireRocker('view', setView);

  const rootSelect = el('rootSelect');
  const noteSetSelect = el('noteSetSelect');
  rootSelect.addEventListener('change', () => setRoot(parseInt(rootSelect.value, 10)));
  noteSetSelect.addEventListener('change', () => setNoteSet(noteSetSelect.value));

  function syncControls() {
    syncRocker('scaleType', state.scaleType);
    syncRocker('noteSet', state.noteSet);
    syncRocker('view', state.view);
    // key names depend on major vs minor (D♭ major, C♯ minor)
    rootSelect.innerHTML = KEY_NAMES[state.scaleType]
      .map((name, pc) => `<option value="${pc}">${name}</option>`).join('');
    rootSelect.value = String(state.root);
    noteSetSelect.value = state.noteSet;
  }

  // called when the tab becomes visible: the fretboard can only be measured then
  function resync() {
    syncControls();
    layoutFretboard();
  }

  /* ---------- phone settings sheet ---------- */
  const sheetOpenBtn = el('sheetOpen');
  function setSheetOpen(open) {
    root.classList.toggle('pt-sheet-open', open);
    el('backdrop').hidden = !open;
    sheetOpenBtn.setAttribute('aria-expanded', String(open));
    if (open) el('sheetClose').focus();
    else if (root.contains(document.activeElement) && el('panel').contains(document.activeElement)) sheetOpenBtn.focus();
  }
  const sheetIsOpen = () => root.classList.contains('pt-sheet-open');
  sheetOpenBtn.addEventListener('click', () => setSheetOpen(true));
  el('sheetClose').addEventListener('click', () => setSheetOpen(false));
  el('backdrop').addEventListener('click', () => setSheetOpen(false));
  // widening the window past the phone layout shouldn't leave the sheet state behind
  const desktopQuery = window.matchMedia('(min-width: 769px)');
  const onLayoutChange = () => { if (desktopQuery.matches && sheetIsOpen()) setSheetOpen(false); };
  desktopQuery.addEventListener('change', onLayoutChange);
  // lick generator starts open where there's room for it, folded away on phones
  el('lickDetails').open = desktopQuery.matches;

  /* ---------- scale info toggle ---------- */
  function setCaptionOpen(open) {
    el('lcdCaption').hidden = !open;
    el('infoBtn').setAttribute('aria-expanded', String(open));
  }
  el('infoBtn').addEventListener('click', () => {
    setCaptionOpen(el('lcdCaption').hidden);
    saveSettings();
  });

  /* ---------- remembered settings ---------- */
  // Per-browser convenience only: the tab works the same when storage is blocked.
  const STORAGE_KEY = 'kappa.pentatonic.v1';
  let saveTimer = null;

  function saveSettings() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const mix = band.getMix();
      const settings = {
        root: state.root, scaleType: state.scaleType, noteSet: state.noteSet, view: state.view,
        position: state.position, progression: state.progression,
        style: styleSelect.value, bpm, countIn: el('countInBox').checked,
        mix: Object.fromEntries(PARTS.map(p => [p, { volume: mix[p].volume, muted: mix[p].muted }])),
        captionOpen: !el('lcdCaption').hidden,
      };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ }
    }, 300);
  }

  function restoreSettings() {
    let s;
    try { s = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return; }
    if (!s || typeof s !== 'object') return;

    if (Number.isInteger(s.root) && s.root >= 0 && s.root < 12) state.root = s.root;
    if (s.scaleType in SCALE_TONES) state.scaleType = s.scaleType;
    if (s.noteSet in SCALE_TONES.major) state.noteSet = s.noteSet;
    if (s.view === 'pattern' || s.view === 'chords') state.view = s.view;
    state.degreesOn = freshDegreesOn();
    if (Number.isInteger(s.position) && s.position >= 0 && s.position < computePositions().length) state.position = s.position;
    if (Array.isArray(s.progression) && s.progression.length && s.progression.every(p =>
      p && Number.isInteger(p.offset) && p.offset >= 0 && p.offset < 12 && p.quality in CHORD_SHAPES && typeof p.numeral === 'string')) {
      state.progression = s.progression.map(p => ({ offset: p.offset, quality: p.quality, numeral: p.numeral }));
    }

    if (STYLE_OPTIONS.some(o => o.value === s.style)) {
      styleSelect.value = s.style;
      band.setStyle(s.style);
    }
    if (Number.isFinite(s.bpm)) {
      bpmInput.value = s.bpm;
      applyBpm(true);
    }
    if (typeof s.countIn === 'boolean') el('countInBox').checked = s.countIn;
    if (s.mix && typeof s.mix === 'object') {
      PARTS.forEach(p => {
        const m = s.mix[p];
        if (!m) return;
        if (Number.isFinite(m.volume)) band.setVolume(p, Math.max(0, Math.min(1, m.volume)));
        if (typeof m.muted === 'boolean') band.setMuted(p, m.muted);
      });
      buildMixer();
    }
    setCaptionOpen(s.captionOpen === true);
  }

  /* ---------- keyboard shortcuts (only while this tab is showing) ---------- */
  const isTypingTarget = t => t instanceof HTMLElement &&
    (t.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName));

  function onKeyDown(e) {
    if (root.hidden) return;
    if (e.key === 'Escape' && sheetIsOpen()) {
      setSheetOpen(false);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
    switch (e.key) {
      case ' ':
        // also stops a focused button from being "clicked" by the space bar
        e.preventDefault();
        if (!e.repeat && !loading) {
          if (band.playing) stopPlayback(); else startPlayback();
        }
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
        e.preventDefault();
        setRoot((state.root + (e.key === 'ArrowRight' ? 1 : 11)) % 12);
        break;
      case 'ArrowUp':
      case 'ArrowDown':
        e.preventDefault();
        bpmInput.value = bpm + (e.key === 'ArrowUp' ? 5 : -5);
        applyBpm(true);
        break;
      default:
    }
  }
  // a focused button fires its click on Space *keyup*, so swallow that too
  function onKeyUp(e) {
    if (e.key === ' ' && !root.hidden && !isTypingTarget(e.target)) e.preventDefault();
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  restoreSettings();
  buildFretboardChrome();
  buildRootRow();
  renderAll();
  resync();

  const resizeObserver = new ResizeObserver(() => layoutFretboard());
  resizeObserver.observe(fbWrapEl);

  return {
    resync,
    stop: stopPlayback,
    destroy() {
      clearTimeout(saveTimer);
      desktopQuery.removeEventListener('change', onLayoutChange);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      resizeObserver.disconnect();
      unsubscribePlayback();
      band.dispose();
      root.innerHTML = '';
    },
  };
}
