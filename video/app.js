(function () {
  const FPS = 24;
  const COUNT = 240;
  const screen = document.querySelector('#screen');
  const statusEl = document.querySelector('#status');
  const startBtn = document.querySelector('#start');
  const context = screen.getContext('2d');
  const audio = new Audio('clips/film/audio.mp3');
  audio.loop = true;
  audio.preload = 'auto';
  const frames = new Array(COUNT);
  let loaded = 0;
  let playing = false;
  let timer = 0;

  function paint() {
    const index = Math.min(COUNT - 1, Math.floor((audio.currentTime % 10) * FPS));
    const img = frames[index];
    if (img && img.complete && img.naturalWidth) context.drawImage(img, 0, 0, screen.width, screen.height);
    statusEl.textContent = (audio.paused ? 'Pause' : 'Läuft') + ' · ' + audio.currentTime.toFixed(1) + ' s · 24 Bilder/s';
    if (playing && !audio.paused) timer = window.setTimeout(paint, 20);
  }

  function noteLoad() {
    loaded += 1;
    if (frames[0] && frames[0].complete && frames[0].naturalWidth && loaded < COUNT) {
      context.drawImage(frames[0], 0, 0, screen.width, screen.height);
    }
    if (loaded === COUNT) {
      startBtn.disabled = false;
      statusEl.textContent = 'Bereit · 24 Bilder/s';
      return;
    }
    statusEl.textContent = 'Lade Bilder ' + loaded + '/' + COUNT;
    if (loaded % 8 === 0) loadBatch(loaded);
  }

  function loadBatch(start) {
    const end = Math.min(COUNT, start + 8);
    for (let i = start; i < end; i += 1) {
      const img = new Image();
      img.onload = noteLoad;
      img.onerror = noteLoad;
      img.src = 'clips/film/f' + String(i + 1).padStart(3, '0') + '.jpg';
      frames[i] = img;
    }
  }

  startBtn.addEventListener('click', function () {
    if (playing && !audio.paused) {
      playing = false;
      audio.pause();
      window.clearTimeout(timer);
      startBtn.textContent = 'Start';
      statusEl.textContent = 'Pause · ' + audio.currentTime.toFixed(1) + ' s';
      return;
    }
    playing = true;
    startBtn.textContent = 'Stopp';
    const pending = audio.play();
    paint();
    if (pending) pending.catch(function (error) {
      playing = false;
      startBtn.textContent = 'Start';
      statusEl.textContent = 'Ton abgelehnt: ' + error.name;
    });
  });

  loadBatch(0);
})();
