# KAPPA Desktop Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign KAPPA from a mobile-stretched single column into a proper desktop DAW-style UI with a sticky top bar, three-tab workspace (Stems / Guitar Tab / Chords), left controls panel per tab, and a dark pro color theme.

**Architecture:** Replace `index.css` wholesale with a dark token-based design system and new layout classes. Restructure `App.jsx` JSX into `top-bar → tab-nav → workspace (controls-panel + main-area)` per tab. Remove the drum tab and all its supporting state/handlers. Stem separation moves into the Stems tab; stem player controls live in the sticky top bar.

**Tech Stack:** React 18, Vite 5, CSS custom properties, Web Audio API (unchanged), Zustand (unchanged).

---

## File Map

| File | Action | What changes |
|---|---|---|
| `src/index.css` | **Replace entirely** | Dark theme, new layout primitives, restyled component classes |
| `src/App.jsx` | **Restructure JSX + remove drum** | New top-bar / tab-nav / workspace layout; drum tab state + handlers + JSX deleted |
| `src/components/TransportBar.jsx` | Minor tweak | Remove standalone wrapper div border (panel provides it now) |

All other component files (`TabGrid`, `TabTimeline`, `ChordSheet`, `StringSelector`, `useTabAudio`, `tabGenerator`, `tabStore`) are **not touched** — their CSS classes are restyled in `index.css`.

---

## Task 1 — New `index.css`: dark theme + layout primitives

**Files:**
- Replace: `src/index.css`

- [ ] **Step 1: Write the new CSS file**

Replace the entire contents of `src/index.css` with the following:

