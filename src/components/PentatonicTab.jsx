import { memo, useEffect, useRef } from 'react';
import { mountPentatonic } from '../pentatonic/engine';
import '../pentatonic/pentatonic.css';

// Stays mounted while hidden so the chosen key, positions and progression survive
// tab switches. Backing-track playback stops when the tab is left.
export const PentatonicTab = memo(function PentatonicTab({ active }) {
  const containerRef = useRef(null);
  const engineRef = useRef(null);

  useEffect(() => {
    engineRef.current = mountPentatonic(containerRef.current);
    return () => {
      engineRef.current.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!engineRef.current) return;
    if (active) engineRef.current.resync();
    else engineRef.current.stop();
  }, [active]);

  return <div ref={containerRef} className="pt-root" hidden={!active} />;
});
