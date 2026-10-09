'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const seconds = n => Number.isFinite(n) ? n.toFixed(2).replace('.', ',') + ' s' : '–';
  const cases = {
    short: {label: 'A · Original', file: '../audio-length/clips/3', total: 3},
    padded: {label: 'B · Mit Stille', file: 'clips/short-padded-21', total: 21},
    cut: {label: 'C · Automatischer Stopp', file: 'clips/short-padded-21', total: 21, cutoff: 3},
    control: {label: 'Kontrolle · Langer Ton', file: '../audio-length/clips/20', total: 20}
  };
  let generation = 0, active = null, request = null, last = null;
  const events = [];
  function log(message) {
    events.push(new Date().toLocaleTimeString('de-DE') + ' · ' + message);
    if (events.length > 100) events.shift();
    $('log').textContent = events.join('\n');
  }
  function cleanup() {
    generation++;
    request?.abort(); request = null;
    if (active) {
      const {player, url, poll, timeout} = active;
      active = null;
      clearInterval(poll); clearTimeout(timeout);
      player.onended = player.onerror = player.onloadedmetadata = player.ontimeupdate = player.onplaying = player.onpause = null;
      player.pause(); player.removeAttribute('src'); player.load();
      URL.revokeObjectURL(url);
    }
    $('stop').disabled = true;
  }
  function resetObservation() {
    last = null;
    for (const id of ['pause-result', 'return-result']) { $(id).value = ''; $(id).disabled = true; }
    $('result').textContent = 'Nur lokal bis zum Neuladen; keine Ergebnisübermittlung.';
  }
  function finish(reason) {
    const position = active?.player.currentTime;
    if (Number.isFinite(position)) { $('time').textContent = seconds(position); $('progress').value = position; }
    if (last?.started) { last.finished = true; last.stoppedAt = position; $('return-result').disabled = false; }
    log(reason + ' · Medienzeit ' + seconds(position));
    cleanup(); $('status').textContent = reason;
  }
  async function start(key, button) {
    cleanup(); resetObservation();
    const own = generation, test = cases[key], format = $('format').value;
    document.querySelectorAll('[data-test]').forEach(node => node.setAttribute('aria-pressed', String(node === button)));
    $('status').textContent = test.label + ' · lädt …';
    $('time').textContent = '0,00 s'; $('duration').textContent = 'Dateidauer: –';
    $('progress').max = test.total; $('progress').value = 0; $('stop').disabled = false;
    const controller = new AbortController(); request = controller;
    const fetchTimeout = setTimeout(() => controller.abort(), 15000);
    const fail = message => { if (own === generation) finish(message); };
    try {
      const response = await fetch(test.file + '.' + format, {signal: controller.signal, credentials: 'omit'});
      if (!response.ok) throw new Error('Audio fehlt');
      const blob = await response.blob(); clearTimeout(fetchTimeout);
      if (own !== generation) return;
      if (!blob.size || !blob.type.startsWith('audio/')) throw new Error('Ungültiges Audio');
      request = null;
      const url = URL.createObjectURL(blob), player = new Audio(url);
      player.preload = 'auto';
      const sample = {key, label: test.label, format, started: false, finished: false, duration: null}; last = sample;
      const update = () => {
        if (own !== generation) return;
        $('time').textContent = seconds(player.currentTime); $('progress').value = player.currentTime;
        if (test.cutoff && player.currentTime >= test.cutoff) { finish('Automatisch nach dem Ton beendet'); return; }
        if (key === 'padded' && player.currentTime >= 3 && !player.paused) $('status').textContent = 'B · Stiller Rest · Datei läuft weiter';
      };
      active = {player, url, poll: setInterval(update, 50), timeout: setTimeout(() => fail('Sicherheitszeitlimit erreicht'), 45000)};
      player.onloadedmetadata = () => {
        if (own !== generation) return;
        sample.duration = player.duration;
        $('duration').textContent = 'Dateidauer: ' + seconds(player.duration);
        if (Number.isFinite(player.duration)) $('progress').max = player.duration;
        log(test.label + ' · ' + format.toUpperCase() + ' · Browserdauer ' + seconds(player.duration));
      };
      player.ontimeupdate = update;
      player.onplaying = () => {
        if (own !== generation) return;
        sample.started = true; $('pause-result').disabled = false;
        $('status').textContent = test.label + ' · spielt'; log('Spielt · Seite ' + document.visibilityState);
      };
      player.onpause = () => {
        if (own === generation && !player.ended) { $('status').textContent = 'Vom Browser pausiert'; log('Browserpause bei ' + seconds(player.currentTime)); }
      };
      player.onended = () => { if (own === generation) finish('Reguläres Dateiende'); };
      player.onerror = () => fail('Audiofehler · bitte erneut versuchen');
      await player.play();
    } catch (error) {
      fail(error.name === 'NotAllowedError' ? 'Browser blockiert Audio · erneut antippen' : 'Laden/Wiedergabe fehlgeschlagen');
    } finally { clearTimeout(fetchTimeout); }
  }
  document.querySelectorAll('[data-test]').forEach(button => {
    button.setAttribute('aria-pressed', 'false'); button.addEventListener('click', () => start(button.dataset.test, button));
  });
  $('stop').addEventListener('click', () => finish('Manuell gestoppt'));
  $('format').addEventListener('change', () => { cleanup(); resetObservation(); $('status').textContent = 'Bereit · Test antippen'; });
  for (const id of ['pause-result', 'return-result']) $(id).addEventListener('change', () => {
    if (!last?.started || (id === 'return-result' && !last.finished)) return;
    const text = last.label + ' · ' + last.format.toUpperCase() + ' · Start: ' + ($('pause-result').value || 'offen') + ' · Danach: ' + ($('return-result').value || 'offen');
    $('result').textContent = text; log('Deine Beobachtung: ' + text);
  });
  document.addEventListener('visibilitychange', () => log('Sichtbarkeit: ' + document.visibilityState));
  log('Bereit · keine automatische Wiedergabe');
})();