```css
/* ══════════════════════════════════════════════
   KAPPA — Desktop Dark Theme
   ══════════════════════════════════════════════ */

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg:           #0d0d1e;
  --bg-surface:   #0f0f20;
  --bg-elevated:  #141428;
  --bg-card:      #12121f;
  --border:       #1e1e38;
  --border-subtle:#161630;
  --accent:       #667eea;
  --accent-dim:   #667eea44;
  --accent-dark:  #4a5bb8;
  --text:         #c0c8e0;
  --text-muted:   #6070a0;
  --text-dim:     #3a4060;
  --danger:       #e05555;
  --success:      #48bb78;
  --panel-w:      280px;
  --topbar-h:     52px;
  --nav-h:        40px;
}

html, body { height: 100%; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 13px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

/* ── APP SHELL ── */
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

/* ── TOP BAR ── */
.top-bar {
  height: var(--topbar-h);
  background: #0a0a18;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 20px;
  flex-shrink: 0;
  box-shadow: 0 2px 16px #00000066;
  z-index: 50;
}

.top-bar-logo {
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 3px;
  color: var(--accent);
  flex-shrink: 0;
  user-select: none;
}

.top-bar-file {
  display: flex;
  align-items: center;
  gap: 7px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 4px 10px;
  flex-shrink: 0;
  cursor: pointer;
  transition: border-color .15s;
}
.top-bar-file:hover { border-color: var(--accent); }
.top-bar-file .tbf-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--accent);
  flex-shrink: 0;
}
.top-bar-file .tbf-name {
  font-size: 11px;
  color: var(--text-muted);
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.top-bar-file .tbf-prompt {
  font-size: 11px;
  color: var(--text-dim);
}

.top-bar-player {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 4px 10px;
  min-width: 0;
}
.top-bar-player .tbp-time {
  font-size: 10px;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
.top-bar-player .tbp-scrub {
  flex: 1;
  height: 3px;
  background: var(--border);
  border-radius: 2px;
  position: relative;
  cursor: pointer;
}
.top-bar-player .tbp-fill {
  height: 3px;
  background: var(--accent);
  border-radius: 2px;
}
.top-bar-player .tbp-thumb {
  position: absolute;
  top: -4px;
  width: 11px; height: 11px;
  border-radius: 50%;
  background: var(--accent);
  border: 2px solid #0a0a18;
  transform: translateX(-50%);
  box-shadow: 0 0 6px var(--accent-dim);
  pointer-events: none;
}

.top-bar-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.tb-btn {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--text-muted);
  padding: 4px 10px;
  font-size: 11px;
  cursor: pointer;
  transition: border-color .15s, color .15s;
  white-space: nowrap;
}
.tb-btn:hover { border-color: var(--accent); color: var(--accent); }
.tb-btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.tb-btn.primary:hover { background: var(--accent-dark); border-color: var(--accent-dark); }
.tb-btn.danger { color: var(--danger); border-color: transparent; }
.tb-btn.danger:hover { border-color: var(--danger); }
.tb-btn:disabled { opacity: .35; cursor: default; pointer-events: none; }

/* ── TAB NAV ── */
.kappa-nav {
  height: var(--nav-h);
  background: #0a0a18;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: flex-end;
  padding: 0 20px;
  gap: 2px;
  flex-shrink: 0;
}

.kappa-nav-btn {
  padding: 6px 18px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-dim);
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: color .15s, border-color .15s;
  white-space: nowrap;
  margin-bottom: -1px;
}
.kappa-nav-btn:hover { color: var(--text-muted); }
.kappa-nav-btn.active { color: var(--accent); border-bottom-color: var(--accent); }

/* ── WORKSPACE ── */
.workspace {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* ── CONTROLS PANEL (left) ── */
.controls-panel {
  width: var(--panel-w);
  flex-shrink: 0;
  background: var(--bg-surface);
  border-right: 1px solid var(--border);
  overflow-y: auto;
  padding: 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.panel-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--text-dim);
  margin-bottom: 6px;
}

/* ── MAIN AREA (right) ── */
.main-area {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
  background: var(--bg);
}

.main-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 14px;
}

/* ════════════════════════════
   UPLOAD ZONES
   ════════════════════════════ */
.upload-zone {
  border: 1.5px dashed var(--border);
  border-radius: 8px;
  padding: 18px 12px;
  text-align: center;
  cursor: pointer;
  background: var(--bg);
  transition: border-color .15s, background .15s;
}
.upload-zone:hover {
  border-color: var(--accent);
  background: var(--bg-elevated);
}
.upload-zone input[type="file"] { display: none; }
.upload-zone .uz-icon { font-size: 24px; margin-bottom: 6px; }
.upload-zone .uz-text { color: var(--text-muted); font-size: 11px; }
.upload-zone .uz-hint { color: var(--text-dim); font-size: 10px; margin-top: 3px; }

.file-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 7px 10px;
}
.file-pill .fp-icon { font-size: 14px; flex-shrink: 0; }
.file-pill .fp-name {
  flex: 1;
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ════════════════════════════
   BUTTONS
   ════════════════════════════ */
.btn-action {
  width: 100%;
  background: linear-gradient(135deg, var(--accent), #7c6cf0);
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 9px 14px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 2px 8px var(--accent-dim);
  transition: opacity .15s;
}
.btn-action:hover { opacity: .9; }
.btn-action:disabled {
  background: var(--bg-elevated);
  color: var(--text-dim);
  box-shadow: none;
  cursor: default;
}

.btn-copy {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--text-muted);
  padding: 4px 12px;
  font-size: 11px;
  cursor: pointer;
}
.btn-copy:hover { border-color: var(--accent); color: var(--accent); }

/* ════════════════════════════
   PROGRESS
   ════════════════════════════ */
.progress-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.progress-bar-bg {
  flex: 1;
  height: 4px;
  background: var(--border);
  border-radius: 2px;
  overflow: hidden;
}
.progress-bar-fill {
  height: 4px;
  background: var(--accent);
  border-radius: 2px;
  transition: width .3s;
}
.progress-bar-fill.active {
  background: linear-gradient(90deg, var(--accent), #a78bfa, var(--accent));
  background-size: 200%;
  animation: shimmer 1.4s linear infinite;
}
@keyframes shimmer { to { background-position: -200% center; } }
.progress-row > span { font-size: 10px; color: var(--text-dim); flex-shrink: 0; }

/* ════════════════════════════
   RANGE SELECTOR
   ════════════════════════════ */
.range-selector {
  position: relative;
  user-select: none;
  cursor: default;
  padding: 10px 0 4px;
}
.range-track {
  height: 5px;
  background: var(--border);
  border-radius: 3px;
  position: relative;
  margin: 0 6px;
}
.range-fill {
  position: absolute;
  top: 0; bottom: 0;
  background: var(--accent-dim);
  border-radius: 3px;
}
.range-handle {
  position: absolute;
  top: 50%;
  width: 14px; height: 14px;
  border-radius: 50%;
  background: var(--accent);
  border: 2px solid var(--bg-surface);
  transform: translate(-50%, -50%);
  cursor: ew-resize;
  box-shadow: 0 0 6px var(--accent-dim);
}
.range-times {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--text-dim);
  margin-top: 6px;
}

/* ════════════════════════════
   STEM CHIPS
   ════════════════════════════ */
.stem-chips { display: flex; flex-direction: column; gap: 5px; }
.stem-chip-item { display: flex; align-items: center; gap: 6px; }
.stem-chip {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 11px;
  color: var(--text-dim);
  transition: border-color .15s, color .15s;
}
.stem-chip.active {
  border-color: var(--accent);
  color: var(--text-muted);
  background: #1a1a38;
}
.stem-chip-label { display: flex; align-items: center; gap: 6px; flex: 1; }
.stem-chip-emoji { font-size: 13px; }
.stem-toggle-track {
  width: 28px; height: 14px;
  border-radius: 7px;
  background: var(--border);
  position: relative;
  transition: background .15s;
  flex-shrink: 0;
}
.stem-chip.active .stem-toggle-track { background: var(--accent); }
.stem-toggle-dot {
  width: 10px; height: 10px;
  border-radius: 50%;
  background: #fff;
  position: absolute;
  top: 2px; left: 2px;
  transition: left .15s;
}
.stem-chip.active .stem-toggle-dot { left: 16px; }
.stem-download {
  color: var(--text-dim);
  font-size: 14px;
  text-decoration: none;
  padding: 4px;
  border-radius: 4px;
  flex-shrink: 0;
  line-height: 1;
  transition: color .15s;
}
.stem-download:hover { color: var(--accent); }

/* ════════════════════════════
   STEM PLAYER (top bar scrubber)
   ════════════════════════════ */
.stem-scrubber-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.stem-time { font-size: 10px; color: var(--text-dim); font-variant-numeric: tabular-nums; }
.stem-scrubber {
  flex: 1;
  accent-color: var(--accent);
  height: 3px;
  cursor: pointer;
}
.stem-playback-controls {
  display: flex;
  align-items: center;
  gap: 6px;
}
.stem-playback-controls button {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--text-muted);
  padding: 5px 10px;
  font-size: 12px;
  cursor: pointer;
  transition: border-color .15s, color .15s;
}
.stem-playback-controls button:hover { border-color: var(--accent); color: var(--accent); }
.btn-stop { font-size: 12px; }

/* ════════════════════════════
   TRANSPORT BAR
   ════════════════════════════ */
.transport-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.transport-btn {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--text-muted);
  padding: 5px 10px;
  font-size: 12px;
  cursor: pointer;
  transition: border-color .15s, color .15s;
}
.transport-btn:hover { border-color: var(--accent); color: var(--accent); }
.transport-btn-play {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.transport-btn-play:hover { background: var(--accent-dark); border-color: var(--accent-dark); color: #fff; }
.transport-btn:disabled { opacity: .35; cursor: default; pointer-events: none; }
.transport-bpm {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-left: 4px;
}
.transport-bpm label {
  font-size: 10px;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 1px;
}
.transport-bpm-input {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-muted);
  padding: 3px 6px;
  font-size: 11px;
  width: 52px;
  text-align: center;
}
.transport-bpm-input:focus { outline: none; border-color: var(--accent); }

/* ════════════════════════════
   STRING SELECTOR
   ════════════════════════════ */
.string-selector { display: flex; align-items: center; gap: 8px; }
.string-selector label { font-size: 10px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 1px; }
.string-selector select {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--text-muted);
  padding: 4px 8px;
  font-size: 11px;
  flex: 1;
  cursor: pointer;
}
.string-selector select:focus { outline: none; border-color: var(--accent); }

/* ════════════════════════════
   TAB TIMELINE
   ════════════════════════════ */
.tab-timeline { margin-bottom: 12px; }
.tab-timeline-track {
  height: 24px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 5px;
  position: relative;
  cursor: pointer;
  overflow: hidden;
}
.tab-timeline-fill {
  position: absolute;
  inset: 0;
  background: var(--accent-dim);
  border-radius: 5px;
}
.tab-timeline-thumb {
  position: absolute;
  top: 2px; bottom: 2px;
  width: 3px;
  background: var(--accent);
  border-radius: 2px;
  transform: translateX(-50%);
  box-shadow: 0 0 8px var(--accent);
}
.tab-timeline-counter {
  margin-top: 4px;
  font-size: 10px;
  color: var(--text-dim);
  text-align: right;
}

/* ════════════════════════════
   GUITAR TAB GRID
   ════════════════════════════ */
.ug-tab-wrapper { margin-bottom: 16px; }
.ug-tab-actions { margin-bottom: 8px; }
.ug-tab-scroll {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: 62vh;
  overflow-y: auto;
  padding-right: 4px;
}
.ug-tab-scroll::-webkit-scrollbar { width: 4px; }
.ug-tab-scroll::-webkit-scrollbar-track { background: var(--bg-card); border-radius: 2px; }
.ug-tab-scroll::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
.ug-tab-system {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 12px;
}
.ug-tab-row {
  display: flex;
  align-items: baseline;
  font-family: 'Courier New', Courier, monospace;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-dim);
  white-space: pre;
}
.ug-tab-label { color: var(--text-muted); flex-shrink: 0; }
.ug-beat { color: var(--text-dim); }
.ug-beat-active { color: var(--accent); font-weight: 700; }
.ug-tab-lyrics {
  font-style: italic;
  color: var(--text-dim);
  font-size: 12px;
  padding: 3px 0 6px 3ch;
  font-family: inherit;
}
.ug-tab-lyrics.ug-tab-lyrics-active {
  color: var(--accent);
  font-weight: 500;
}

/* ════════════════════════════
   CHORD SHEET
   ════════════════════════════ */
.ug-chord-display {}
.ug-chord-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.ug-chord-count { font-size: 11px; color: var(--text-dim); }
.ug-chord-scroll {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 60vh;
  overflow-y: auto;
}
.ug-chord-block {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-left: 3px solid transparent;
  border-radius: 6px;
  padding: 10px 12px;
  transition: border-left-color .15s, background .15s;
}
.ug-chord-block.ug-chord-block-active {
  border-left-color: var(--accent);
  background: #0f0f22;
}
.ug-chord-line {
  display: flex;
  margin-bottom: 4px;
  font-family: 'Courier New', Courier, monospace;
}
.ug-chord-name {
  display: inline-block;
  font-size: 14px;
  font-weight: 700;
  color: var(--text-muted);
}
.ug-lyrics-input {
  width: 100%;
  background: transparent;
  border: none;
  border-bottom: 1px dashed var(--border-subtle);
  color: var(--text-dim);
  font-style: italic;
  font-size: 12px;
  padding: 2px 0;
  outline: none;
}
.ug-lyrics-input::placeholder { color: var(--text-dim); }
.ug-lyrics-input:focus { border-bottom-color: var(--accent); }
.ug-chord-times {
  font-family: 'Courier New', Courier, monospace;
  font-size: 10px;
  color: var(--text-dim);
  margin-top: 4px;
}

/* ════════════════════════════
   LYRICS PANEL
   ════════════════════════════ */
.lyrics-panel {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px;
  margin-top: 16px;
}
.lyrics-panel-title {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  color: var(--text-dim);
  margin-bottom: 10px;
}
.lyrics-search-row {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}
.lyrics-search-input {
  flex: 1;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 5px 10px;
  color: var(--text-muted);
  font-size: 11px;
  outline: none;
}
.lyrics-search-input:focus { border-color: var(--accent); }
.lyrics-search-row button, .lyrics-audio-row button {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--text-muted);
  padding: 5px 10px;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
  transition: border-color .15s, color .15s;
}
.lyrics-search-row button:hover, .lyrics-audio-row button:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.lyrics-search-row button:disabled, .lyrics-audio-row button:disabled {
  opacity: .4; cursor: default; pointer-events: none;
}
.lyrics-source { font-size: 11px; color: var(--success); margin-bottom: 6px; }
.lyrics-status { font-size: 11px; color: var(--text-dim); margin-bottom: 6px; }
.lyrics-audio-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.lyrics-audio-hint { font-size: 10px; color: var(--text-dim); }

/* ════════════════════════════
   PROCESSING / SKELETON
   ════════════════════════════ */
.waveform-animation {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 3px;
  height: 40px;
  margin-bottom: 12px;
}
.waveform-animation span {
  display: block;
  width: 3px;
  background: var(--accent);
  border-radius: 2px;
  animation: wave 0.8s ease-in-out infinite alternate;
}
@keyframes wave {
  from { height: 4px; opacity: .4; }
  to   { height: 32px; opacity: 1; }
}
.processing-status { text-align: center; font-size: 12px; color: var(--text-dim); margin-bottom: 12px; }
.skeleton-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  background: var(--bg-elevated);
  border-radius: 6px;
  margin-bottom: 6px;
}
.skeleton-icon { width: 28px; height: 28px; border-radius: 6px; background: var(--border); flex-shrink: 0; }
.skeleton-lines { flex: 1; }
.skeleton-line {
  height: 8px;
  background: var(--border);
  border-radius: 4px;
  margin-bottom: 5px;
  animation: pulse 1.4s ease-in-out infinite;
}
.skeleton-line.short { width: 60%; }
@keyframes pulse { 0%,100% { opacity:.4; } 50% { opacity:.9; } }

/* ════════════════════════════
   STEM WAVEFORM GRID (Stems tab main area)
   ════════════════════════════ */
.stem-wave-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.stem-wave-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px;
}
.stem-wave-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--text-dim);
  margin-bottom: 8px;
}
.stem-wave-bar {
  height: 48px;
  background: var(--bg-elevated);
  border-radius: 4px;
  overflow: hidden;
  position: relative;
}

/* ════════════════════════════
   HINT / ERROR TEXT
   ════════════════════════════ */
.hint {
  font-size: 11px;
  color: var(--text-dim);
  margin-top: 6px;
}

/* ════════════════════════════
   SCROLLBARS (main area)
   ════════════════════════════ */
.main-area::-webkit-scrollbar,
.controls-panel::-webkit-scrollbar { width: 4px; }
.main-area::-webkit-scrollbar-track,
.controls-panel::-webkit-scrollbar-track { background: var(--bg); }
.main-area::-webkit-scrollbar-thumb,
.controls-panel::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

/* ════════════════════════════
   PROCESSING OVERLAY (full workspace)
   ════════════════════════════ */
.processing-panel {
  padding: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
```

