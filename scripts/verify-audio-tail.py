"""One bounded recovery: independently recognize the ending, without any lyric prompt."""
import hashlib
import json
import pathlib
import subprocess
import sys
import time
root = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / '.studio/python'))
import imageio_ffmpeg
import numpy as np
from faster_whisper import WhisperModel
audio, output = sys.argv[1:3]
started = time.time()
decode = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-nostdin', '-v', 'error', '-xerror', '-i', audio, '-map', '0:a:0', '-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1'], capture_output=True, timeout=180)
if decode.returncode:
    raise RuntimeError('FULL_AUDIO_DECODE_FAILED')
samples = np.frombuffer(decode.stdout, dtype='<f4').copy()
start = max(0, len(samples) / 16000 - 26)
model = WhisperModel('medium', device='cpu', compute_type='int8', cpu_threads=4, download_root=str(root / '.studio/models'))
segments, info = model.transcribe(samples[round(start * 16000):], language='ko', beam_size=10, word_timestamps=True, condition_on_previous_text=False, vad_filter=False, initial_prompt=None)
rows = []
for segment in segments:
    rows.append({'startMs': round((segment.start + start) * 1000), 'endMs': round((segment.end + start) * 1000), 'text': segment.text,
                 'words': [{'text': word.word, 'startMs': round((word.start + start) * 1000), 'endMs': round((word.end + start) * 1000), 'probability': word.probability} for word in segment.words or []]})
report = {'method': 'targeted-medium-ending-recovery', 'model': 'medium', 'audioSha256': hashlib.file_digest(open(audio, 'rb'), 'sha256').hexdigest(), 'lyricsUsedAsPrompt': False,
          'fullAudioDecoded': True, 'transcribedRangeMs': [round(start * 1000), round(len(samples) / 16)], 'segments': rows, 'elapsedSeconds': time.time() - started, 'language': info.language}
pathlib.Path(output).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'method': report['method'], 'elapsedSeconds': report['elapsedSeconds'], 'transcribedRangeMs': report['transcribedRangeMs']}))
