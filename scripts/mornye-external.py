"""EME's thin launcher for an independently installed Mornye-Python.

No provider implementation is copied into EME. Run with an isolated venv.
"""
import argparse
import asyncio
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import shutil
import sys
import secrets
import threading
import re
import unicodedata
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlencode, urlsplit, parse_qs

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / '.studio' / 'mornye-external'
WORK.mkdir(parents=True, exist_ok=True)
if sys.prefix != sys.base_prefix and ROOT in Path(sys.prefix).resolve().parents:
    # EME is ESM; the independent tool's Node preload scripts are CommonJS.
    (Path(sys.prefix) / 'package.json').write_text('{"private":true,"type":"commonjs"}', encoding='utf-8')
os.environ['MORNYE_DATA_DIR'] = str(WORK / 'data')
os.environ['MORNYE_CACHE_DIR'] = str(WORK / 'cache')
os.environ['MORNYE_MIN_TRUST'] = 'checksum-only'
# Native provider children must not inherit EME/Supabase/Google credentials.
for name in list(os.environ):
    if name.startswith(('SUPABASE_', 'S3_', 'AWS_', 'GOOGLE_', 'APPLE_', 'DATABASE_', 'TURNSTILE_')):
        del os.environ[name]
os.chdir(WORK)
REGISTRY = 'https://raw.githubusercontent.com/mornyeapp/Mornye-Extension/main/registry.json'
PYTHON_REGISTRY = REGISTRY.replace('registry.json', 'registry-python.json')


def emit(value):
    print(json.dumps(value, ensure_ascii=True), flush=True)


def setup():
    from mornye.extensions import ExtensionManager
    manager = ExtensionManager(auto_install_downloads=False, min_trust_tier='checksum-only')
    for name in ['utilities', 'qobuz-web', 'tidal-web', 'apple-music']:
        installed = manager.install(name, registry_url=PYTHON_REGISTRY if name == 'utilities' else REGISTRY)
        emit({'stage': 'extension-installed', 'id': name, 'version': installed.version})


def manual_only_sessions():
    # Use the upstream function's explicit opt-out. Never run its browser/CAPTCHA solver.
    from functools import partial
    from mornye.extensions import runtime_features
    runtime_features.perform_signed_fetch = partial(runtime_features.perform_signed_fetch, use_turnstile_browser=False)


