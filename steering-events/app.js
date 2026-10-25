'use strict';
const $ = id => document.getElementById(id);
const actions = ['play', 'pause', 'stop', 'nexttrack', 'previoustrack', 'seekbackward', 'seekforward', 'togglemicrophone'];
const supported = [];
let player = null, url = null, generation = 0, count = 0, armed = true;
const start = performance.now();
function report(kind, name) {
  if (!armed || document.hidden) return;
  count += 1;
  const text = `${((performance.now() - start) / 1000).toFixed(1)} s · ${kind}: ${name}`;
  $('latest').textContent = text; $('count').textContent = String(count);
  const row = document.createElement('li'); row.textContent = text;
  $('events').prepend(row);
  while ($('events').children.length > 30) $('events').lastChild.remove();
}
function register() {
  if (!navigator.mediaSession) { $('support').textContent = 'Media Session nicht vorhanden; Tastaturereignisse werden trotzdem angezeigt.'; return; }
  for (const action of actions) {
    try { navigator.mediaSession.setActionHandler(action, () => report('Medienaktion', action)); supported.push(action); } catch {}
  }
  $('support').textContent = 'Registrierbar: ' + (supported.join(', ') || 'keine Medienaktionen') + ' · Fahrzeugweiterleitung noch unbewiesen';
}
function release() {
  generation += 1;
  if (player) { player.onended = player.onerror = null; player.pause(); player.removeAttribute('src'); player.load(); player = null; }
  if (url) { URL.revokeObjectURL(url); url = null; }
  $('tone').disabled = !armed;
  if (navigator.mediaSession) { navigator.mediaSession.playbackState = 'none'; navigator.mediaSession.metadata = null; }
}
function toneBlob() {
  const rate = 16000, length = rate * 3, buffer = new ArrayBuffer(44 + length * 2), v = new DataView(buffer);
  const text = (offset, value) => { for (let i = 0; i < value.length; i++) v.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); v.setUint32(4, 36 + length * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); text(36, 'data'); v.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i++) {
    const envelope = Math.min(1, i / 400, (length - 1 - i) / 400);
    v.setInt16(44 + i * 2, Math.round(0.08 * 32767 * envelope * Math.sin(2 * Math.PI * 440 * i / rate)), true);
  }
  return new Blob([buffer], {type: 'audio/wav'});
}
$('tone').addEventListener('click', async () => {
  if (!armed || document.hidden) return;
  release(); const run = generation;
  url = URL.createObjectURL(toneBlob()); player = new Audio(url); const owned = player;
  $('tone').disabled = true; $('state').textContent = 'Testton startet …';
  if (navigator.mediaSession && window.MediaMetadata) navigator.mediaSession.metadata = new MediaMetadata({title: 'Lenkradtasten-Test', artist: 'Kurzer Testton'});
  owned.onended = () => {
    if (run !== generation) return;
    $('tone').disabled = false; $('state').textContent = 'Ton beendet · jetzt Tasten testen (Medienregistrierung bleibt bestehen)';
    if (navigator.mediaSession) navigator.mediaSession.playbackState = 'paused';
  };
  owned.onerror = () => { if (run === generation) { release(); $('state').textContent = 'Testton konnte nicht abgespielt werden.'; } };
  try {
    await owned.play();
    if (run !== generation) return;
    $('state').textContent = 'Testton läuft · links kurz drücken';
    if (navigator.mediaSession) navigator.mediaSession.playbackState = 'playing';
  } catch { if (run === generation) { release(); $('state').textContent = 'Wiedergabe abgelehnt · erneut antippen.'; } }
});
$('release').addEventListener('click', () => { release(); $('state').textContent = 'Browseraudio freigegeben · jetzt mit nativer Musik testen'; });
$('clear').addEventListener('click', () => { count = 0; $('count').textContent = '0'; $('events').replaceChildren(); $('latest').textContent = 'Noch kein Tasten- oder Medienereignis'; });
const keys = new Set(['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaTrackNext', 'MediaTrackPrevious', 'AudioVolumeUp', 'AudioVolumeDown', 'AudioVolumeMute', 'MicrophoneToggle', 'LaunchAssistant', 'Space', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
for (const type of ['keydown', 'keyup']) document.addEventListener(type, event => {
  if (event.repeat) return;
  const name = keys.has(event.code) ? event.code : keys.has(event.key) ? event.key : 'Andere Taste (Text nicht erfasst)';
  report('Tastatur ' + type, name + (event.isTrusted ? '' : ' [synthetisch]'));
});
function suspend() {
  armed = false; release();
  for (const action of supported) { try { navigator.mediaSession.setActionHandler(action, null); } catch {} }
  $('state').textContent = 'Test nach Tabwechsel beendet · zum Fortsetzen neu laden';
}
document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); });
window.addEventListener('pagehide', suspend);
register();
