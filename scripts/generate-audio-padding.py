"""Append digital silence to the existing neutral three-second test signal."""
from pathlib import Path
import subprocess
import wave

ROOT = Path(__file__).resolve().parents[1]
with wave.open(str(ROOT / 'audio-length/clips/3.wav'), 'rb') as source:
    params = source.getparams()
    short = source.readframes(source.getnframes())
    assert params.nframes == 3 * params.framerate
    frame_bytes = params.nchannels * params.sampwidth
    padding_frames = 21 * params.framerate - params.nframes
output = ROOT / 'audio-padding/clips'
output.mkdir(parents=True, exist_ok=True)
wav = output / 'short-padded-21.wav'
with wave.open(str(wav), 'wb') as target:
    target.setparams(params)
    target.writeframes(short + bytes(padding_frames * frame_bytes))
with wave.open(str(wav), 'rb') as check:
    assert check.getnframes() / check.getframerate() == 21
    assert check.readframes(params.nframes) == short
    assert not any(check.readframes(padding_frames))
subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(wav),
                '-c:a', 'libmp3lame', '-b:a', '64k', '-map_metadata', '-1',
                str(output / 'short-padded-21.mp3')], check=True)
print('Verified WAV: original 3 seconds unchanged, then digital silence; total 21 seconds. MP3 encoded.')
