"""Lossless PCM derivative for browsers, preserving the original Mornye artifact."""
import hashlib
import json
import pathlib
import re
import subprocess
import sys
root = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / '.studio/python'))
import imageio_ffmpeg
job = sys.argv[1]
if not re.fullmatch('[a-f0-9]{20}', job):
    raise ValueError('INVALID_JOB')
directory = root / '.studio/acquisition/jobs' / job
report = json.loads((directory / 'report.json').read_text(encoding='utf-8'))
source = pathlib.Path(report['audio']['path'])
source_hash = hashlib.file_digest(source.open('rb'), 'sha256').hexdigest()
if source_hash != report['audio']['sha256']:
    raise ValueError('SOURCE_AUDIO_HASH_CHANGED')
output, receipt_path = directory / 'render-audio.wav', directory / 'render-audio.json'
ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
def artwork_info():
    artwork = directory / 'artwork.jpg'
    if not artwork.exists():
        subprocess.run([ffmpeg, '-nostdin', '-v', 'error', '-i', str(source), '-map', '0:v:0', '-frames:v', '1', '-c:v', 'copy', '-n', str(artwork)], check=True, timeout=30)
    return {'path': str(artwork), 'sha256': hashlib.file_digest(artwork.open('rb'), 'sha256').hexdigest(), 'bytes': artwork.stat().st_size, 'method': 'unchanged embedded JPEG from original audio'}
if output.exists() and receipt_path.exists():
    previous = json.loads(receipt_path.read_text(encoding='utf-8'))
    if previous['sourceSha256'] == source_hash and hashlib.file_digest(output.open('rb'), 'sha256').hexdigest() == previous['sha256']:
        previous['artwork'] = artwork_info()
        receipt_path.write_text(json.dumps(previous, indent=2), encoding='utf-8')
        print(json.dumps({**previous, 'reused': True}))
        sys.exit(0)
    raise ValueError('EXISTING_RENDER_AUDIO_CONFLICT')
subprocess.run([ffmpeg, '-nostdin', '-v', 'error', '-xerror', '-i', str(source), '-map', '0:a:0', '-map_metadata', '-1', '-c:a', 'pcm_s16le', '-n', str(output)], check=True, timeout=180)
def pcm_hash(path):
    result = subprocess.run([ffmpeg, '-nostdin', '-v', 'error', '-xerror', '-i', str(path), '-map', '0:a:0', '-c:a', 'pcm_s16le', '-f', 's16le', 'pipe:1'], capture_output=True, check=True, timeout=180)
    return hashlib.sha256(result.stdout).hexdigest()
original_pcm, derivative_pcm = pcm_hash(source), pcm_hash(output)
if original_pcm != derivative_pcm:
    raise ValueError('RENDER_AUDIO_PCM_CHANGED')
receipt = {'jobId': job, 'path': str(output), 'sourceSha256': source_hash, 'sha256': hashlib.file_digest(output.open('rb'), 'sha256').hexdigest(), 'decodedPcmSha256': original_pcm,
           'sourceAndDerivativePcmIdentical': True, 'bytes': output.stat().st_size, 'durationSeconds': report['audio']['metadata']['format']['duration'],
           'purpose': 'browser/render compatibility; original preserved; not a different recording', 'translationOrRenderCompleted': False}
receipt['artwork'] = artwork_info()
receipt_path.write_text(json.dumps(receipt, indent=2), encoding='utf-8')
print(json.dumps(receipt))
