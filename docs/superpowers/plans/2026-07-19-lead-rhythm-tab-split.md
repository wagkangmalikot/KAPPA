# Lead / Rhythm Tab Split — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the Guitar Tab detection output into two stacked grids — Lead (single-note columns) and Rhythm (multi-note columns) — both always visible in the Guitar Tab main area.

**Architecture:** After `notesToTab` assigns notes to strings, each time column is classified by polyphony (1 string = lead, 2+ strings = rhythm). Four new arrays (`leadTab`, `leadTechniques`, `rhythmTab`, `rhythmTechniques`) are built from that classification and stored alongside the existing full-tab arrays. `TabGrid` gains a `source` prop to select which store slice to render.

**Tech Stack:** React 18, Vite 5, Zustand, vanilla JS — no new dependencies.

---

### Task 1: Add polyphony split to `tabGenerator.js`

**Files:**
- Modify: `src/tabGenerator.js`

After the technique detection loop, classify each column by how many strings have a note, then copy into lead or rhythm arrays.

- [ ] **Step 1: Open `src/tabGenerator.js` and locate the `return` statement at the end of `notesToTab`.**

Currently:
```js
  return { tab, techniques, totalBeats };
```

- [ ] **Step 2: Add the polyphony split block immediately before the `return`.**

Replace the `return` with:

```js
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
```

- [ ] **Step 3: Verify in browser console that the shape is correct.**

