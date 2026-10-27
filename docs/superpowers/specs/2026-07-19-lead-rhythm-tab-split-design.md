# Lead / Rhythm Tab Split — Design Spec

**Date:** 2026-07-19  
**Status:** Approved

---

## Goal

Split the Guitar Tab detection output into two separate, always-visible tab grids — **Lead** (single-note lines) and **Rhythm** (simultaneous multi-note clusters) — stacked vertically in the main area.

---

## Detection Algorithm

**Signal used:** polyphony per time column (number of strings that fire at the same column after note-to-tab assignment).

| Column polyphony | Classification |
|---|---|
| Exactly 1 string | Lead |
| 2 or more strings | Rhythm |

Both Lead and Rhythm pools run through the existing technique detection (hammer-on `h`, pull-off `p`, bend `b`, slide `/\`) independently. They share the same `totalBeats` and BPM so playheads stay in sync.

**Edge cases:**
- If no lead notes are found: Lead section shows "No lead detected" placeholder.
- If no rhythm notes are found: Rhythm section shows "No rhythm detected" placeholder.
- The existing single `tab`/`techniques` store slices (used by any other consumers) are kept and populated with the full unfiltered result as before.

---

## Data Flow

```
BasicPitch notes
      │
      ▼
notesToTab(notes, bpm, stringCount)
      │
      ├── assigns notes to (string, col, fret)
      ├── detects techniques per string
      │
      ├── Lead pool  = columns where colNotes.assignedStrings.size === 1
      └── Rhythm pool = columns where colNotes.assignedStrings.size >= 2
      │
      ▼
returns {
  tab,            techniques,           totalBeats,  // full (unchanged)
  leadTab,        leadTechniques,                     // Lead split
  rhythmTab,      rhythmTechniques,                   // Rhythm split
}
```

---

## Store Changes (`tabStore.js`)

Add four new state arrays alongside the existing `tab`/`techniques`:

```js
leadTab: makeEmptyTab(6, DEFAULT_BEATS),
leadTechniques: makeEmptyTab(6, DEFAULT_BEATS),
rhythmTab: makeEmptyTab(6, DEFAULT_BEATS),
rhythmTechniques: makeEmptyTab(6, DEFAULT_BEATS),
```

`loadTab(tab, techniques, leadTab, leadTechniques, rhythmTab, rhythmTechniques, totalBeats)` — pads all six arrays to `totalBeats`.

`clearTab()` — resets all six arrays.

`setStringCount(count)` — resizes all six arrays.

---

## TabGrid Changes (`TabGrid.jsx`)

Add an optional `source` prop: `'lead' | 'rhythm'` (default: existing behaviour reading `tab`/`techniques`).

```jsx
// Inside TabGrid:
const {
  tab, techniques,
  leadTab, leadTechniques,
  rhythmTab, rhythmTechniques,
  ...rest
} = useTabStore();

const activeTab  = source === 'lead'   ? leadTab        :
                   source === 'rhythm' ? rhythmTab       : tab;
const activeTech = source === 'lead'   ? leadTechniques  :
                   source === 'rhythm' ? rhythmTechniques : techniques;
```

Existing callers that don't pass `source` are unaffected.

---

## UI Layout (`App.jsx` — Guitar Tab main area)

Replace the single `<TabGrid>` with two labeled sections:

```jsx
<div className="lead-rhythm-split">
  <div className="tab-section-header">🎸 Lead</div>
  {leadIsEmpty
    ? <p className="hint">No lead (single-note) lines detected</p>
    : <TabGrid source="lead" lyricsLines={lyricsLines} tabStartSec={tabStartSec}
               lyricsCurrentTime={...} />
  }

  <div className="tab-section-divider" />

  <div className="tab-section-header">🎵 Rhythm</div>
  {rhythmIsEmpty
    ? <p className="hint">No rhythm (chord) patterns detected</p>
    : <TabGrid source="rhythm" lyricsLines={lyricsLines} tabStartSec={tabStartSec}
               lyricsCurrentTime={...} />
  }
</div>
```

`leadIsEmpty` / `rhythmIsEmpty` — derived: `leadTab.every(row => row.every(c => c === null))`.

Each `TabGrid` renders its own "Copy Tab" button (already inside TabGrid).

Both grids share the same `playheadBeat` from the store — the playhead cursor moves across both simultaneously during playback.

---

## CSS additions (`index.css`)

```css
.lead-rhythm-split { display: flex; flex-direction: column; gap: 24px; }

.tab-section-header {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 6px;
}

.tab-section-divider {
  border-top: 1px solid var(--border);
  margin: 4px 0;
}
```

---

## Files Touched

| File | Change |
|---|---|
| `src/tabGenerator.js` | Split output into lead/rhythm pools; return six arrays |
| `src/tabStore.js` | Add `leadTab`, `leadTechniques`, `rhythmTab`, `rhythmTechniques`; update `loadTab`, `clearTab`, `setStringCount` |
| `src/components/TabGrid.jsx` | Add `source` prop; select store slice based on it |
| `src/App.jsx` | Pass all six arrays to `loadTab`; replace single `<TabGrid>` with stacked Lead+Rhythm layout |
| `src/index.css` | Add `.lead-rhythm-split`, `.tab-section-header`, `.tab-section-divider` |

---

## Out of Scope

- Vibrato detection (needs frame-level contour analysis, separate feature)
- Manual re-assignment of notes between Lead and Rhythm (drag-and-drop editor)
- Separate playback for Lead vs Rhythm audio tracks