- [ ] **Step 2: Verify the CSS loads without errors**

Open browser at `http://localhost:5174`. The app should render with a dark background. No white flash. Check console for CSS parse errors.

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "style: replace CSS with dark desktop theme foundation"
```

---

## Task 2 — App.jsx: new layout + remove drum tab

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Remove all drum tab code**

Delete these blocks from `App.jsx`:

**State to delete** (in the state declarations section):
```js
// DELETE these lines:
const [drumTabText, setDrumTabText] = useState('');
const [drumTabProcessing, setDrumTabProcessing] = useState(false);
const [drumTabProgress, setDrumTabProgress] = useState(0);
const [drumTabError, setDrumTabError] = useState('');
const [drumFileLabel, setDrumFileLabel] = useState('');
const [drumDuration, setDrumDuration] = useState(0);
const [drumTabStartSec, setDrumTabStartSec] = useState(0);
const [drumTabEndSec, setDrumTabEndSec] = useState(0);
const [drumTabIsPlaying, setDrumTabIsPlaying] = useState(false);
const [drumTabDisplayTime, setDrumTabDisplayTime] = useState(0);
const [drumTabDuration, setDrumTabDuration] = useState(0);
```

**Refs to delete:**
```js
// DELETE these lines:
const drumStemRef = useRef(null);
const drumTabSliceRef = useRef(null);
const drumTabAudioBufRef = useRef(null);
const drumTabCtxRef = useRef(null);
const drumTabSrcRef = useRef(null);
const drumTabRafRef = useRef(null);
const drumTabScrubberRef = useRef(null);
const drumTabPlayStartCtxRef = useRef(0);
const drumTabPlayOffsetRef = useRef(0);
const drumRangeRef = useRef(null);
const drumDraggingHandleRef = useRef(null);
```

**useEffect to delete** (the one that sets drumTabStartSec/End):
```js
// DELETE this block:
useEffect(() => {
  if (drumDuration > 0) {
    setDrumTabStartSec(0);
    setDrumTabEndSec(drumDuration);
  }
}, [drumDuration]);
```

**Functions to delete** — remove all these from App.jsx:
- `stopDrumTabNodes`
- `startDrumTabPlayback`
- `pauseDrumTabPlayback`
- `handleDrumTabStop`
- `handleDrumTabScrub`
- `handleDrumRangePointerDown`
- `handleDrumRangePointerMove`
- `handleDrumRangePointerUp`
- `handleDrumFile`
- `detectDrumTab`
- `renderDrumTab` (top-level function before `App`)
- `filterBand` (top-level function — only used by drum detection)
- `onsetsFromEnergy` (top-level function — only used by drum detection)
- `DRUM_PARTS` constant

**In `handleReset`**, delete all drum-related lines:
```js
// DELETE these lines from handleReset:
stopDrumTabNodes();
setDrumFileLabel('');
setDrumDuration(0);
setDrumTabStartSec(0);
setDrumTabEndSec(0);
setDrumTabIsPlaying(false);
setDrumTabDisplayTime(0);
setDrumTabDuration(0);
setDrumTabText('');
setDrumTabProcessing(false);
setDrumTabProgress(0);
setDrumTabError('');
drumTabSliceRef.current = null;
drumTabAudioBufRef.current = null;
drumTabPlayOffsetRef.current = 0;
drumStemRef.current = null;
```

**In the cleanup `useEffect`**, delete:
```js
// DELETE these from the cleanup useEffect:
stopDrumTabNodes();
drumTabCtxRef.current?.close();
```

**In `applyStemResult`**, delete:
```js
// DELETE these lines:
drumStemRef.current = {
  left: stemsDataRef.current.drums.left,
  right: stemsDataRef.current.drums.right,
  sampleRate,
};
setDrumFileLabel('');
setDrumDuration(stemsDataRef.current.drums.left.length / sampleRate);
```

Also delete `const DRUM_PARTS` array at the top.

- [ ] **Step 2: Verify drum removal compiles**

Check `http://localhost:5174` — app still renders, no console errors referencing drum.

