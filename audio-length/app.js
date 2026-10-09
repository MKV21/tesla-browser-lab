'use strict';
(() => {
  const lengths = [3, 15, 15.5, 16, 16.5, 17, 17.5, 18, 18.5, 19, 19.5, 20];
  const $ = id => document.getElementById(id);
  const seconds = value => Number.isFinite(value) ? value.toFixed(2).replace('.', ',') + ' s' : '–';
  let generation = 0, active = null, controller = null, last = null;
  const events = [];
  function log(text) {
    events.push(new Date().toLocaleTimeString('de-DE') + ' · ' + text);
    if (events.length > 100) events.shift();
    $('log').textContent = events.join('\n');
  }
  function cleanup() {
    generation++;
    controller?.abort(); controller = null;
    if (active) {
      const {player, url, timer} = active;
      active = null;
      clearTimeout(timer);
      player.onended = player.onerror = player.onloadedmetadata = player.ontimeupdate = player.onpause = player.onplaying = null;
      player.pause(); player.removeAttribute('src'); player.load();
      URL.revokeObjectURL(url);
    }
    $('stop').disabled = true;
  }
  function resetAnswers() {
    document.querySelectorAll('[data-result]').forEach(button => { button.disabled = true; button.setAttribute('aria-pressed', 'false'); });
  }
  async function start(length, selected) {
    cleanup();
    const own = generation;
    const format = $('format').value;
    last = null; resetAnswers();
    $('result').textContent = 'Die Seite kann die Tesla-Musik nicht selbst messen.';
    document.querySelectorAll('#lengths button').forEach(button => button.setAttribute('aria-pressed', String(button === selected)));
    $('status').textContent = seconds(length) + ' · wird geladen …';
    $('duration').textContent = 'Dateidauer: –'; $('time').textContent = '0,00 s';
    $('progress').max = length; $('progress').value = 0; $('stop').disabled = false;
    const request = new AbortController(); controller = request;
    let fetchTimeout = setTimeout(() => request.abort(), 15000);
    const fail = message => {
      if (own !== generation) return;
      log(message); cleanup(); $('status').textContent = message;
    };
    try {
      const response = await fetch('clips/' + String(length).replace('.', '-') + '.' + format, {signal: request.signal, credentials: 'omit'});
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const blob = await response.blob();
      clearTimeout(fetchTimeout); fetchTimeout = null;
      if (own !== generation) return;
      if (!blob.size || !blob.type.startsWith('audio/')) throw new Error('Keine Audiodatei empfangen');
      controller = null;
      const url = URL.createObjectURL(blob);
      const player = new Audio(url); player.preload = 'auto';
      active = {player, url, timer: setTimeout(() => fail('Zeitlimit · Wiedergabe gestoppt'), 45000)};
      last = {length, format, duration: null, started: false};
      const sample = last;
      player.onloadedmetadata = () => {
        if (own !== generation) return;
        sample.duration = player.duration;
        $('duration').textContent = 'Dateidauer: ' + seconds(player.duration);
        if (Number.isFinite(player.duration)) $('progress').max = player.duration;
        log(format.toUpperCase() + ' · Ziel ' + seconds(length) + ' · Browserdauer ' + seconds(player.duration));
      };
      player.ontimeupdate = () => {
        if (own !== generation) return;
        $('time').textContent = seconds(player.currentTime);
        $('progress').value = player.currentTime;
      };
      player.onplaying = () => {
        if (own !== generation) return;
        sample.started = true;
        $('status').textContent = seconds(length) + ' · spielt';
        document.querySelectorAll('[data-result]').forEach(button => { button.disabled = false; });
        log('Spielt · Seite ' + document.visibilityState);
      };
      player.onpause = () => {
        if (own === generation && !player.ended) {
          $('status').textContent = 'Vom Browser pausiert'; log('Pause-Ereignis bei ' + seconds(player.currentTime));
        }
      };
      player.onended = () => {
        if (own !== generation) return;
        $('progress').value = $('progress').max;
        $('time').textContent = seconds(player.duration);
        log('Reguläres Ende · Seite ' + document.visibilityState);
        cleanup(); $('status').textContent = seconds(length) + ' · beendet';
      };
      player.onerror = () => fail('Audio konnte nicht abgespielt werden');
      await player.play();
    } catch (error) {
      if (own === generation) fail(error.name === 'NotAllowedError' ? 'Browser blockiert Audio · erneut antippen' : 'Laden/Wiedergabe fehlgeschlagen · erneut antippen');
    } finally { clearTimeout(fetchTimeout); }
  }
  lengths.forEach(length => {
    const button = document.createElement('button');
    button.textContent = String(length).replace('.', ',') + ' s';
    button.dataset.seconds = String(length); button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => start(length, button)); $('lengths').append(button);
  });
  $('stop').addEventListener('click', () => { log('Manuell gestoppt'); cleanup(); $('status').textContent = 'Gestoppt'; });
  $('format').addEventListener('change', () => { cleanup(); last = null; resetAnswers(); $('status').textContent = 'Bereit · neue Länge antippen'; });
  document.querySelectorAll('[data-result]').forEach(button => button.addEventListener('click', () => {
    if (!last?.started) return;
    const text = last.format.toUpperCase() + ' · ' + seconds(last.length) + ' (Browser: ' + seconds(last.duration) + '): Musik ' + button.dataset.result;
    document.querySelectorAll('[data-result]').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
    $('result').textContent = text; log('Deine Beobachtung: ' + text);
  }));
  // Intentionally do not stop on visibilitychange: this public, non-private page
  // tests whether Tesla continues the finite file while the map is shown.
  document.addEventListener('visibilitychange', () => log('Sichtbarkeit: ' + document.visibilityState));
  log('Bereit · Audio Session API: ' + ('audioSession' in navigator ? 'vorhanden' : 'nicht vorhanden'));
})();