Open `http://localhost:5174`, open DevTools → Console, run:
```js
const s = window.__tabStore?.getState();
console.log('leadTab rows:', s?.leadTab?.length, 'rhythmTab rows:', s?.rhythmTab?.length);
```
Expected: both arrays have the same number of rows as `stringCount` (e.g. 6).  
_(They will be empty until a tab is detected — that's expected at this step.)_

- [ ] **Step 4: Commit.**

```bash
git add src/tabGenerator.js
git commit -m "feat: split notesToTab output into lead/rhythm by column polyphony"
```

---

### Task 2: Extend `tabStore.js` with lead/rhythm state

**Files:**
- Modify: `src/tabStore.js`

- [ ] **Step 1: Add four new initial-state arrays inside `initialState`.**

Current `initialState`:
```js
const initialState = {
  tab: makeEmptyTab(6, DEFAULT_BEATS),
  techniques: makeEmptyTab(6, DEFAULT_BEATS),
  stringCount: 6,
  bpm: 120,
  playheadBeat: 0,
  totalBeats: DEFAULT_BEATS,
  isPlaying: false,
};
```

Replace with:
```js
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
```

- [ ] **Step 2: Update `loadTab` to accept and store all six arrays.**

Current signature:
```js
loadTab: (newTab, newTechniques, newTotalBeats) => {
  const { stringCount } = get();
  const padded = Array.from({ length: stringCount }, (_, si) => {
    const row = newTab[si] ?? [];
    const out = [...row];
    while (out.length < newTotalBeats) out.push(null);
    return out;
  });
  const paddedTechs = Array.from({ length: stringCount }, (_, si) => {
    const row = newTechniques?.[si] ?? [];
    const out = [...row];
    while (out.length < newTotalBeats) out.push(null);
    return out;
  });
  set({ tab: padded, techniques: paddedTechs, totalBeats: newTotalBeats, playheadBeat: 0 });
},
```

Replace with:
```js
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
```

- [ ] **Step 3: Update `clearTab` to reset all six arrays.**

Current:
```js
clearTab: () => {
  const { stringCount } = get();
  set({
    tab: makeEmptyTab(stringCount, DEFAULT_BEATS),
    techniques: makeEmptyTab(stringCount, DEFAULT_BEATS),
    playheadBeat: 0,
    totalBeats: DEFAULT_BEATS,
  });
},
```

Replace with:
```js
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
```

- [ ] **Step 4: Update `setStringCount` to resize all six arrays.**

Current `setStringCount`:
```js
setStringCount: (count) => {
  const { tab, techniques, totalBeats } = get();
  let newTab, newTechs;
  if (count < tab.length) {
    newTab = tab.slice(0, count);
    newTechs = techniques.slice(0, count);
  } else {
    newTab = [...tab];
    newTechs = [...techniques];
    while (newTab.length < count) {
      newTab.push(new Array(totalBeats).fill(null));
      newTechs.push(new Array(totalBeats).fill(null));
    }
  }
  set({ stringCount: count, tab: newTab, techniques: newTechs });
},
```

Replace with:
```js
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
```

- [ ] **Step 5: Verify no console errors in the browser at `http://localhost:5174`.**

Open DevTools → Console. There should be zero errors. Run:
```js
const s = window.__tabStore.getState();
['tab','techniques','leadTab','leadTechniques','rhythmTab','rhythmTechniques'].forEach(k =>
  console.log(k, Array.isArray(s[k]), s[k].length)
);
```
Expected: all six are arrays of length `stringCount` (6 by default).

- [ ] **Step 6: Commit.**

```bash
git add src/tabStore.js
git commit -m "feat: add leadTab/rhythmTab state slices to tabStore"
```

---

### Task 3: Add `source` prop to `TabGrid.jsx`

**Files:**
- Modify: `src/components/TabGrid.jsx`

- [ ] **Step 1: Destructure the new store slices inside `TabGrid`.**

Locate the line in `TabGrid`:
```js
  const { tab, techniques, stringCount, playheadBeat, totalBeats, bpm } = useTabStore();
```

Replace with:
```js
  const {
    tab, techniques,
    leadTab, leadTechniques,
    rhythmTab, rhythmTechniques,
    stringCount, playheadBeat, totalBeats, bpm,
  } = useTabStore();
```

- [ ] **Step 2: Add `source` prop to the function signature and select the active slice.**

Current signature:
```js
export function TabGrid({ lyricsLines = [], tabStartSec = 0, lyricsCurrentTime = null }) {
```

Replace with:
```js
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
```

- [ ] **Step 3: Replace all internal uses of `tab` and `techniques` with `activeTab` and `activeTech`.**

Find every place inside the function body (after the destructuring) that references `tab[` or `techniques[` and change them to `activeTab[` and `activeTech[`.

There are exactly four locations:
1. The early-return guard: `if (tab.every(...))` → `if (activeTab.every(...))`
2. `colW` calculation: `for (const row of tab)` → `for (let si = 0; si < activeTab.length; si++) { if (activeTab[si][bi] !== null)`  
   _(already uses `si` pattern in current code — just change `tab[si]` to `activeTab[si]` and `techniques[si]` to `activeTech[si]`)_
3. `buildPlainText` call: `buildPlainText(tab, techniques, ...)` → `buildPlainText(activeTab, activeTech, ...)`
4. `BeatCell` render: `val={tab[si]?.[bi] ?? null}` → `val={activeTab[si]?.[bi] ?? null}` and `tech={techniques[si]?.[bi] ?? null}` → `tech={activeTech[si]?.[bi] ?? null}`

Full updated `TabGrid` body (only the changed lines shown — keep everything else identical):

```js
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

  // ... systems loop unchanged ...

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
          // ... sysLyrics calc unchanged ...
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
              {/* lyrics row unchanged */}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify in browser — Guitar Tab still renders the combined tab correctly (no `source` prop = existing behaviour).**

Navigate to `http://localhost:5174` → Guitar Tab. No visible change yet (no tab detected). No console errors.

- [ ] **Step 5: Commit.**

```bash
git add src/components/TabGrid.jsx
git commit -m "feat: add source prop to TabGrid to select lead/rhythm store slice"
```

---

### Task 4: Wire everything together in `App.jsx`

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Update the `detectTab` function to destructure lead/rhythm from `notesToTab` and pass them to `loadTab`.**

Find this block inside `detectTab`:
```js
      if (filtered.length === 0) {
        setTabError('No guitar notes detected above confidence threshold.');
      } else {
        const { bpm, stringCount } = useTabStore.getState();
        const { tab, techniques, totalBeats } = notesToTab(filtered, bpm, stringCount);
        useTabStore.getState().loadTab(tab, techniques, totalBeats);
      }
```

Replace with:
```js
      if (filtered.length === 0) {
        setTabError('No guitar notes detected above confidence threshold.');
      } else {
        const { bpm, stringCount } = useTabStore.getState();
        const { tab, techniques, leadTab, leadTechniques, rhythmTab, rhythmTechniques, totalBeats } =
          notesToTab(filtered, bpm, stringCount);
        useTabStore.getState().loadTab(
          tab, techniques,
          leadTab, leadTechniques,
          rhythmTab, rhythmTechniques,
          totalBeats,
        );
      }
```

- [ ] **Step 2: Replace the single `<TabGrid>` in the Guitar Tab main area with the stacked Lead+Rhythm layout.**

Find this block in the Guitar Tab `<div className="main-area">`:
```jsx
          <div className="main-area">
            <TabTimeline onSeek={tabSeekTo} />
            <TabGrid
              lyricsLines={lyricsLines}
              tabStartSec={tabStartSec}
              lyricsCurrentTime={tabIsPlaying ? tabDisplayTime + tabStartSec : isPlaying ? displayTime : null}
            />
            <LyricsPanel ... />
          </div>
```

Replace with:
```jsx
          <div className="main-area">
            <TabTimeline onSeek={tabSeekTo} />
            <div className="lead-rhythm-split">
              <div>
                <div className="tab-section-header">🎸 Lead</div>
                {useTabStore.getState().leadTab.every(r => r.every(c => c === null))
                  ? null
                  : (
                    <TabGrid
                      source="lead"
                      lyricsLines={lyricsLines}
                      tabStartSec={tabStartSec}
                      lyricsCurrentTime={tabIsPlaying ? tabDisplayTime + tabStartSec : isPlaying ? displayTime : null}
                    />
                  )
                }
              </div>
              <div className="tab-section-divider" />
              <div>
                <div className="tab-section-header">🎵 Rhythm</div>
                {useTabStore.getState().rhythmTab.every(r => r.every(c => c === null))
                  ? null
                  : (
                    <TabGrid
                      source="rhythm"
                      lyricsLines={lyricsLines}
                      tabStartSec={tabStartSec}
                      lyricsCurrentTime={tabIsPlaying ? tabDisplayTime + tabStartSec : isPlaying ? displayTime : null}
                    />
                  )
                }
              </div>
            </div>
            <LyricsPanel
              query={lyricsQuery}
              onQueryChange={setLyricsQuery}
              onSearch={searchLyrics}
              searching={lyricsSearching}
              detecting={lyricsDetecting}
              status={lyricsStatus}
              error={lyricsError}
              source={lyricsSource}
              onDetect={detectLyricsFromAudio}
              hasAudio={!!(stemsDataRef.current?.vocals || audioFile || guitarStemRef.current)}
            />
          </div>
```

**Important:** The `useTabStore.getState()` calls inside JSX are stale reads (they won't re-render on change). Replace them with reactive state by pulling the empty-check out of JSX via a reactive hook. At the top of the `App` function body, add:

```js
  const leadIsEmpty   = useTabStore(s => s.leadTab.every(r => r.every(c => c === null)));
  const rhythmIsEmpty = useTabStore(s => s.rhythmTab.every(r => r.every(c => c === null)));
```

Then update the JSX to use these booleans:

```jsx
              <div>
                <div className="tab-section-header">🎸 Lead</div>
                {!leadIsEmpty && (
                  <TabGrid
                    source="lead"
                    lyricsLines={lyricsLines}
                    tabStartSec={tabStartSec}
                    lyricsCurrentTime={tabIsPlaying ? tabDisplayTime + tabStartSec : isPlaying ? displayTime : null}
                  />
                )}
              </div>
              <div className="tab-section-divider" />
              <div>
                <div className="tab-section-header">🎵 Rhythm</div>
                {!rhythmIsEmpty && (
                  <TabGrid
                    source="rhythm"
                    lyricsLines={lyricsLines}
                    tabStartSec={tabStartSec}
                    lyricsCurrentTime={tabIsPlaying ? tabDisplayTime + tabStartSec : isPlaying ? displayTime : null}
                  />
                )}
              </div>
```

- [ ] **Step 3: Verify in browser — Guitar Tab panel loads with no console errors. The main area is empty (no tab detected yet), which is correct.**

Open DevTools → Console: zero errors.

- [ ] **Step 4: Commit.**

```bash
git add src/App.jsx
git commit -m "feat: render stacked lead/rhythm TabGrids in Guitar Tab panel"
```

---

### Task 5: Add CSS for the split layout

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: Append the following CSS rules to `src/index.css`.**

Add after the existing `.tab-tech-*` rules:

```css
/* Lead / Rhythm split layout */
.lead-rhythm-split {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.tab-section-header {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 6px;
}

.tab-section-divider {
  border: none;
  border-top: 1px solid var(--border);
  margin: 0;
}
```

- [ ] **Step 2: Verify in browser — section headers render cleanly above each grid once a tab is detected.**

_(To test fully, load audio via the ♪ button, go to Guitar Tab, click Detect Guitar Tab, wait for processing. Lead section should show single-note lines; Rhythm section should show multi-note chord patterns. Both have their own "Copy Tab" button.)_

- [ ] **Step 3: Commit.**

```bash
git add src/index.css
git commit -m "feat: add CSS for stacked lead/rhythm tab sections"
```

---

## Self-Review

**Spec coverage:**
- Lead/Rhythm split in tabGenerator ✓ (Task 1)
- Store slices ✓ (Task 2)
- TabGrid `source` prop ✓ (Task 3)
- Stacked layout with reactive empty-check ✓ (Task 4)
- CSS ✓ (Task 5)
- Both grids share same BPM/playhead ✓ (both read `playheadBeat` from same store)
- Each grid has its own Copy Tab button ✓ (inside `TabGrid`, one per instance)
- Empty section hides grid ✓ (`leadIsEmpty`/`rhythmIsEmpty` reactive booleans)

**Placeholder scan:** No TBDs or incomplete steps. ✓

**Type consistency:**
- `loadTab(tab, techniques, leadTab, leadTechniques, rhythmTab, rhythmTechniques, totalBeats)` — 7-arg signature used consistently in Task 2 (store) and Task 4 (App.jsx call site). ✓
- `source` prop is `'lead' | 'rhythm' | undefined` — used consistently in Task 3 definition and Task 4 usage. ✓