- [ ] **Step 3: Replace the JSX `return` in App with the new layout**

Replace everything from `return (` to the closing `);` of the `App` function with:

```jsx
return (
  <div className="app-shell">

    {/* ── TOP BAR ── */}
    <div className="top-bar">
      <span className="top-bar-logo">KAPPA</span>

      {audioName ? (
        <label className="top-bar-file" title="Load a different file">
          <div className="tbf-dot" />
          <span className="tbf-name">{audioName}</span>
          <input type="file" accept="audio/*" onChange={handleMainFile} style={{ display: 'none' }} />
        </label>
      ) : (
        <label className="top-bar-file">
          <span className="tbf-prompt">🎵 Load audio…</span>
          <input type="file" accept="audio/*" onChange={handleMainFile} style={{ display: 'none' }} />
        </label>
      )}

      {isSeparated && (
        <div className="top-bar-player">
          <span className="tbp-time">{formatTime(displayTime)}</span>
          <div className="tbp-scrub">
            <div className="tbp-fill" style={{ width: `${stemDurationRef.current > 0 ? (displayTime / stemDurationRef.current) * 100 : 0}%` }} />
            <input
              ref={scrubberRef}
              type="range"
              style={{ position: 'absolute', inset: 0, width: '100%', opacity: 0, cursor: 'pointer', height: '100%' }}
              min="0"
              max={stemDurationRef.current || 1}
              step="0.1"
              defaultValue="0"
              onChange={handleScrub}
            />
            <div className="tbp-thumb" style={{ left: `${stemDurationRef.current > 0 ? (displayTime / stemDurationRef.current) * 100 : 0}%` }} />
          </div>
          <span className="tbp-time">{formatTime(stemDurationRef.current)}</span>
        </div>
      )}

      <div className="top-bar-controls">
        {isSeparated && (
          isPlaying ? (
            <button className="tb-btn primary" onClick={pausePlayback}>⏸ Pause</button>
          ) : (
            <button className="tb-btn primary" onClick={() => startPlayback()} disabled={activeStemKeys.size === 0}>▶ Play</button>
          )
        )}
        {isSeparated && (
          <button className="tb-btn" onClick={handleStop}>⏹</button>
        )}
        {isSeparated && activeStemKeys.size > 0 && (
          <button className="tb-btn" onClick={handleDownloadMix} title="Download active stems as mix">⬇ Mix</button>
        )}
        {audioName && (
          <button className="tb-btn danger" onClick={handleReset}>✕ Reset</button>
        )}
      </div>
    </div>

    {/* ── TAB NAV ── */}
    <nav className="kappa-nav">
      <button
        className={`kappa-nav-btn${activeTabSection === 'stems' ? ' active' : ''}`}
        onClick={() => setActiveTabSection('stems')}
      >⚡ Stems</button>
      <button
        className={`kappa-nav-btn${activeTabSection === 'guitar' ? ' active' : ''}`}
        onClick={() => setActiveTabSection('guitar')}
      >🎸 Guitar Tab</button>
      <button
        className={`kappa-nav-btn${activeTabSection === 'chords' ? ' active' : ''}`}
        onClick={() => setActiveTabSection('chords')}
      >🎵 Chords</button>
    </nav>

    {/* ══ STEMS TAB ══ */}
    {activeTabSection === 'stems' && (
      <div className="workspace">
        <aside className="controls-panel">
          <div>
            <div className="panel-label">Audio Source</div>
            {!audioName ? (
              <label className="upload-zone">
                <div className="uz-icon">🎵</div>
                <div className="uz-text">Tap to load audio</div>
                <div className="uz-hint">MP3 · WAV · FLAC · AIFF</div>
                <input type="file" accept="audio/*" onChange={handleMainFile} />
              </label>
            ) : (
              <div className="file-pill">
                <span className="fp-icon">📄</span>
                <span className="fp-name">{audioName}</span>
              </div>
            )}
          </div>

          <button className="btn-action" onClick={handleSeparate} disabled={!audioFile || processing}>
            {processing ? 'Separating…' : 'Separate Stems'}
          </button>

          {(processing || isSeparated) && (
            <div className="progress-row">
              <div className="progress-bar-bg">
                <div className={`progress-bar-fill${processing ? ' active' : ''}`} style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              <span>{Math.round(progress * 100)}%</span>
            </div>
          )}
          {fromCache && !processing && <p className="hint">✓ Loaded from cache</p>}

          {isSeparated && (
            <div>
              <div className="panel-label">Active Stems</div>
              <div className="stem-chips">
                {instrumentTypes.map(({ key, label, emoji }) => (
                  <div key={key} className="stem-chip-item">
                    <button
                      type="button"
                      className={`stem-chip${activeStemKeys.has(key) ? ' active' : ''}`}
                      onClick={() => toggleStem(key)}
                    >
                      <span className="stem-chip-label">
                        <span className="stem-chip-emoji">{emoji}</span>
                        {label}
                      </span>
                      <span className="stem-toggle-track">
                        <span className="stem-toggle-dot" />
                      </span>
                    </button>
                    <a
                      href={stems[key]}
                      download={`${audioName.replace(/\.[^.]+$/, '')}-${key}.wav`}
                      className="stem-download"
                      title={`Download ${label}`}
                    >⬇</a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>

        <div className="main-area">
          {processing && (
            <div className="processing-panel">
              <div className="waveform-animation">
                {Array.from({ length: 14 }, (_, i) => (
                  <span key={i} style={{ animationDelay: `${((i * 0.09) % 0.45).toFixed(2)}s` }} />
                ))}
              </div>
              <p className="processing-status">{fromCache ? 'Loading from cache…' : 'Separating stems…'}</p>
              {instrumentTypes.map(({ key }) => (
                <div key={key} className="skeleton-card">
                  <div className="skeleton-icon" />
                  <div className="skeleton-lines">
                    <div className="skeleton-line" />
                    <div className="skeleton-line short" />
                  </div>
                </div>
              ))}
              <p className="hint" style={{ textAlign: 'center' }}>First run downloads ~172 MB model.</p>
            </div>
          )}
          {isSeparated && !processing && (
            <>
              <div className="main-title">Stem Waveforms</div>
              <div className="stem-wave-grid">
                {instrumentTypes.map(({ key, label, emoji }) => (
                  <div key={key} className="stem-wave-card" style={{ opacity: activeStemKeys.has(key) ? 1 : 0.35 }}>
                    <div className="stem-wave-label">{emoji} {label}</div>
                    <div className="stem-wave-bar" />
                    <audio controls src={stems[key]} style={{ width: '100%', marginTop: 8, height: 28 }} />
                  </div>
                ))}
              </div>
            </>
          )}
          {!audioName && !processing && (
            <p className="hint" style={{ marginTop: 40, textAlign: 'center', color: 'var(--text-dim)' }}>
              Load an audio file from the left panel, then click Separate Stems.
            </p>
          )}
        </div>
      </div>
    )}

    {/* ══ GUITAR TAB ══ */}
    {activeTabSection === 'guitar' && (
      <div className="workspace">
        <aside className="controls-panel">
          <div>
            <div className="panel-label">Guitar Audio</div>
            <label className="upload-zone" style={{ padding: '12px' }}>
              {guitarFileLabel ? (
                <><div className="fp-icon" style={{ fontSize: 20 }}>🎸</div><div className="uz-text">{guitarFileLabel}</div></>
              ) : (
                <><div className="uz-icon">🎸</div><div className="uz-text">Tap to choose</div><div className="uz-hint">MP3 · WAV · FLAC</div></>
              )}
              <input type="file" accept="audio/*" onChange={handleGuitarFile} />
            </label>
            {!guitarFileLabel && guitarStemRef.current && (
              <p className="hint">Using guitar stem from separation</p>
            )}
          </div>

          {guitarDuration > 0 && (
            <div>
              <div className="panel-label">Range</div>
              <div
                className="range-selector"
                ref={rangeRef}
                onPointerDown={handleRangePointerDown}
                onPointerMove={handleRangePointerMove}
                onPointerUp={handleRangePointerUp}
              >
                <div className="range-track">
                  <div className="range-fill" style={{ left: `${(tabStartSec / guitarDuration) * 100}%`, width: `${((tabEndSec - tabStartSec) / guitarDuration) * 100}%` }} />
                </div>
                <div className="range-handle" data-handle="start" style={{ left: `${(tabStartSec / guitarDuration) * 100}%` }} />
                <div className="range-handle" data-handle="end" style={{ left: `${(tabEndSec / guitarDuration) * 100}%` }} />
                <div className="range-times">
                  <span>{formatTime(tabStartSec)}</span>
                  <span>{formatTime(tabEndSec)}</span>
                </div>
              </div>
            </div>
          )}

          <div>
            <div className="panel-label">Strings</div>
            <StringSelector />
          </div>

          <button className="btn-action" onClick={detectTab} disabled={tabProcessing || !guitarStemRef.current}>
            {tabProcessing ? 'Detecting…' : 'Detect Guitar Tab'}
          </button>

          {tabProcessing && (
            <div className="progress-row">
              <div className="progress-bar-bg">
                <div className={`progress-bar-fill${tabProcessing ? ' active' : ''}`} style={{ width: `${Math.round(tabProgress * 100)}%` }} />
              </div>
              <span>{Math.round(tabProgress * 100)}%</span>
            </div>
          )}

          {tabError && <p className="hint" style={{ color: 'var(--danger)' }}>{tabError}</p>}

          {guitarDuration > 0 && (
            <div>
              <div className="panel-label">Playback</div>
              <div className="stem-scrubber-row" style={{ marginBottom: 8 }}>
                <span className="stem-time">{formatTime(tabDisplayTime)}</span>
                <input
                  ref={tabScrubberRef}
                  type="range"
                  className="stem-scrubber"
                  min="0"
                  max={tabDuration || 1}
                  step="0.1"
                  defaultValue="0"
                  onChange={handleTabScrub}
                />
                <span className="stem-time">{formatTime(tabDuration)}</span>
              </div>
              <TransportBar
                onPlay={() => startTabPlayback()}
                onPause={pauseTabPlayback}
                onStop={handleTabStop}
                isPlayingAudio={tabIsPlaying}
                hasAudio={guitarDuration > 0}
              />
            </div>
          )}
        </aside>

        <div className="main-area">
          <TabTimeline onSeek={tabSeekTo} />
          <TabGrid
            lyricsLines={lyricsLines}
            tabStartSec={tabStartSec}
            lyricsCurrentTime={tabIsPlaying ? tabDisplayTime + tabStartSec : isPlaying ? displayTime : null}
          />
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
      </div>
    )}

    {/* ══ CHORDS TAB ══ */}
    {activeTabSection === 'chords' && (() => {
      const effectiveDur = chordDuration > 0 ? chordDuration : guitarDuration;
      const hasAudio = !!(chordStemRef.current || guitarStemRef.current);
      return (
        <div className="workspace">
          <aside className="controls-panel">
            <div>
              <div className="panel-label">Audio</div>
              <label className="upload-zone" style={{ padding: '12px' }}>
                {chordFileLabel ? (
                  <><div className="uz-icon">🎵</div><div className="uz-text">{chordFileLabel}</div></>
                ) : (
                  <><div className="uz-icon">🎵</div><div className="uz-text">Tap to choose</div><div className="uz-hint">or use guitar stem</div></>
                )}
                <input type="file" accept="audio/*" onChange={handleChordFile} />
              </label>
              {!chordFileLabel && guitarStemRef.current && (
                <p className="hint">Using guitar stem from separation</p>
              )}
            </div>

            {effectiveDur > 0 && (
              <div>
                <div className="panel-label">Range</div>
                <div
                  className="range-selector"
                  ref={chordRangeRef}
                  onPointerDown={handleChordRangePointerDown}
                  onPointerMove={handleChordRangePointerMove}
                  onPointerUp={handleChordRangePointerUp}
                >
                  <div className="range-track">
                    <div className="range-fill" style={{ left: `${(chordStartSec / effectiveDur) * 100}%`, width: `${((chordEndSec - chordStartSec) / effectiveDur) * 100}%` }} />
                  </div>
                  <div className="range-handle" data-handle="start" style={{ left: `${(chordStartSec / effectiveDur) * 100}%` }} />
                  <div className="range-handle" data-handle="end" style={{ left: `${(chordEndSec / effectiveDur) * 100}%` }} />
                  <div className="range-times">
                    <span>{formatTime(chordStartSec)}</span>
                    <span>{formatTime(chordEndSec)}</span>
                  </div>
                </div>
              </div>
            )}

            <button className="btn-action" onClick={detectChordsHandler} disabled={chordProcessing || !hasAudio}>
              {chordProcessing ? 'Detecting…' : 'Detect Chords'}
            </button>

            {chordProcessing && (
              <div className="progress-row">
                <div className="progress-bar-bg">
                  <div className="progress-bar-fill active" style={{ width: `${Math.round(chordProgress * 100)}%` }} />
                </div>
                <span>{Math.round(chordProgress * 100)}%</span>
              </div>
            )}

            {chordError && <p className="hint" style={{ color: 'var(--danger)' }}>{chordError}</p>}
          </aside>

          <div className="main-area">
            <ChordSheet
              segments={chordResults}
              lyricsLines={lyricsLines}
              chordStartSec={chordStartSec}
              lyricsCurrentTime={tabIsPlaying ? tabDisplayTime + tabStartSec : isPlaying ? displayTime : null}
            />
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
        </div>
      );
    })()}

  </div>
);
```

