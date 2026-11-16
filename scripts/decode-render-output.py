"""Dedicated worker full decode, never a Vercel handler."""
import hashlib
import json
import pathlib
import subprocess
import sys
root = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / '.studio/python'))
import imageio_ffmpeg
video, destination = map(pathlib.Path, sys.argv[1:3])
process = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-nostdin', '-v', 'error', '-xerror', '-i', str(video), '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-'], capture_output=True, timeout=600)
if process.returncode:
    raise RuntimeError('FULL_RENDER_DECODE_FAILED')
report = {'videoSha256': hashlib.file_digest(video.open('rb'), 'sha256').hexdigest(), 'fullVideoAndAudioDecoded': True, 'visualAndSemanticReview': 'OWNER_REQUIRED'}
destination.write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report))
