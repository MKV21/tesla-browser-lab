(function () {
  const MSE_MIME = 'video/mp4; codecs="avc1.42C01E,mp4a.40.2"';
  const tests = [
    { id: 'h264', label: 'H.264 Baseline', kind: 'file', src: 'clips/h264-baseline.mp4', controls: true, hint: 'Wahrscheinlichste Variante. Die große Zahl muss hochzählen, die Farbe jede Sekunde wechseln.' },
    { id: 'high', label: 'H.264 High', kind: 'file', src: 'clips/h264-high.mp4', controls: true, hint: 'Gleiches Containerformat, höheres Profil. Im Bild muss H264 HIGH stehen.' },
    { id: 'vp8', label: 'WebM VP8', kind: 'file', src: 'clips/vp8.webm', controls: true, hint: 'Anderes Container- und Codec-Paar. Im Bild muss VP8 stehen.' },
    { id: 'vp9', label: 'WebM VP9', kind: 'file', src: 'clips/vp9.webm', controls: true, hint: 'VP9 mit Opus. Im Bild muss VP9 stehen.' },
    { id: 'av1', label: 'WebM AV1', kind: 'file', src: 'clips/av1.webm', controls: true, hint: 'Neuer Codec. Im Bild muss AV1 stehen. Ein nein hier blockiert H.264 nicht.' },
    { id: 'hevc', label: 'MP4 HEVC', kind: 'file', src: 'clips/hevc.mp4', controls: true, hint: 'H.265. Das Fahrzeug kann HEVC intern oft abspielen, der Browser trotzdem nicht.' },
    { id: 'theora', label: 'Ogg Theora', kind: 'file', src: 'clips/theora.ogv', controls: true, hint: 'Altes Format. Eher eine Negativprobe.' },
    { id: 'sources', label: 'source-Fallback', kind: 'sources', hint: 'Der Browser soll selbst wählen: zuerst VP8, sonst H.264. Die Beschriftung im Bild zeigt die gewählte Datei.' },
    { id: 'blob', label: 'Blob, dann Start', kind: 'blob', src: 'clips/h264-baseline.mp4', hint: 'Datei erst laden, Blob-Adresse setzen, erst der nächste Tipp ruft play() auf. So macht es die Audioausgabe im Cockpit.' },
    { id: 'blob-click', label: 'Blob im selben Klick', kind: 'blob-click', src: 'clips/h264-baseline.mp4', hint: 'Laden und play() im selben Tipp, mit Warten dazwischen. Viele Browser verwerfen die Freigabe dann.' },
    { id: 'mse', label: 'MediaSource', kind: 'mse', src: 'clips/h264-frag.mp4', hint: 'Eigener Player ohne Bibliothek: fragmentiertes MP4 in einen SourceBuffer. Im Bild muss H264 MSE stehen.' },
    { id: 'hls', label: 'HLS m3u8', kind: 'hls', hint: 'Native Playlist, ohne hls.js. Chromium kann das meist nicht. Das Protokoll zeigt zusätzlich den Dateityp vom Host.' },
    { id: 'plain', label: 'play() ohne Controls', kind: 'file', src: 'clips/h264-baseline.mp4', controls: false, hint: 'Kein eingebauter Player. Nur der Start-Knopf ruft play() auf.' },
    { id: 'iframe', label: 'iframe', kind: 'iframe', hint: 'Dieselbe H.264-Datei im inneren Frame. Der Start dort ist ein eigener Tipp; der äußere Tipp gilt oft nicht.' },
    { id: 'object', label: 'object/embed', kind: 'object', src: 'clips/h264-baseline.mp4', hint: 'Alte Einbettung statt video-Element. Es gibt keinen verlässlichen Fehlertext; zählt nur, was du siehst.' },
    { id: 'canvas', label: 'Canvas-Kopie', kind: 'canvas', src: 'clips/h264-baseline.mp4', hint: 'Links das video-Element, rechts eine Kopie. Rechts schwarz bei links laufendem Bild heißt: Bild da, aber nicht auslesbar.' },
    { id: 'full', label: 'Vollbild', kind: 'fullscreen', src: 'clips/h264-baseline.mp4', hint: 'Start ruft die Vollbild-API auf. Manche Fahrzeugbrowser kennen sie nicht oder zeigen nur schwarz.' },
    { id: 'pip', label: 'Picture-in-Picture', kind: 'pip', src: 'clips/h264-baseline.mp4', hint: 'Kleines schwebendes Fenster. Im Tesla meist nicht vorhanden.' },
    { id: 'youtube', label: 'YouTube-iframe', kind: 'youtube', hint: 'Lädt erst jetzt ein kurzes öffentliches Beispiel von YouTube. Google sieht die Anfrage. Kein Konto von hier.' }
  ];

  const caps = document.querySelector('#caps');
  const testsEl = document.querySelector('#tests');
  const title = document.querySelector('#title');
  const hint = document.querySelector('#hint');
  const view = document.querySelector('#view');
  const statusEl = document.querySelector('#status');
  const metrics = document.querySelector('#metrics');
  const startBtn = document.querySelector('#start');
  const stopBtn = document.querySelector('#stop');
  const logEl = document.querySelector('#log');
  let active = null;
  let poll = 0;
  let blobUrl = '';
  let canvasTimer = 0;
  let motionChanges = 0;
  let lastSig = null;
  const probe = document.createElement('canvas');
  probe.width = 16;
  probe.height = 16;
  const probeCtx = probe.getContext('2d', { willReadFrequently: true });

  function log(line) {
    const stamp = new Date().toISOString().slice(11, 19);
    logEl.textContent += stamp + '  ' + line + '\n';
  }

  function support(type) {
    const video = document.createElement('video');
    const result = video.canPlayType(type);
    return result || 'nein';
  }

  function mseSupport(type) {
    if (!window.MediaSource || !MediaSource.isTypeSupported) return 'fehlt';
    try {
      return MediaSource.isTypeSupported(type) ? 'ja' : 'nein';
    } catch (error) {
      return error.name;
    }
  }

  function readCaps() {
    const rows = [
      ['H.264', support('video/mp4; codecs="avc1.42C01E,mp4a.40.2"')],
      ['H.264 High', support('video/mp4; codecs="avc1.64001F,mp4a.40.2"')],
      ['VP8', support('video/webm; codecs="vp8,vorbis"')],
      ['VP9', support('video/webm; codecs="vp9,opus"')],
      ['AV1', support('video/webm; codecs="av01.0.05M.08,opus"')],
      ['HEVC', support('video/mp4; codecs="hvc1.1.6.L93.B0,mp4a.40.2"')],
      ['Theora', support('video/ogg; codecs="theora,vorbis"')],
      ['HLS', support('application/vnd.apple.mpegurl')],
      ['MSE', mseSupport(MSE_MIME)]
    ];
    caps.textContent = rows.map(function (row) { return row[0] + ': ' + row[1]; }).join(' · ')
      + ' · Vollbild: ' + (document.fullscreenEnabled ? 'ja' : 'nein')
      + ' · PiP: ' + (document.pictureInPictureEnabled ? 'ja' : 'nein')
      + ' · ' + window.innerWidth + '×' + window.innerHeight;
    log('UA ' + navigator.userAgent);
    log(caps.textContent);
  }

  function errorText(video) {
    if (!video.error) return '';
    const names = { 1: 'abgebrochen', 2: 'Netzwerk', 3: 'Dekodierung', 4: 'nicht unterstützt' };
    return 'Fehler ' + video.error.code + ' ' + (names[video.error.code] || '') + (video.error.message ? ' ' + video.error.message : '');
  }

  function describe(video) {
    const failed = errorText(video);
    if (failed) return failed;
    const time = video.currentTime ? video.currentTime.toFixed(1) : '0.0';
    let motion = 'Bild noch unbekannt';
    if (video.currentTime > 0.8) {
      motion = motionChanges > 0 ? 'BILD WECHSELT' : 'BILD STEHT';
    }
    const sound = audioWord(video);
    return (video.paused ? 'Pause' : 'Läuft') + ' · ' + motion + ' · ' + time + ' s' + sound;
  }

  function audioWord(video) {
    if (!('webkitAudioDecodedByteCount' in video)) return '';
    if (video.webkitAudioDecodedByteCount > 0) return ' · Ton da';
    if (video.currentTime > 0.4) return ' · kein Ton';
    return '';
  }

  function sampleMotion(video) {
    try {
      probeCtx.drawImage(video, 0, 0, 16, 16);
      const data = probeCtx.getImageData(0, 0, 16, 16).data;
      let sig = 0;
      for (let i = 0; i < data.length; i += 8) sig = (sig * 33 + data[i] + data[i + 1] + data[i + 2]) % 1000003;
      if (lastSig !== null && sig !== lastSig) motionChanges += 1;
      lastSig = sig;
      const mirror = view.querySelector('canvas.mirror');
      if (mirror) mirror.getContext('2d').drawImage(video, 0, 0, mirror.width, mirror.height);
      return true;
    } catch (error) {
      metrics.textContent = 'Bild nicht auslesbar: ' + error.name;
      return false;
    }
  }

  function ensureMirror(video) {
    if (!active || active.kind === 'canvas' || view.querySelector('canvas.mirror')) return;
    const label = document.createElement('p');
    label.className = 'mirror-label';
    label.textContent = 'Untere Kopie. Wenn nur die sich bewegt, hängt die Videodarstellung.';
    const canvas = document.createElement('canvas');
    canvas.className = 'mirror';
    canvas.width = video.videoWidth || 480;
    canvas.height = video.videoHeight || 270;
    view.append(label, canvas);
  }

  function watch(video) {
    window.clearInterval(poll);
    motionChanges = 0;
    lastSig = null;
    ensureMirror(video);
    poll = window.setInterval(function () {
      sampleMotion(video);
      statusEl.textContent = describe(video);
      const videoBytes = 'webkitVideoDecodedByteCount' in video ? video.webkitVideoDecodedByteCount : '–';
      const audioBytes = 'webkitAudioDecodedByteCount' in video ? video.webkitAudioDecodedByteCount : '–';
      if (!metrics.textContent || metrics.textContent.indexOf('nicht auslesbar') < 0) {
        metrics.textContent = 'Wechsel ' + motionChanges + ' · dekodiert Bild/Ton ' + videoBytes + '/' + audioBytes;
      }
    }, 250);
  }

  function clearView() {
    window.clearInterval(poll);
    window.clearInterval(canvasTimer);
    view.querySelectorAll('video').forEach(function (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    });
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
      blobUrl = '';
    }
    view.replaceChildren();
    metrics.textContent = '';
  }

  function makeVideo(withControls) {
    const video = document.createElement('video');
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.preload = 'auto';
    video.loop = true;
    if (withControls) video.controls = true;
    video.addEventListener('error', function () {
      statusEl.textContent = errorText(video) || 'Fehler ohne Code';
      log((active ? active.label : 'Video') + ': ' + statusEl.textContent);
    });
    return video;
  }

  function whenReady(video, done) {
    if (video.readyState >= 1) {
      done();
      return;
    }
    const finish = function () {
      video.removeEventListener('loadedmetadata', finish);
      video.removeEventListener('error', finish);
      done();
    };
    video.addEventListener('loadedmetadata', finish);
    video.addEventListener('error', finish);
  }

  function enableStart(on) {
    startBtn.disabled = !on;
    stopBtn.disabled = !on;
  }

  function attachFile(video, src) {
    video.src = src;
    whenReady(video, function () {
      enableStart(!video.error);
      statusEl.textContent = video.error ? errorText(video) : 'Geladen · Start tippen';
    });
  }

  function prepare(test) {
    active = test;
    clearView();
    title.textContent = test.label;
    hint.textContent = test.hint;
    statusEl.textContent = 'Lade…';
    enableStart(false);
    document.querySelectorAll('#tests button').forEach(function (button) {
      button.setAttribute('aria-pressed', button.dataset.id === test.id ? 'true' : 'false');
    });
    log('Gewählt: ' + test.label);

    if (test.kind === 'file' || test.kind === 'fullscreen' || test.kind === 'pip') {
      const video = makeVideo(test.kind === 'file' ? test.controls : true);
      view.append(video);
      attachFile(video, test.src);
      return;
    }
    if (test.kind === 'sources') {
      const video = makeVideo(true);
      const webm = document.createElement('source');
      webm.src = 'clips/vp8.webm';
      webm.type = 'video/webm; codecs="vp8,vorbis"';
      const mp4 = document.createElement('source');
      mp4.src = 'clips/h264-baseline.mp4';
      mp4.type = 'video/mp4; codecs="avc1.42C01E,mp4a.40.2"';
      video.append(webm, mp4);
      view.append(video);
      video.load();
      whenReady(video, function () {
        enableStart(!video.error);
        statusEl.textContent = video.error ? errorText(video) : 'Geladen · die Beschriftung im Bild ist die Entscheidung';
      });
      return;
    }
    if (test.kind === 'blob') {
      const video = makeVideo(true);
      view.append(video);
      fetch(test.src).then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.blob();
      }).then(function (blob) {
        blobUrl = URL.createObjectURL(blob);
        video.src = blobUrl;
        whenReady(video, function () {
          enableStart(!video.error);
          statusEl.textContent = 'Blob bereit · jetzt Start';
          log('Blob ' + blob.type + ' ' + blob.size + ' Bytes');
        });
      }).catch(function (error) {
        statusEl.textContent = 'Blob-Laden fehlgeschlagen';
        log('Blob: ' + error.message);
      });
      return;
    }
    if (test.kind === 'blob-click') {
      view.append(makeVideo(true));
      enableStart(true);
      statusEl.textContent = 'Start lädt und spielt im selben Tipp';
      return;
    }
    if (test.kind === 'mse') {
      const video = makeVideo(true);
      view.append(video);
      if (!window.MediaSource) {
        statusEl.textContent = 'MediaSource fehlt';
        log('MediaSource fehlt');
        return;
      }
      const source = new MediaSource();
      blobUrl = URL.createObjectURL(source);
      video.src = blobUrl;
      source.addEventListener('sourceopen', function () {
        let buffer;
        try {
          buffer = source.addSourceBuffer(MSE_MIME);
        } catch (error) {
          statusEl.textContent = 'SourceBuffer abgelehnt';
          log('MSE addSourceBuffer: ' + error.name + ' ' + error.message);
          return;
        }
        fetch(test.src).then(function (response) { return response.arrayBuffer(); }).then(function (data) {
          buffer.addEventListener('updateend', function () {
            if (source.readyState === 'open') source.endOfStream();
            enableStart(true);
            statusEl.textContent = 'MSE-Puffer bereit · Start tippen';
            log('MSE angehängt ' + data.byteLength + ' Bytes');
          });
          buffer.appendBuffer(data);
        }).catch(function (error) {
          statusEl.textContent = 'MSE-Laden fehlgeschlagen';
          log('MSE: ' + error.message);
        });
      });
      return;
    }
    if (test.kind === 'hls') {
      const video = makeVideo(true);
      video.loop = false;
      view.append(video);
      Promise.all([
        fetch('clips/hls.m3u8'),
        fetch('clips/segment.m2ts')
      ]).then(function (responses) {
        log('m3u8 ' + responses[0].status + ' ' + (responses[0].headers.get('content-type') || 'ohne Typ'));
        log('segment.m2ts ' + responses[1].status + ' ' + (responses[1].headers.get('content-type') || 'ohne Typ'));
        const segmentType = responses[1].headers.get('content-type') || '';
        video.src = 'clips/hls.m3u8';
        whenReady(video, function () {
          enableStart(true);
          statusEl.textContent = video.error ? errorText(video) : 'Playlist gesetzt · Start probieren';
          if (segmentType && segmentType.indexOf('mp2t') < 0 && segmentType.indexOf('mpeg') < 0) {
            metrics.textContent = 'Hinweis: Segment-Typ ist ' + segmentType + '. Ein Fehler kann am Hosting liegen.';
          }
        });
      }).catch(function (error) {
        statusEl.textContent = 'Playlist nicht ladbar';
        log('HLS: ' + error.message);
      });
      return;
    }
    if (test.kind === 'iframe') {
      const frame = document.createElement('iframe');
      frame.src = 'frame.html?clip=h264-baseline.mp4';
      frame.title = 'Eingebetteter Videoplayer';
      view.append(frame);
      enableStart(false);
      statusEl.textContent = 'Im Frame den eigenen Start tippen';
      return;
    }
    if (test.kind === 'object') {
      const object = document.createElement('object');
      object.data = test.src;
      object.type = 'video/mp4';
      const embed = document.createElement('embed');
      embed.src = test.src;
      embed.type = 'video/mp4';
      object.append(embed);
      view.append(object);
      enableStart(false);
      statusEl.textContent = 'Keine Schnittstelle · nur hinsehen';
      log('object/embed eingesetzt');
      return;
    }
    if (test.kind === 'canvas') {
      const pair = document.createElement('div');
      pair.className = 'pair';
      const video = makeVideo(true);
      const canvas = document.createElement('canvas');
      canvas.width = 480;
      canvas.height = 270;
      pair.append(video, canvas);
      view.append(pair);
      attachFile(video, test.src);
      return;
    }
    if (test.kind === 'youtube') {
      enableStart(true);
      statusEl.textContent = 'Start lädt YouTube';
      return;
    }
  }

  function currentVideo() {
    return view.querySelector('video');
  }

  function playCurrent(video) {
    const pending = video.play();
    watch(video);
    if (!pending) {
      log('play() ohne Promise');
      return pending;
    }
    pending.then(function () {
      log('play() ok ' + video.videoWidth + 'x' + video.videoHeight);
    }).catch(function (error) {
      statusEl.textContent = 'Start abgelehnt: ' + error.name;
      log('play() ' + error.name + ' ' + error.message);
    });
    return pending;
  }

  function sampleCanvas(video) {
    const canvas = view.querySelector('canvas');
    if (!canvas) return;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    window.clearInterval(canvasTimer);
    canvasTimer = window.setInterval(function () {
      try {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, 32, 32).data;
        let sum = 0;
        for (let i = 0; i < pixels.length; i += 4) sum += pixels[i] + pixels[i + 1] + pixels[i + 2];
        const mean = Math.round(sum / (pixels.length / 4));
        metrics.textContent = 'Canvas-Helligkeit ' + mean + (mean < 8 ? ' · Kopie schwarz' : ' · Kopie hat Bild');
      } catch (error) {
        metrics.textContent = 'Canvas blockiert: ' + error.name;
      }
    }, 400);
  }

  startBtn.addEventListener('click', function () {
    if (!active) return;
    document.querySelectorAll('#autoplay video').forEach(function (video) { video.pause(); });
    if (active.kind === 'youtube') {
      clearView();
      const frame = document.createElement('iframe');
      frame.src = 'https://www.youtube-nocookie.com/embed/jNQXAC9IVRw?rel=0';
      frame.title = 'YouTube-Beispiel';
      frame.allow = 'accelerometer; autoplay; encrypted-media; picture-in-picture; fullscreen';
      view.append(frame);
      statusEl.textContent = 'YouTube geladen · Steuerung im Frame';
      log('YouTube-iframe eingesetzt');
      stopBtn.disabled = false;
      return;
    }
    if (active.kind === 'blob-click') {
      const video = currentVideo();
      statusEl.textContent = 'Lade im Klick…';
      fetch(active.src).then(function (response) { return response.blob(); }).then(function (blob) {
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        blobUrl = URL.createObjectURL(blob);
        video.src = blobUrl;
        return video.play();
      }).then(function () {
        watch(video);
        log('Blob im selben Klick: play() ok');
      }).catch(function (error) {
        statusEl.textContent = 'Gleicher Klick: ' + (error.name || error.message);
        log('Blob im selben Klick: ' + (error.name || error.message));
      });
      return;
    }
    const video = currentVideo();
    if (!video) return;
    playCurrent(video);
    if (active.kind === 'canvas') sampleCanvas(video);
    if (active.kind === 'fullscreen') {
      const request = video.requestFullscreen || video.webkitRequestFullscreen;
      if (!request) {
        log('Vollbild-API fehlt');
        metrics.textContent = 'Vollbild-API fehlt';
      } else {
        Promise.resolve(request.call(video)).then(function () {
          log('Vollbild geöffnet');
        }).catch(function (error) {
          log('Vollbild: ' + error.name + ' ' + error.message);
          metrics.textContent = 'Vollbild abgelehnt: ' + error.name;
        });
      }
    }
    if (active.kind === 'pip') {
      if (!video.requestPictureInPicture) {
        log('Picture-in-Picture fehlt');
        metrics.textContent = 'Picture-in-Picture fehlt';
      } else {
        video.requestPictureInPicture().then(function () {
          log('Picture-in-Picture geöffnet');
        }).catch(function (error) {
          log('PiP: ' + error.name + ' ' + error.message);
          metrics.textContent = 'PiP abgelehnt: ' + error.name;
        });
      }
    }
  });

  stopBtn.addEventListener('click', function () {
    const test = active;
    clearView();
    statusEl.textContent = 'Gestoppt';
    log('Stopp');
    if (test) prepare(test);
  });

  window.addEventListener('message', function (event) {
    if (event.origin !== location.origin) return;
    if (!event.data || event.data.type !== 'tesla-video-frame') return;
    statusEl.textContent = event.data.text;
    log(event.data.text);
  });

  document.querySelector('#force').addEventListener('click', function () {
    const on = view.classList.toggle('force');
    this.setAttribute('aria-pressed', on ? 'true' : 'false');
    log(on ? 'GPU-Ebene an' : 'GPU-Ebene aus');
  });

  tests.forEach(function (test) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.id = test.id;
    button.textContent = test.label;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', function () { prepare(test); });
    testsEl.append(button);
  });

  function autoplay(muted) {
    const figure = document.createElement('figure');
    const video = makeVideo(false);
    video.loop = false;
    video.muted = muted;
    video.autoplay = true;
    video.src = 'clips/h264-baseline.mp4';
    const caption = document.createElement('figcaption');
    caption.textContent = muted ? 'Autoplay stumm: warte' : 'Autoplay mit Ton: warte';
    figure.append(video, caption);
    document.querySelector('#autoplay').append(figure);
    video.addEventListener('error', function () {
      caption.textContent = (muted ? 'Autoplay stumm: ' : 'Autoplay mit Ton: ') + errorText(video);
      log(caption.textContent);
    });
    const pending = video.play();
    const label = muted ? 'Autoplay stumm' : 'Autoplay mit Ton';
    if (!pending) {
      caption.textContent = label + ': kein Promise';
      return;
    }
    pending.then(function () {
      caption.textContent = label + ': gestartet' + (video.videoWidth ? ' · Bild da' : ' · noch keine Bildgröße');
      log(caption.textContent);
    }).catch(function (error) {
      caption.textContent = label + ': ' + error.name;
      log(caption.textContent);
    });
  }

  readCaps();
  autoplay(true);
  autoplay(false);
  fetch('clips/manifest.json').then(function (response) {
    log('manifest ' + response.status);
  }).catch(function (error) {
    log('manifest: ' + error.message);
  });
})();
