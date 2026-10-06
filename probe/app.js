/* Original static probe UI. No fetch, analytics, STT, upload, or automatic media start. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const now = () => new Date().toISOString();
  const STORE = 'tesla-probe:diagnostics:v1';
  const MARKER = 'tesla-probe:reload:v1';
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const synthesis = window.speechSynthesis;
  const outputKinds = ['mp3', 'wav', 'webaudio', 'tts', 'replay'];
  const labels = { mp3: 'MP3', wav: 'WAV', webaudio: 'Web Audio', tts: 'Lokale TTS', replay: 'Aufnahme' };
  const heardLabels = { unanswered: 'Hören offen', yes: 'selbst gehört', no: 'nicht gehört', unclear: 'unklar' };
  const statusLabels = {
    'not-tested': 'Nicht getestet', requested: 'Start angefordert', 'play-resolved': 'play()-Promise erfüllt',
    'playing-event': 'Browser meldet Wiedergabe', 'start-event': 'Browser meldet Start', 'ended-event': 'Browser meldet Ende',
    canceled: 'Gestoppt / abgebrochen', error: 'Fehler', unsupported: 'Nicht verfügbar', timeout: 'Zeitlimit; gestoppt',
    'no-local-voice': 'Keine bestätigte lokale Stimme; nicht aufgerufen'
  };
  const phaseLabels = {
    idle: 'Nicht getestet · Mikrofon aus', permission: 'Warte auf Freigabe · höchstens 12 s', preparing: 'Freigabe erhalten · Pegelmessung wird vorbereitet',
    listening: 'Mikrofon aktiv · maximal 30 s ab Freigabe', recording: 'Aufnahme läuft · maximal 8 s',
    finalizing: 'Mikrofon gestoppt · Aufnahme wird abgeschlossen', stopped: 'Mikrofon gestoppt',
    canceled: 'Abgebrochen · keine automatische Wiederaufnahme', timeout: 'Freigabe-Zeitlimit erreicht · abgebrochen', error: 'Probe fehlgeschlagen · Ressourcen freigegeben'
  };
  const state = {
    startedAt: now(), events: [], outputs: {}, localVoiceCount: 0,
    touch: { a: 0, b: 0, lastPointerType: null }, typing: { inputEvents: 0, lastLength: 0, maximumLength: 0 },
    marker: { status: 'not-tested' }, lifecycle: { switchesMarked: 0, returnsMarked: 0, hiddenEvents: 0, pagehideEvents: 0, pageshowEvents: 0 },
    storage: 'not-written', downloadRequests: 0, clipboard: 'not-tested'
  };
  outputKinds.forEach(kind => { state.outputs[kind] = { attempts: 0, status: 'not-tested', heard: 'unanswered', events: [] }; });
  let activeOutput = null, outputSerial = 0, voices = [], lastReportAt = 0;
  const downloadURLs = new Set();
  const apis = {
    getUserMedia: !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function'),
    MediaRecorder: typeof window.MediaRecorder === 'function',
    AudioContext: typeof AudioContextClass === 'function',
    HTMLAudioElement: typeof window.HTMLAudioElement === 'function',
    speechSynthesis: !!synthesis,
    SpeechSynthesisUtterance: typeof window.SpeechSynthesisUtterance === 'function',
    SpeechRecognition: typeof window.SpeechRecognition !== 'undefined',
    webkitSpeechRecognition: typeof window.webkitSpeechRecognition !== 'undefined',
    clipboardWrite: !!(navigator.clipboard && navigator.clipboard.writeText)
  };
  const mic = new window.ProbeCore.MicrophoneProbe({
    getUserMedia: apis.getUserMedia ? constraints => navigator.mediaDevices.getUserMedia(constraints) : null,
    AudioContext: AudioContextClass, MediaRecorder: window.MediaRecorder, Blob: window.Blob, URL: window.URL,
    isVisible: () => !document.hidden,
    onEvent: event => {
      if (['microphone-requested', 'recording-started', 'recording-deleted'].includes(event)) resetReplayEvidence();
      log(event); renderReport(true);
    },
    onChange: snapshot => renderMic(snapshot)
  });

  function log(event) {
    state.events.push({ at: now(), event });
    if (state.events.length > 100) state.events.shift();
    $('event-log').textContent = state.events.map(item => item.at.slice(11, 19) + ' · ' + item.event).join('\n');
  }
  function environment() {
    const visual = window.visualViewport;
    return {
      secureContext: window.isSecureContext === true, protocol: location.protocol, userAgent: navigator.userAgent,
      language: navigator.language, automationHint: navigator.webdriver === true,
      screen: { width: screen.width, height: screen.height, availableWidth: screen.availWidth, availableHeight: screen.availHeight, colorDepth: screen.colorDepth },
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio: devicePixelRatio, visualWidth: visual ? visual.width : null, visualHeight: visual ? visual.height : null, visualScale: visual ? visual.scale : null },
      visibility: document.visibilityState, apis,
      audioCanPlayType: { mp3: $('mp3-audio').canPlayType('audio/mpeg'), wav: $('wav-audio').canPlayType('audio/wav') },
      localVoiceCount: state.localVoiceCount
    };
  }
  function vehicle() {
    const raw = $('vehicle-software').value.trim();
    const valid = !raw || /^\d{4}(?:\.\d{1,3}){1,4}$/.test(raw);
    $('vehicle-software').setAttribute('aria-invalid', String(!valid));
    $('version-hint').textContent = valid ? 'Nur Versionsnummer; keine VIN oder anderen persönlichen Angaben.' : 'Nicht als Versionsnummer erkannt. Dieser Text wird nicht berichtet oder gespeichert.';
    return { model: $('vehicle-model').value || null, mcu: $('vehicle-mcu').value || null, software: raw && valid ? raw : null, softwareInputValid: valid, contextSelfReported: $('test-context').value };
  }
  function report() {
    const checklist = {};
    document.querySelectorAll('[data-check]').forEach(select => { checklist[select.dataset.check] = select.value; });
    return {
      schema: 'tesla-browser-probe/v1', startedAt: state.startedAt, generatedAt: now(),
      evidenceBoundary: 'Beobachtung dieses Browsers. API-Präsenz, Browserereignisse und menschliche Bewertung getrennt. Keine bestätigte Tesla-Hardwarefähigkeit, keine automatische Gesamtfreigabe.',
      privacy: { uploads: false, audioPersistence: false, automaticMetadataSave: false, typingContentCollected: false, deviceIdentifiersCollected: false, speechRecognitionStarted: false, speechSynthesisPolicy: 'localService === true only; browser-reported locality' },
      environment: environment(), vehicle: vehicle(), microphone: mic.report(), audioOutput: state.outputs,
      manualChecklist: checklist, audioFocusManual: $('focus-result').value,
      lifecycle: state.lifecycle, reloadMarker: state.marker, touch: state.touch, typing: state.typing,
      storage: state.storage, export: { downloadRequests: state.downloadRequests, clipboard: state.clipboard },
      eventLog: state.events
    };
  }
  function renderEnvironment() {
    const entries = [
      ['Sicherer Kontext', window.isSecureContext ? 'Ja · noch keine Freigabe' : 'Nein · Mikrofon kann blockiert sein'],
      ['getUserMedia', apis.getUserMedia ? 'API vorhanden' : 'API fehlt'],
      ['MediaRecorder', apis.MediaRecorder ? 'API vorhanden' : 'API fehlt'],
      ['Web Audio', apis.AudioContext ? 'API vorhanden' : 'API fehlt'],
      ['speechSynthesis', apis.speechSynthesis ? 'API vorhanden' : 'API fehlt'],
      ['SpeechRecognition', apis.SpeechRecognition || apis.webkitSpeechRecognition ? 'API vorhanden · wird NICHT gestartet' : 'API fehlt · kein Startversuch']
    ];
    $('api-list').textContent = '';
    entries.forEach(([key, value]) => {
      const dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = key; dd.textContent = value; $('api-list').append(dt, dd);
    });
    const e = environment();
    $('environment-details').textContent = 'Viewport: ' + e.viewport.width + ' × ' + e.viewport.height + ' · DPR ' + e.viewport.devicePixelRatio + '\nBildschirm: ' + e.screen.width + ' × ' + e.screen.height + '\nAutomationshinweis: ' + (e.automationHint ? 'ja; kein Hardwarebeleg' : 'nein; dennoch kein Hardwarebeleg') + '\nUser-Agent: ' + e.userAgent;
  }
  function renderReport(force) {
    if (!force && Date.now() - lastReportAt < 1000) return;
    lastReportAt = Date.now();
    const r = report(), attempts = r.microphone.attempts, latest = attempts[attempts.length - 1];
    $('report-text').value = JSON.stringify(r, null, 2);
    const e = r.environment, v = r.vehicle;
    const lines = [
      'BROWSER-PROBE · KEINE GESAMTFREIGABE',
      r.generatedAt,
      (v.model || 'Modell offen') + ' / ' + (v.mcu || 'MCU offen') + ' / ' + (v.software || 'Software offen'),
      'Kontext: ' + v.contextSelfReported + (e.automationHint ? ' · AUTOMATION ERKANNT' : ''),
      'Viewport ' + e.viewport.width + '×' + e.viewport.height + ' · DPR ' + e.viewport.devicePixelRatio + ' · Secure ' + (e.secureContext ? 'ja' : 'nein'),
      'APIs: Mic ' + (apis.getUserMedia ? 'ja' : 'nein') + ' / Recorder ' + (apis.MediaRecorder ? 'ja' : 'nein') + ' / WebAudio ' + (apis.AudioContext ? 'ja' : 'nein'),
      'Mic-Versuche: ' + attempts.length + ' · Freigabe: ' + (latest ? latest.permission : 'nicht getestet'),
      'Pegel: ' + (latest ? latest.meter.status + ' (RMS max ' + latest.meter.rmsMax.toFixed(4) + ')' : 'nicht getestet'),
      'Aufnahme: ' + (latest ? latest.recording.status + ' · ' + latest.recording.bytes + ' Bytes' : 'nicht getestet'),
      'Live-Tracks: ' + r.microphone.liveTracks + ' · Freigabe offen: ' + (r.microphone.pendingPermission ? 'ja' : 'nein'),
      ...outputKinds.map(kind => labels[kind] + (kind === 'replay' && r.audioOutput[kind].microphoneAttemptId ? ' (Versuch ' + r.audioOutput[kind].microphoneAttemptId + ')' : '') + ': ' + (statusLabels[r.audioOutput[kind].status] || r.audioOutput[kind].status) + ' / ' + heardLabels[r.audioOutput[kind].heard]),
      'Zyklus manuell: ' + Object.values(r.manualChecklist).join(' / '),
      'Hidden/Pagehide: ' + state.lifecycle.hiddenEvents + '/' + state.lifecycle.pagehideEvents + ' · Rückkehr markiert: ' + state.lifecycle.returnsMarked,
      'Audiofokus: ' + r.audioFocusManual + ' · Marker: ' + state.marker.status,
      'Touch A/B: ' + state.touch.a + '/' + state.touch.b + ' · Eingaben: ' + state.typing.inputEvents,
      'Kein Upload · kein Audio gespeichert · Tesla-Hardware unbestätigt'
    ];
    $('compact-report').textContent = lines.join('\n');
  }
  function renderActivity() {
    const s = mic.snapshot();
    $('activity').textContent = (s.pendingPermission ? 'Freigabe noch offen' : s.liveTracks ? 'Mikrofon aktiv: ' + s.liveTracks + ' Track(s)' : 'Mikrofon aus') + ' · ' + (activeOutput ? labels[activeOutput.kind] + ' angefordert/aktiv' : 'Ausgabe aus');
  }
  function renderMic(snapshot) {
    const s = snapshot || mic.snapshot(), a = s.latest;
    $('mic-start').disabled = !s.canStart;
    $('mic-stop').disabled = !['permission', 'preparing', 'listening', 'recording'].includes(s.phase);
    $('record-start').disabled = !s.canRecord;
    $('record-stop').disabled = s.phase !== 'recording';
    $('play-replay').disabled = !s.canReplay;
    $('delete-audio').disabled = !s.canReplay;
    let text = phaseLabels[s.phase] || s.phase;
    if (s.phase === 'recording') text += ' · ' + (s.recordingElapsedMs / 1000).toFixed(1) + ' s';
    if (s.pendingPermission && s.phase !== 'permission') text += '. Alter Freigabedialog noch offen: im Browser schließen oder neu laden. Späte Streams werden sofort gestoppt.';
    if (a && a.permissionError) text += ' · ' + a.permissionError;
    if (a && a.recording.status === 'ready') text += ' · Aufnahmebytes vorhanden; Hörtest noch manuell';
    $('mic-status').textContent = text;
    $('rms-meter').value = Math.min(1, s.rms);
    $('meter-values').textContent = 'RMS ' + s.rms.toFixed(4) + ' · Peak ' + s.peak.toFixed(4);
    if (a) {
      const m = a.meter;
      $('signal-status').textContent = 'Pegelstatus: ' + m.status + ' · ' + m.samples + ' Messungen · RMS max ' + m.rmsMax.toFixed(4) + ' · Peak max ' + m.peakMax.toFixed(4) + '. Energie ≠ verständliche Sprache.';
      $('track-info').textContent = JSON.stringify({ permission: a.permission, tracksAtGrant: a.tracksAtGrant, tracksAfterStop: a.tracksAfterStop, recording: a.recording }, null, 2);
    }
    renderActivity();
    renderReport();
  }
  function resetReplayEvidence() {
    // Hearing evidence belongs to one recording, never to its replacement.
    state.outputs.replay = { attempts: 0, status: 'not-tested', heard: 'unanswered', events: [] };
    renderOutput('replay');
  }
  function renderOutput(kind) {
    const data = state.outputs[kind];
    let text = (statusLabels[data.status] || data.status) + ' · ' + heardLabels[data.heard];
    if (data.error) text += ' · ' + data.error;
    if (kind === 'replay' && data.microphoneAttemptId) text += ' · Mic-Versuch ' + data.microphoneAttemptId;
    if (kind === 'tts') text += ' · bestätigte lokale Stimmen: ' + state.localVoiceCount;
    $(kind + '-status').textContent = text;
    document.querySelectorAll('.heard[data-kind="' + kind + '"] button').forEach(button => {
      button.disabled = !data.attempts;
      button.setAttribute('aria-pressed', String(data.heard === button.dataset.heard));
    });
    renderActivity(); renderReport(true);
  }
  function validJob(job) { return activeOutput === job && !document.hidden; }
  function outputEvent(job, event) {
    if (!validJob(job)) return;
    const data = state.outputs[job.kind];
    data.events.push({ at: now(), event });
    if (data.events.length > 12) data.events.shift();
    data.status = event;
    renderOutput(job.kind);
  }
  function cleanJob(job) {
    clearTimeout(job.timer);
    if (job.audio) {
      try { job.audio.pause(); job.audio.currentTime = 0; } catch (_) { /* Unloaded media. */ }
    }
    if (job.oscillator) { try { job.oscillator.stop(); job.oscillator.disconnect(); } catch (_) { /* Already ended. */ } }
    if (job.context) {
      try { const result = job.context.close(); if (result && result.catch) result.catch(() => {}); } catch (_) { /* Best effort; no mic tracks attached here. */ }
    }
    if (job.kind === 'tts' && synthesis) { try { synthesis.cancel(); } catch (_) { /* Unsupported service. */ } }
  }
  function finishOutput(job, status, error) {
    if (activeOutput !== job) return;
    activeOutput = null; // Invalidate before pause/cancel callbacks.
    const data = state.outputs[job.kind];
    data.status = status;
    data.finishedAt = now();
    data.events.push({ at: data.finishedAt, event: status });
    if (error) data.error = error;
    cleanJob(job);
    log('output-' + job.kind + '-' + status);
    renderOutput(job.kind);
  }
  function stopOutput(reason) {
    if (!activeOutput) return;
    const job = activeOutput;
    state.outputs[job.kind].stopReason = reason;
    finishOutput(job, 'canceled');
  }
  function detachReplay() {
    const audio = $('replay-audio');
    audio.pause(); audio.removeAttribute('src'); audio.load();
  }
  function beginOutput(kind) {
    if (document.hidden) return null;
    stopOutput('replaced');
    const s = mic.snapshot();
    if (s.liveTracks || s.pendingPermission || s.phase === 'finalizing') {
      detachReplay(); mic.cancel('audio-output');
    }
    state.outputs[kind] = { attempts: state.outputs[kind].attempts + 1, status: 'requested', heard: 'unanswered', requestedAt: now(), events: [] };
    if (kind === 'replay') state.outputs[kind].microphoneAttemptId = mic.snapshot().latest.id;
    const job = activeOutput = { id: ++outputSerial, kind };
    job.timer = setTimeout(() => finishOutput(job, 'timeout'), kind === 'webaudio' ? 4000 : 15000);
    log('output-' + kind + '-requested'); renderOutput(kind);
    return job;
  }
  function playAudio(kind) {
    if (kind === 'replay' && !mic.getRecordingUrl()) return;
    const job = beginOutput(kind);
    if (!job) return;
    const audio = job.audio = $(kind + '-audio');
    if (kind === 'replay') audio.src = mic.getRecordingUrl();
    audio.onplay = () => { if (!validJob(job)) audio.pause(); };
    audio.onplaying = () => outputEvent(job, 'playing-event');
    audio.onended = () => finishOutput(job, 'ended-event');
    audio.onerror = () => {
      if (activeOutput === job) finishOutput(job, 'error', 'MediaError-' + (audio.error ? audio.error.code : 'unknown'));
    };
    try {
      audio.currentTime = 0;
      const promise = audio.play(); // Only this deliberate button handler calls play().
      if (promise && promise.then) promise.then(() => outputEvent(job, 'play-resolved')).catch(error => {
        if (activeOutput === job) finishOutput(job, 'error', window.ProbeCore.errorName(error));
      });
      else outputEvent(job, 'requested');
    } catch (error) { finishOutput(job, 'error', window.ProbeCore.errorName(error)); }
  }
  async function playTone() {
    const job = beginOutput('webaudio');
    if (!job) return;
    if (!apis.AudioContext) { finishOutput(job, 'unsupported'); return; }
    try {
      const context = job.context = new AudioContextClass();
      if (context.state === 'suspended') await context.resume();
      if (!validJob(job)) return;
      if (context.state !== 'running') throw new Error('AudioContextNotRunning');
      const oscillator = job.oscillator = context.createOscillator(), gain = context.createGain();
      oscillator.frequency.value = 523.25;
      oscillator.type = 'sine';
      gain.gain.setValueAtTime(0, context.currentTime);
      gain.gain.linearRampToValueAtTime(0.045, context.currentTime + 0.04);
      gain.gain.setValueAtTime(0.045, context.currentTime + 0.9);
      gain.gain.linearRampToValueAtTime(0, context.currentTime + 1);
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.onended = () => finishOutput(job, 'ended-event');
      oscillator.start(); oscillator.stop(context.currentTime + 1);
      outputEvent(job, 'start-event');
    } catch (error) { if (activeOutput === job) finishOutput(job, 'error', window.ProbeCore.errorName(error)); }
  }
  function refreshVoices() {
    try { voices = synthesis ? synthesis.getVoices().filter(voice => voice.localService === true) : []; }
    catch (_) { voices = []; }
    state.localVoiceCount = voices.length;
    const select = $('local-voice'); select.textContent = '';
    if (!voices.length) {
      const option = document.createElement('option'); option.textContent = 'Keine lokale Stimme bestätigt'; select.append(option);
    } else voices.forEach((voice, index) => {
      const option = document.createElement('option'); option.value = String(index); option.textContent = voice.name + ' · ' + voice.lang + ' · lokal'; select.append(option);
    });
    select.disabled = !voices.length;
    $('play-tts').disabled = !voices.length || !apis.SpeechSynthesisUtterance;
    renderOutput('tts');
  }
  function playSpeech() {
    const voice = voices[Number($('local-voice').value)];
    if (!voice || voice.localService !== true || !apis.SpeechSynthesisUtterance || document.hidden) return;
    const job = beginOutput('tts');
    if (!job) return;
    try {
      const utterance = job.utterance = new SpeechSynthesisUtterance('Dies ist ein lokaler Browser-Test. Das Fahrzeug steht.');
      utterance.voice = voice; utterance.lang = voice.lang; utterance.rate = 1; utterance.volume = 0.65;
      state.outputs.tts.voice = { language: voice.lang, localService: true, evidence: 'browser-reported' };
      utterance.onstart = () => outputEvent(job, 'start-event');
      utterance.onend = () => finishOutput(job, 'ended-event');
      utterance.onerror = event => {
        const code = /^[a-z-]{1,50}$/.test(event.error) ? event.error : 'speech-error';
        if (activeOutput === job) finishOutput(job, 'error', code);
      };
      if (voice.localService !== true) { finishOutput(job, 'no-local-voice'); return; }
      synthesis.speak(utterance);
    } catch (error) { finishOutput(job, 'error', window.ProbeCore.errorName(error)); }
  }
  function clearTyping() { $('typing-test').value = ''; state.typing.lastLength = 0; $('typing-status').textContent = 'Text geleert; Inhalt wurde nicht erfasst.'; }
  function releaseDownloads() { downloadURLs.forEach(url => URL.revokeObjectURL(url)); downloadURLs.clear(); }
  function stopAll(reason) {
    stopOutput(reason);
    detachReplay();
    mic.cancel(reason);
    releaseDownloads();
    renderReport(true);
  }

  $('stop-all').addEventListener('click', () => stopAll('user'));
  $('mic-start').addEventListener('click', () => { stopOutput('microphone-start'); detachReplay(); mic.start(); });
  $('mic-stop').addEventListener('click', () => mic.stop('user'));
  $('record-start').addEventListener('click', () => mic.startRecording());
  $('record-stop').addEventListener('click', () => mic.finishRecording('user'));
  $('delete-audio').addEventListener('click', () => { if (activeOutput && activeOutput.kind === 'replay') stopOutput('audio-deleted'); detachReplay(); mic.clearRecording(); renderReport(true); });
  ['mp3', 'wav', 'replay'].forEach(kind => $( 'play-' + kind).addEventListener('click', () => playAudio(kind)));
  $('play-webaudio').addEventListener('click', playTone);
  $('refresh-voices').addEventListener('click', refreshVoices);
  $('play-tts').addEventListener('click', playSpeech);
  if (synthesis && synthesis.addEventListener) synthesis.addEventListener('voiceschanged', refreshVoices);
  document.querySelectorAll('.heard button').forEach(button => button.addEventListener('click', () => {
    const kind = button.closest('.heard').dataset.kind;
    if (!state.outputs[kind].attempts) return;
    state.outputs[kind].heard = button.dataset.heard;
    state.outputs[kind].manualAt = now();
    log('manual-hearing-' + kind + '-' + button.dataset.heard); renderOutput(kind);
  }));
  document.querySelectorAll('[data-check], #vehicle-model, #vehicle-mcu, #test-context, #focus-result').forEach(input => input.addEventListener('change', () => renderReport(true)));
  $('vehicle-software').addEventListener('input', () => renderReport(true));
  $('mark-switch').addEventListener('click', () => {
    state.lifecycle.switchesMarked++; log('manual-view-switch-marked');
    $('lifecycle-status').textContent = 'Wechsel vorgemerkt. Jetzt Fahrzeugansicht wechseln; nach Rückkehr selbst prüfen. Dieser Knopf beweist keinen Wechsel.'; renderReport(true);
  });
  $('mark-return').addEventListener('click', () => {
    state.lifecycle.returnsMarked++; stopAll('manual-return'); log('manual-return-no-auto-resume');
    $('lifecycle-status').textContent = 'Rückkehr manuell markiert. Alle Ressourcen gestoppt; einen weiteren Versuch selbst starten.'; renderReport(true);
  });
  document.addEventListener('visibilitychange', () => {
    log('visibility-' + document.visibilityState);
    if (document.hidden) { state.lifecycle.hiddenEvents++; stopAll('hidden'); clearTyping(); }
    renderEnvironment(); renderReport(true);
  });
  window.addEventListener('pagehide', event => { state.lifecycle.pagehideEvents++; log('pagehide-persisted-' + Boolean(event.persisted)); stopAll('pagehide'); clearTyping(); });
  window.addEventListener('pageshow', event => { state.lifecycle.pageshowEvents++; log('pageshow-persisted-' + Boolean(event.persisted)); renderEnvironment(); renderReport(true); });
  document.addEventListener('freeze', () => { log('freeze'); stopAll('freeze'); clearTyping(); });
  window.addEventListener('resize', () => { renderEnvironment(); renderReport(true); });
  ['a', 'b'].forEach(key => {
    $('touch-' + key).addEventListener('pointerdown', event => { state.touch.lastPointerType = ['touch', 'mouse', 'pen'].includes(event.pointerType) ? event.pointerType : 'unknown'; });
    $('touch-' + key).addEventListener('click', () => { state.touch[key]++; $('touch-' + key).textContent = 'Ziel ' + key.toUpperCase() + ' · ' + state.touch[key]; renderReport(true); });
  });
  $('typing-test').addEventListener('input', () => {
    state.typing.inputEvents++; state.typing.lastLength = $('typing-test').value.length;
    state.typing.maximumLength = Math.max(state.typing.maximumLength, state.typing.lastLength);
    $('typing-status').textContent = state.typing.lastLength + ' Zeichen im Feld · ' + state.typing.inputEvents + ' Eingabeereignis(se). Inhalt wird nicht übernommen.';
    renderReport(true);
  });
  $('clear-typing').addEventListener('click', () => { clearTyping(); renderReport(true); });
  function navigationType() {
    try { const entry = performance.getEntriesByType('navigation')[0]; return entry ? entry.type : 'unknown'; } catch (_) { return 'unknown'; }
  }
  function readMarker() {
    try {
      const raw = localStorage.getItem(MARKER);
      if (raw) {
        const marker = JSON.parse(raw);
        if (marker.version === 1 && typeof marker.createdAt === 'string' && /^\d{4}-\d\d-\d\dT[0-9:.]+Z$/.test(marker.createdAt)) state.marker = { status: 'recovered', createdAt: marker.createdAt, navigationType: navigationType() };
        else state.marker = { status: 'invalid-marker' };
      } else state.marker = { status: 'absent', navigationType: navigationType() };
      if (localStorage.getItem(STORE)) $('storage-status').textContent = 'Ein früher bewusst gespeicherter Bericht ist vorhanden. Er ist nicht das aktuelle Messergebnis.';
    } catch (error) { state.marker = { status: 'storage-error', error: window.ProbeCore.errorName(error) }; }
    renderMarker();
  }
  function renderMarker() {
    $('marker-status').textContent = ({ absent: 'Kein Marker gefunden; noch kein Persistenznachweis.', recovered: 'Marker aus lokalem Speicher wiedergefunden. Navigation: ' + (state.marker.navigationType || 'offen') + '. Kein Identitätsnachweis.', set: 'Marker geschrieben. Jetzt manuell neu laden; erst danach ist Wiederfinden beobachtbar.', deleted: 'Lokaler Marker gelöscht.', 'storage-error': 'Lokaler Speicher nicht zugänglich.', 'invalid-marker': 'Ungültiger Marker; kein positiver Nachweis.' })[state.marker.status] || state.marker.status;
  }
  $('marker-set').addEventListener('click', () => {
    try {
      const marker = { version: 1, createdAt: now() };
      localStorage.setItem(MARKER, JSON.stringify(marker));
      if (localStorage.getItem(MARKER) !== JSON.stringify(marker)) throw new Error('StorageReadbackMismatch');
      state.marker = { status: 'set', createdAt: marker.createdAt };
      log('reload-marker-written-explicitly');
    } catch (error) { state.marker = { status: 'storage-error', error: window.ProbeCore.errorName(error) }; }
    renderMarker(); renderReport(true);
  });
  $('reload-page').addEventListener('click', () => { stopAll('reload'); clearTyping(); location.reload(); });
  $('photo-mode').addEventListener('click', () => {
    const enabled = document.body.classList.toggle('photo-mode');
    $('photo-mode').setAttribute('aria-pressed', String(enabled));
    $('photo-mode').textContent = enabled ? 'Fotoansicht beenden' : 'Fotoansicht öffnen';
    renderReport(true); window.scrollTo(0, 0);
  });
  $('refresh-report').addEventListener('click', () => renderReport(true));
  $('report-details').addEventListener('toggle', () => { if ($('report-details').open) renderReport(true); });
  $('copy-report').addEventListener('click', async () => {
    renderReport(true);
    if (!apis.clipboardWrite) { $('export-status').textContent = 'Zwischenablage fehlt. „Text auswählen“ oder Kompaktkarte fotografieren.'; return; }
    try {
      await navigator.clipboard.writeText($('report-text').value);
      state.clipboard = 'write-resolved';
      $('export-status').textContent = 'Browser bestätigt Schreiben in die Zwischenablage. Zum Prüfen selbst in ein lokales Textfeld einfügen.';
    } catch (error) { state.clipboard = window.ProbeCore.errorName(error); $('export-status').textContent = 'Kopieren fehlgeschlagen. „Text auswählen“ oder Foto-Fallback nutzen.'; }
    renderReport(true);
  });
  $('select-report').addEventListener('click', () => {
    renderReport(true); $('report-details').open = true; $('report-text').focus(); $('report-text').select();
    $('export-status').textContent = 'Text markiert. Über die Browserfunktion kopieren; alternativ Kompaktkarte fotografieren.';
  });
  $('download-report').addEventListener('click', () => {
    state.downloadRequests++; renderReport(true);
    try {
      const url = URL.createObjectURL(new Blob([$('report-text').value], { type: 'application/json' }));
      downloadURLs.add(url);
      const a = document.createElement('a'); a.href = url; a.download = 'browser-probe-' + now().slice(0, 10) + '.json';
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => { URL.revokeObjectURL(url); downloadURLs.delete(url); }, 10000);
      $('export-status').textContent = 'Download angefordert, nicht als gespeichert bestätigt. Falls keine Datei erscheint: Text kopieren oder Kompaktkarte fotografieren.';
    } catch (_) { $('export-status').textContent = 'Download nicht verfügbar. Text kopieren oder Kompaktkarte fotografieren.'; }
  });
  $('save-diagnostics').addEventListener('click', () => {
    renderReport(true);
    try {
      const text = $('report-text').value;
      localStorage.setItem(STORE, text);
      if (localStorage.getItem(STORE) !== text) throw new Error('StorageReadbackMismatch');
      state.storage = 'explicit-save-readback-confirmed';
      $('storage-status').textContent = 'Metadaten lokal geschrieben und zurückgelesen. Kein Audio, kein Autosave. Andere Nutzer dieses Profils können sie lesen.';
      log('diagnostics-saved-explicitly');
    } catch (error) { state.storage = 'save-error-' + window.ProbeCore.errorName(error); $('storage-status').textContent = 'Speichern fehlgeschlagen; Foto oder manuellen Export nutzen.'; }
    renderReport(true);
  });
  $('show-saved').addEventListener('click', () => {
    try { $('saved-report').textContent = localStorage.getItem(STORE) || 'Kein gespeicherter Bericht vorhanden.'; $('saved-report').hidden = false; }
    catch (_) { $('storage-status').textContent = 'Lokaler Speicher nicht lesbar.'; }
  });
  $('delete-local').addEventListener('click', () => {
    stopAll('delete-local');
    try {
      localStorage.removeItem(STORE); localStorage.removeItem(MARKER);
      if (localStorage.getItem(STORE) !== null || localStorage.getItem(MARKER) !== null) throw new Error('StorageDeleteMismatch');
      state.storage = 'deleted-readback-confirmed'; state.marker = { status: 'deleted' };
      $('saved-report').textContent = ''; $('saved-report').hidden = true;
      $('storage-status').textContent = 'Probe-Diagnosen und Marker lokal gelöscht und Abwesenheit geprüft. Aktueller Metadatenbericht bleibt bis Reload im RAM.';
      log('local-probe-data-deleted');
    } catch (_) { state.storage = 'delete-error'; $('storage-status').textContent = 'Löschen nicht bestätigt. Bei Bedarf Browserdaten über die Fahrzeugeinstellungen löschen.'; }
    renderMarker(); renderReport(true);
  });

  log('page-ready-no-media-start');
  readMarker(); renderEnvironment(); renderMic();
  outputKinds.forEach(renderOutput); refreshVoices(); renderReport(true);
})();
