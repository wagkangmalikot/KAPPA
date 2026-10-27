import { useState } from 'react';
import { useTabStore } from '../tabStore';

const OPTIONS = [
  { value: 4, label: '4-String Bass' },
  { value: 6, label: '6-String Guitar' },
  { value: 7, label: '7-String Guitar' },
];

export function StringSelector() {
  const { stringCount, setStringCount, tab } = useTabStore();
  const [pendingCount, setPendingCount] = useState(null);

  function hasDataOnRemovedStrings(newCount) {
    if (newCount >= tab.length) return false;
    return tab.slice(newCount).some(row => row.some(cell => cell !== null));
  }

  function handleChange(e) {
    const next = Number(e.target.value);
    if (hasDataOnRemovedStrings(next)) {
      setPendingCount(next);
    } else {
      setStringCount(next);
    }
  }

  return (
    <div className="string-selector">
      <label className="string-selector-label" htmlFor="string-selector-input">Strings</label>
      <select
        id="string-selector-input"
        className="string-selector-select"
        value={stringCount}
        onChange={handleChange}
      >
        {OPTIONS.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      {pendingCount !== null && (
        <div className="string-selector-dialog">
          <div className="string-selector-dialog-box">
            <p>Switching to {pendingCount} strings removes data on hidden strings. Continue?</p>
            <div className="string-selector-dialog-actions">
              <button className="btn-danger" onClick={() => { setStringCount(pendingCount); setPendingCount(null); }}>
                Yes, switch
              </button>
              <button onClick={() => setPendingCount(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