- [ ] **Step 4: Fix StringSelector to remove its wrapper card**

Open `src/components/StringSelector.jsx` and remove any outer `.card` or `.section` wrapper if one exists — it now sits directly inside `.controls-panel` which provides the container.

- [ ] **Step 5: Verify in browser**

Open `http://localhost:5174`. Check:
- Dark background, KAPPA logo in top bar
- Three tabs: Stems / Guitar Tab / Chords (no Drum Tab)
- Each tab shows left panel + right content area
- Stem player controls appear in top bar after separation
- Guitar Tab: left panel has upload → range → strings → detect → scrubber + play/pause/stop
- No console errors

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx
git commit -m "feat: desktop layout — workspace pattern, remove drum tab, stems in nav"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Desktop layout (sticky top bar + tabs + panel + main area)
- ✅ Remove drum tab (state, refs, handlers, JSX, top-level functions)
- ✅ Stem separation moves into Stems tab
- ✅ Dark Pro theme (CSS tokens, dark surfaces)
- ✅ Guitar Tab: controls in left panel, grid on right
- ✅ Chords: controls in left panel, chord sheet on right
- ✅ Lyrics panels preserved in both Guitar Tab and Chords main areas
- ✅ Stem player wired to top bar scrubber + Play/Pause/Stop

**Placeholder scan:** No TBD, no TODO, no vague steps — all code is explicit.

**Type consistency:** `formatTime`, `handleScrub`, `startPlayback`, `pausePlayback`, `handleStop`, `handleDownloadMix` are unchanged App.jsx functions. `instrumentTypes` array unchanged.