async def authenticate(provider_id):
    from mornye.extensions import ExtensionManager
    from mornye.extensions.runtime_features import signed_session_client
    manager = ExtensionManager(auto_install_downloads=False)
    extension = manager.get_installed(provider_id)
    if not extension:
        raise ValueError('INSTALL_EXTENSION_FIRST')
    client = signed_session_client(extension.manifest)
    if not client:
        raise ValueError('PROVIDER_HAS_NO_SIGNED_SESSION')
    state, received = secrets.token_urlsafe(32), {}
    callback_path = '/callback/' + secrets.token_hex(16)

    class Callback(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass  # Grants must never enter access logs.

        def do_GET(self):
            url = urlsplit(self.path)
            query = parse_qs(url.query)
            if url.path != callback_path or query.get('state') != [state] or len(query.get('grant', [])) != 1:
                self.send_error(400)
                return
            received['grant'] = query['grant'][0]
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write('驗證回呼已收到，可以返回 EME。'.encode('utf-8'))

    server = HTTPServer(('127.0.0.1', 0), Callback)
    server.timeout = 1
    try:
        if client.authenticated:
            emit({'stage': 'authenticated', 'provider': provider_id, 'reused': True})
            return 0
        boot = await client.bootstrap()
        if boot is True:
            emit({'stage': 'authenticated', 'provider': provider_id})
            return 0
        challenge_id = client.pending_challenge_id
        if not challenge_id:
            raise RuntimeError('PROVIDER_DID_NOT_RETURN_CHALLENGE_ID')
        callback = f'http://127.0.0.1:{server.server_port}{callback_path}?' + urlencode({'state': state, 'cb_version': 'v2grant'})
        challenge_url = client.base_url + client.endpoints['challenge'] + '?' + urlencode({'id': challenge_id, 'cb': callback})
        instruction = {'stage': 'OWNER_VERIFICATION_REQUIRED', 'provider': provider_id, 'url': challenge_url, 'expiresInSeconds': 600}
        (WORK / 'owner-verification.json').write_text(json.dumps(instruction), encoding='utf-8')
        emit(instruction)
        # The owner completes the widget; no automated clicks, solver, cookie or token fabrication.
        import time
        until = time.monotonic() + 600
        while not received and time.monotonic() < until:
            await asyncio.to_thread(server.handle_request)
        if not received:
            raise TimeoutError('OWNER_VERIFICATION_NOT_COMPLETED')
        await client.exchange_grant(received.pop('grant'))
        emit({'stage': 'authenticated', 'provider': provider_id, 'sessionStoredPrivately': True})
        return 0
    finally:
        server.server_close()
        await client.aclose()


async def execute(task_path, source_url):
    from mornye import AsyncMornye
    task = json.loads(Path(task_path).read_text(encoding='utf-8'))
    if task.get('schema') != 'eme.external-audio.v1' or not re.fullmatch(r'[a-f0-9]{64}', task.get('requestHash', '')) or not re.fullmatch(r'[a-f0-9]{20}', task.get('jobId', '')):
        raise ValueError('INVALID_EXTERNAL_TASK')
    manual_only_sessions()
    output = WORK / 'outputs' / task['requestHash']
    output.mkdir(parents=True, exist_ok=True)
    previous_path = output / 'execution.json'
    if previous_path.exists():
        previous = json.loads(previous_path.read_text(encoding='utf-8'))
        if previous.get('sourceReference') != source_url:
            raise ValueError('SOURCE_CHANGED_REQUIRES_NEW_TASK')
        if previous.get('state') == 'ARTIFACT_INSPECTION_REQUIRED' and previous.get('files'):
            for file in previous['files']:
                with Path(file['path']).open('rb') as stream:
                    if hashlib.file_digest(stream, 'sha256').hexdigest() != file['sha256']:
                        raise ValueError('PERSISTED_OUTPUT_HASH_MISMATCH')
            emit({**previous, 'reused': True})
            return 0
        if not os.environ.get('EME_EXTERNAL_RETRY_REASON'):
            raise RuntimeError('PREVIOUS_ATTEMPT_FAILED: supply --retry-reason after correcting the recorded cause')
    async with AsyncMornye(output_dir=str(output), services=['ext:tidal-web'],
                           sync_extensions=False, embed_lyrics=False, save_lrc=False,
                           enrich_metadata=False,
                           track_max_retries=0, timeout_s=90, max_concurrent_downloads=1,
                           save_animated_artwork=False) as client:
        from mornye.extensions.provider import JSExtensionProvider
        provider_id = 'apple-music' if 'music.apple.com/' in source_url else 'qobuz-web' if 'qobuz.com/' in source_url else 'tidal-web'
        provider = JSExtensionProvider(provider_id, timeout_s=45)
        try:
            resolved = await asyncio.to_thread(provider.get_url, source_url)
        finally:
            provider.close()
        if len(resolved[1]) != 1:
            raise ValueError('EXPECTED_SINGLE_RECORDING')
        metadata = resolved[1][0]
        emit({'stage': 'resolved', 'metadata': metadata.model_dump(mode='json')})
        expected = task['requested']
        def normalized(value):
            return re.sub(r'[^\w]', '', unicodedata.normalize('NFKC', value).casefold())
        if normalized(metadata.title) not in [normalized(x) for x in [expected['title'], *expected.get('aliases', [])]] or normalized(metadata.artists) not in [normalized(x) for x in [expected['artist'], *expected.get('artistAliases', [])]]:
            raise ValueError('NATIVE_METADATA_RECORDING_CONFLICT')
        expected_duration = expected.get('durationMs')
        if not expected_duration or abs(metadata.duration_ms - expected_duration) > max(3000, expected_duration * .02):
            raise ValueError('NATIVE_METADATA_DURATION_CONFLICT')
        # Resolve is evidence only. A successful return from download_track is not a file receipt.
        failed = await asyncio.wait_for(client.download_track(source_url), timeout=240)
        files = []
        for path in output.rglob('*'):
            if path.is_file() and path.suffix.lower() in ['.flac', '.m4a', '.mp3', '.wav', '.ogg', '.opus']:
                with path.open('rb') as stream:
                    digest = hashlib.file_digest(stream, 'sha256').hexdigest()
                files.append({'path': str(path), 'bytes': path.stat().st_size, 'sha256': digest})
        result = {'schema': 'eme.mornye-execution.v1', 'jobId': task['jobId'], 'requestHash': task['requestHash'],
                  'toolVersion': importlib.metadata.version('mornye'), 'sourceReference': source_url,
                  'failedTracks': len(failed), 'files': files, 'state': 'ARTIFACT_INSPECTION_REQUIRED' if files and not failed else 'AUDIO_ACQUISITION_FAILED',
                  'translationAllowed': False}
        result['retryReason'] = os.environ.get('EME_EXTERNAL_RETRY_REASON')
        (output / 'execution.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
        emit(result)
        return 0 if files and not failed else 1


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['doctor', 'setup', 'authenticate', 'execute'])
    parser.add_argument('--task')
    parser.add_argument('--source')
    parser.add_argument('--provider', choices=['tidal-web', 'qobuz-web'], default='tidal-web')
    parser.add_argument('--retry-reason')
    args = parser.parse_args()
    if args.action == 'doctor':
        emit({'tool': 'mornye', 'version': importlib.metadata.version('mornye'), 'python': sys.version.split()[0],
              'node': shutil.which('node'), 'ffmpeg': shutil.which('ffmpeg'), 'dataDirectory': str(WORK),
              'environment': 'Codex local worker; Dot cloud not verified', 'automaticChallengeSolver': False})
    elif args.action == 'setup':
        setup()
    elif args.action == 'authenticate':
        return asyncio.run(authenticate(args.provider))
    else:
        if not args.task or not args.source:
            raise ValueError('TASK_AND_VERIFIED_SOURCE_REQUIRED')
        if args.retry_reason:
            os.environ['EME_EXTERNAL_RETRY_REASON'] = args.retry_reason[:500]
        from urllib.parse import urlsplit
        url = urlsplit(args.source)
        if url.scheme != 'https' or url.username or url.password or url.hostname not in ['music.apple.com', 'open.qobuz.com', 'www.qobuz.com', 'tidal.com']:
            raise ValueError('UNSUPPORTED_SOURCE_REFERENCE')
        return asyncio.run(execute(str((ROOT / args.task).resolve()), args.source))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        # Detailed provider diagnostics stay in the owner's local worker log.
        emit({'state': 'EXTERNAL_EXECUTION_FAILED', 'errorType': type(error).__name__, 'error': str(error)[:1000], 'translationAllowed': False})
        sys.exit(1)
