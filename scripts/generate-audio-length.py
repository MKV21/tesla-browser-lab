"""Generate neutral, finite test clips; no speech providers or private audio."""
from array import array
import math
from pathlib import Path
import subprocess
import sys
import wave

ROOT = Path(__file__).resolve().parents[1] / 'audio-length' / 'clips'
LENGTHS = [3, 5, 6, 8, 9, 9.5, 10, 10.5, 11, 12, 15, 20]
RATE = 24000
ROOT.mkdir(parents=True, exist_ok=True)
for duration in LENGTHS:
    frames = round(duration * RATE)
    samples = array('h')
    for i in range(frames):
        t = i / RATE
        # Gentle continuous chord, with a pulse each second; no silent padding.
        pulse = 0.55 + 0.45 * (0.5 + 0.5 * math.cos(2 * math.pi * t))
        fade = min(1, t / 0.025, (frames - 1 - i) / (RATE * 0.025))
        sound = (math.sin(2 * math.pi * 330 * t)
                 + 0.5 * math.sin(2 * math.pi * 440 * t)
                 + 0.3 * math.sin(2 * math.pi * 550 * t)) / 1.8
        samples.append(round(32767 * 0.16 * pulse * fade * sound))
    if sys.byteorder != 'little':
        samples.byteswap()
    name = str(duration).replace('.', '-')
    wav = ROOT / (name + '.wav')
    with wave.open(str(wav), 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(RATE)
        output.writeframes(samples.tobytes())
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
                    '-i', str(wav), '-c:a', 'libmp3lame', '-b:a', '64k',
                    '-map_metadata', '-1', str(ROOT / (name + '.mp3'))], check=True)
    with wave.open(str(wav), 'rb') as check:
        assert check.getnframes() / check.getframerate() == duration
    print(f'{name}: WAV exactly {duration}s; MP3 encoded')
