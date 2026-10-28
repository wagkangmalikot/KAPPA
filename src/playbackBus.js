// Lets independent players (stems, guitar-tab audio, pentatonic band) keep only
// one of them sounding: whoever starts announces itself, the others pause.
const EVENT = 'kappa:playback-start';

export function announcePlayback(source) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: source }));
}

// handler(source) runs whenever any player starts; returns an unsubscribe function
export function onPlaybackStart(handler) {
  const listener = e => handler(e.detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
