/* Original, dependency-free capture controller. Audio never leaves this page. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ProbeCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const PERMISSION_MS = 12000;
  const LISTEN_MS = 30000;
  const RECORD_MS = 8000;
  const FINALIZE_MS = 2000;
  const MAX_BYTES = 4 * 1024 * 1024;
  const SIGNAL_THRESHOLD = 0.003; // Observed energy, NOT intelligible speech or hardware identity.
  const clone = value => JSON.parse(JSON.stringify(value));
  function errorName(error) {
    return error && /^[A-Za-z]{1,64}$/.test(error.name) ? error.name : 'Error';
  }
  function trackInfo(stream) {
    let tracks = [];
    try { tracks = stream ? stream.getTracks() : []; } catch (_) { /* No stream. */ }
    return tracks.map(track => {
      const safe = { kind: track.kind, enabled: !!track.enabled, muted: !!track.muted, readyState: track.readyState };
      let settings = {};
      try { settings = track.getSettings ? track.getSettings() : {}; } catch (_) { /* Optional API. */ }
      safe.settings = {};
      ['sampleRate', 'sampleSize', 'channelCount', 'latency', 'echoCancellation', 'noiseSuppression', 'autoGainControl'].forEach(key => {
        if (typeof settings[key] === 'boolean' || (typeof settings[key] === 'number' && Number.isFinite(settings[key]))) safe.settings[key] = settings[key];
      });
      // Never include id, label, deviceId, groupId, constraints, or arbitrary exception messages.
      return safe;
    });
  }
  class MicrophoneProbe {
    constructor(options) {
      const o = options || {};
      this.getUserMedia = o.getUserMedia;
      this.AudioContext = o.AudioContext;
      this.MediaRecorder = o.MediaRecorder;
      this.Blob = o.Blob;
      this.URL = o.URL;
      this.now = o.now || Date.now;
      // Do not invoke browser-native timers with the controller as their receiver.
      this.setTimeout = o.setTimeout || ((fn, ms) => setTimeout(fn, ms));
      this.clearTimeout = o.clearTimeout || (id => clearTimeout(id));
      this.setInterval = o.setInterval || ((fn, ms) => setInterval(fn, ms));
      this.clearInterval = o.clearInterval || (id => clearInterval(id));
      this.isVisible = o.isVisible || (() => true);
      this.onChange = o.onChange || (() => {});
      this.onEvent = o.onEvent || (() => {});
      this.phase = 'idle';
      this.active = null;
      this.latest = null;
      this.pendingRequest = null;
      this.recordSession = null;
      this.recording = null;
      this.attempts = [];
      this.serial = 0;
      this.rms = 0;
      this.peak = 0;
    }
    _emit(event) {
      if (event) this.onEvent(event);
      this.onChange(this.snapshot());
    }
    snapshot() {
      return {
        phase: this.phase,
        pendingPermission: !!this.pendingRequest,
        canStart: !this.active && !this.pendingRequest && !this.recordSession,
        canRecord: this.phase === 'listening' && !!this.active,
        canReplay: !!this.recording,
        liveTracks: trackInfo(this.latest && this.latest.stream).filter(t => t.readyState === 'live').length,
        rms: this.rms,
        peak: this.peak,
        recordingElapsedMs: this.recordSession ? Math.max(0, this.now() - this.recordSession.startedAt) : 0,
        latest: this.latest ? clone(this.latest.data) : null
      };
    }
    report() {
      return {
        phase: this.phase,
        pendingPermission: !!this.pendingRequest,
        liveTracks: this.snapshot().liveTracks,
        replayInMemory: !!this.recording,
        limits: { permissionMs: PERMISSION_MS, listenMs: LISTEN_MS, recordingMs: RECORD_MS, finalizeMs: FINALIZE_MS, recordingMaxBytes: MAX_BYTES },
        signalThreshold: SIGNAL_THRESHOLD,
        interpretation: 'API, Freigabe, Energie, Aufnahmebytes und menschlich gehörte Sprache sind getrennte Evidenz. Kein Tesla-Hardwarebeweis.',
        attempts: this.attempts.map(a => clone(a.data))
      };
    }
    _stopTracks(stream) {
      if (!stream) return;
      let tracks = [];
      try { tracks = stream.getTracks(); } catch (_) { this.onEvent('track-list-error'); }
      tracks.forEach(track => {
        try { track.stop(); } catch (_) { this.onEvent('track-stop-error'); }
      });
    }
    _releaseMic(attempt) {
      if (!attempt) return;
      attempt.running = false;
      this.clearTimeout(attempt.permissionTimer);
      this.clearTimeout(attempt.listenTimer);
      this.clearInterval(attempt.meterTimer);
      try { if (attempt.source) attempt.source.disconnect(); } catch (_) { /* Best effort; tracks still stopped below. */ }
      try { if (attempt.analyser) attempt.analyser.disconnect(); } catch (_) { /* As above. */ }
      // Track release is synchronous and NEVER waits on AudioContext.close or recorder events.
      this._stopTracks(attempt.stream);
      attempt.data.tracksAfterStop = trackInfo(attempt.stream);
      if (attempt.context) {
        try {
          const closing = attempt.context.close();
          if (closing && closing.catch) closing.catch(() => {});
        } catch (_) { this.onEvent('context-close-error'); }
      }
      attempt.source = null;
      attempt.analyser = null;
      attempt.context = null;
      attempt.data.stoppedAtMs = this.now();
      if (this.active === attempt) this.active = null;
      this.rms = 0;
      this.peak = 0;
    }
    async start() {
      if (!this.snapshot().canStart || !this.isVisible()) return false;
      this.clearRecording();
      const attempt = {
        running: true, canceled: false, stream: null,
        data: {
          id: ++this.serial, requestedAtMs: this.now(), permission: 'pending',
          tracksAtGrant: [], tracksAfterStop: [],
          meter: { status: 'not-tested', samples: 0, rmsMax: 0, peakMax: 0, signalObserved: false },
          recording: { status: 'not-tested', bytes: 0, mimeType: null, durationMs: 0 },
          lateGrantReleased: false
        }
      };
      this.latest = this.active = attempt;
      this.attempts.push(attempt);
      if (this.attempts.length > 20) this.attempts.shift();
      if (typeof this.getUserMedia !== 'function') {
        attempt.data.permission = 'unsupported';
        this._releaseMic(attempt);
        this.phase = 'error';
        this._emit('microphone-api-unavailable');
        return false;
      }
      this.pendingRequest = attempt;
      this.phase = 'permission';
      attempt.permissionTimer = this.setTimeout(() => {
        if (this.pendingRequest === attempt && !attempt.canceled) this.cancel('timeout');
      }, PERMISSION_MS);
      this._emit('microphone-requested');
      let stream;
      try {
        stream = await this.getUserMedia({ audio: true, video: false });
      } catch (error) {
        this.clearTimeout(attempt.permissionTimer);
        if (this.pendingRequest === attempt) this.pendingRequest = null;
        if (!attempt.canceled && this.active === attempt) {
          attempt.data.permission = errorName(error) === 'NotAllowedError' ? 'denied' : 'error';
          attempt.data.permissionError = errorName(error);
          this._releaseMic(attempt);
          this.phase = 'error';
        }
        this._emit(attempt.canceled ? 'late-permission-rejection' : 'microphone-error');
        return false;
      }
      this.clearTimeout(attempt.permissionTimer);
      if (this.pendingRequest === attempt) this.pendingRequest = null;
      if (!attempt.canceled && !this.isVisible()) this.cancel('hidden');
      if (attempt.canceled || this.active !== attempt) {
        this._stopTracks(stream);
        attempt.data.lateGrantReleased = true;
        attempt.data.tracksAfterStop = trackInfo(stream);
        this._emit('late-grant-released');
        return false;
      }
      attempt.stream = stream;
      attempt.data.permission = 'granted';
      attempt.data.grantedAtMs = this.now();
      attempt.data.tracksAtGrant = trackInfo(stream);
      if (!attempt.data.tracksAtGrant.some(t => t.kind === 'audio' && t.readyState === 'live')) {
        attempt.data.meter.status = 'no-live-audio-track';
        this._releaseMic(attempt);
        this.phase = 'error';
        this._emit('no-live-audio-track');
        return false;
      }
      stream.getTracks().forEach(track => {
        if (!track.addEventListener) return;
        track.addEventListener('ended', () => {
          if (this.active === attempt && attempt.running) this.cancel('track-ended');
        });
      });
      attempt.listenTimer = this.setTimeout(() => {
        if (this.active === attempt) {
          if (this.recordSession) this.finishRecording('listen-limit');
          else this.stop('listen-limit');
        }
      }, LISTEN_MS);
      this.phase = 'preparing';
      this._emit('microphone-granted');
      if (typeof this.AudioContext !== 'function') {
        attempt.data.meter.status = 'unsupported';
        this._releaseMic(attempt);
        this.phase = 'stopped';
        this._emit('meter-unavailable-tracks-released');
        return false;
      }
      try {
        const context = attempt.context = new this.AudioContext();
        attempt.data.meter.status = 'starting';
        if (context.state === 'suspended') await context.resume();
        if (attempt.canceled || this.active !== attempt) return false;
        if (!this.isVisible()) { this.cancel('hidden'); return false; }
        if (context.state !== 'running') throw new Error('AudioContextNotRunning');
        attempt.source = context.createMediaStreamSource(stream);
        attempt.analyser = context.createAnalyser();
        attempt.analyser.fftSize = 1024;
        attempt.source.connect(attempt.analyser); // Intentionally not connected to speakers.
        const floatData = new Float32Array(attempt.analyser.fftSize);
        const byteData = new Uint8Array(attempt.analyser.fftSize);
        const sample = () => {
          if (this.active !== attempt || !attempt.running) return;
          if (!this.isVisible()) { this.cancel('hidden'); return; }
          try {
            let sum = 0, peak = 0;
            const analyser = attempt.analyser;
            if (analyser.getFloatTimeDomainData) analyser.getFloatTimeDomainData(floatData);
            else {
              analyser.getByteTimeDomainData(byteData);
              for (let i = 0; i < byteData.length; i++) floatData[i] = (byteData[i] - 128) / 128;
            }
            for (const value of floatData) { sum += value * value; peak = Math.max(peak, Math.abs(value)); }
            this.rms = Math.sqrt(sum / floatData.length);
            this.peak = peak;
            const meter = attempt.data.meter;
            meter.samples++;
            meter.rmsMax = Math.max(meter.rmsMax, this.rms);
            meter.peakMax = Math.max(meter.peakMax, peak);
            meter.signalObserved = meter.signalObserved || this.rms >= SIGNAL_THRESHOLD;
            meter.status = meter.signalObserved ? 'energy-observed' : 'no-energy-observed';
            this._emit();
          } catch (error) {
            attempt.data.meter.status = 'error';
            attempt.data.meter.error = errorName(error);
            this.cancel('meter-error');
          }
        };
        this.phase = 'listening';
        attempt.meterTimer = this.setInterval(sample, 100);
        sample();
        this._emit('meter-started');
        return true;
      } catch (error) {
        if (attempt.canceled || this.active !== attempt) return false;
        attempt.data.meter.status = 'error';
        attempt.data.meter.error = errorName(error);
        this._releaseMic(attempt);
        this.phase = 'error';
        this._emit('meter-error-tracks-released');
        return false;
      }
    }
    startRecording() {
      if (!this.snapshot().canRecord || !this.isVisible()) return false;
      const attempt = this.active;
      if (typeof this.MediaRecorder !== 'function') {
        attempt.data.recording.status = 'unsupported';
        this.stop('recorder-unavailable');
        return false;
      }
      this.clearRecording();
      const session = { attempt, chunks: [], bytes: 0, startedAt: this.now(), canceled: false, stopping: false };
      this.recordSession = session;
      try {
        let mimeType = '';
        if (typeof this.MediaRecorder.isTypeSupported === 'function') {
          mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find(type => this.MediaRecorder.isTypeSupported(type)) || '';
        }
        session.recorder = mimeType ? new this.MediaRecorder(attempt.stream, { mimeType }) : new this.MediaRecorder(attempt.stream);
        session.recorder.ondataavailable = event => {
          if (session.canceled || this.recordSession !== session || !event.data || !event.data.size) return;
          session.bytes += event.data.size;
          if (session.bytes > MAX_BYTES) { this.cancel('recording-size-limit'); return; }
          session.chunks.push(event.data);
        };
        session.recorder.onerror = event => {
          if (session.canceled || this.recordSession !== session) return;
          attempt.data.recording.error = errorName(event.error);
          this.cancel('recorder-error');
          attempt.data.recording.status = 'error';
          this._emit('recording-error');
        };
        session.recorder.onstop = () => this._completeRecording(session);
        attempt.data.recording = { status: 'recording', bytes: 0, mimeType: session.recorder.mimeType || mimeType || null, durationMs: 0 };
        this.phase = 'recording';
        session.timer = this.setTimeout(() => this.finishRecording('recording-limit'), RECORD_MS);
        session.recorder.start(250);
        this._emit('recording-started');
        return true;
      } catch (error) {
        this.cancel('recorder-start-error');
        attempt.data.recording.status = 'error';
        attempt.data.recording.error = errorName(error);
        this._emit('recording-error');
        return false;
      }
    }
    finishRecording(reason) {
      const session = this.recordSession;
      if (!session || session.canceled || session.stopping) return false;
      session.stopping = true;
      session.duration = Math.max(0, this.now() - session.startedAt);
      session.attempt.data.recording.durationMs = session.duration;
      session.attempt.data.recording.status = 'finalizing';
      session.attempt.data.stopReason = reason || 'recording-finished';
      this.phase = 'finalizing';
      this.clearTimeout(session.timer);
      this._releaseMic(session.attempt);
      session.finalizeTimer = this.setTimeout(() => {
        if (this.recordSession !== session) return;
        this.cancel('recorder-finalize-timeout');
        session.attempt.data.recording.status = 'error';
        session.attempt.data.recording.error = 'FinalizeTimeout';
        this._emit('recording-finalize-timeout');
      }, FINALIZE_MS);
      try { if (session.recorder.state !== 'inactive') session.recorder.stop(); }
      catch (error) {
        this.cancel('recorder-stop-error');
        session.attempt.data.recording.status = 'error';
        session.attempt.data.recording.error = errorName(error);
      }
      this._emit('recording-stopped-tracks-released');
      return true;
    }
    _completeRecording(session) {
      if (session.canceled || this.recordSession !== session) return;
      if (!this.isVisible()) { this.cancel('hidden'); return; }
      this.clearTimeout(session.timer);
      this.clearTimeout(session.finalizeTimer);
      // A browser may stop independently. Do not leave its stream alive.
      this._releaseMic(session.attempt);
      const result = session.attempt.data.recording;
      result.durationMs = session.duration === undefined ? Math.max(0, this.now() - session.startedAt) : session.duration;
      try {
        const blob = new this.Blob(session.chunks, { type: result.mimeType || (session.chunks[0] && session.chunks[0].type) || '' });
        result.bytes = blob.size;
        result.mimeType = blob.type || null;
        if (blob.size) {
          this.recording = { url: this.URL.createObjectURL(blob), blob, attempt: session.attempt };
          result.status = 'ready';
        } else result.status = 'empty';
      } catch (error) {
        result.status = 'error';
        result.error = errorName(error);
      }
      session.chunks = [];
      this.recordSession = null;
      this.phase = 'stopped';
      this._emit(result.status === 'ready' ? 'recording-ready-in-memory' : 'recording-empty-or-error');
    }
    stop(reason) {
      if (this.phase === 'permission' || this.phase === 'preparing') { this.cancel(reason || 'user'); return; }
      if (this.recordSession) { this.finishRecording(reason); return; }
      if (this.active) {
        this.active.data.stopReason = reason || 'user';
        this._releaseMic(this.active);
        this.phase = 'stopped';
        this._emit('microphone-stopped');
      }
    }
    cancel(reason) {
      const why = reason || 'user';
      const attempt = this.active || (this.recordSession && this.recordSession.attempt) || this.pendingRequest;
      if (attempt) {
        attempt.canceled = true;
        attempt.data.stopReason = why;
        if (attempt.data.permission === 'pending') attempt.data.permission = why === 'timeout' ? 'timeout' : 'canceled';
      }
      const session = this.recordSession;
      if (session) {
        session.canceled = true; // Invalidate BEFORE stop: onstop can run synchronously in test doubles.
        session.chunks = [];
        this.clearTimeout(session.timer);
        this.clearTimeout(session.finalizeTimer);
        session.attempt.data.recording.status = 'discarded';
        session.attempt.data.recording.durationMs = Math.max(0, this.now() - session.startedAt);
        this.recordSession = null;
        try { if (session.recorder && session.recorder.state !== 'inactive') session.recorder.stop(); } catch (_) { /* Tracks still released. */ }
      }
      this._releaseMic(attempt);
      this.clearRecording();
      this.phase = why === 'timeout' ? 'timeout' : 'canceled';
      this._emit('microphone-cancel-' + why);
    }
    clearRecording() {
      if (!this.recording) return;
      try { this.URL.revokeObjectURL(this.recording.url); } catch (_) { /* Drop references anyway. */ }
      this.recording.attempt.data.recording.audioDeleted = true;
      this.recording = null;
      this._emit('recording-deleted');
    }
    getRecordingUrl() { return this.recording ? this.recording.url : null; }
  }
  return { MicrophoneProbe, errorName };
});
