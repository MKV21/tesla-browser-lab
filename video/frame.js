(function () {
  const params = new URLSearchParams(location.search);
  const clip = params.get('clip') || '';
  const video = document.querySelector('#v');
  const status = document.querySelector('#s');
  const allowed = /^[a-z0-9.-]+$/i.test(clip) && clip.indexOf('..') < 0;

  function report(text) {
    status.textContent = text;
    parent.postMessage({ type: 'tesla-video-frame', text: text }, location.origin);
  }

  if (!allowed) {
    report('Frame: Dateiname abgelehnt');
    return;
  }
  video.src = 'clips/' + clip;
  video.addEventListener('error', function () {
    const code = video.error ? video.error.code : 0;
    report('Frame-Fehler ' + code);
  });
  document.querySelector('#b').addEventListener('click', function () {
    const pending = video.play();
    if (!pending) {
      report('Frame: play() ohne Promise');
      return;
    }
    pending.then(function () {
      report('Frame spielt ' + video.videoWidth + 'x' + video.videoHeight);
    }).catch(function (error) {
      report('Frame: ' + error.name);
    });
  });
})();
