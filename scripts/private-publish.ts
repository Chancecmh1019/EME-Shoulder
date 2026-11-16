import { readFileSync, writeFileSync, statSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileHash } from '../server/acquisition/audio.ts';
import { authorizeWorker } from '../server/acquisition/googleWorkerAuth.ts';
import { PrivateYouTube, type PrivateUploadState } from '../server/acquisition/youtubePrivate.ts';
import { removeCompletedTemporaryFiles } from '../server/acquisition/cleanup.ts';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pythonCommand } from '../server/acquisition/python.ts';
async function main() {
const [action, jobId, approvalPath] = process.argv.slice(2);
if (action === 'doctor') {
  console.log(JSON.stringify({ worker: 'private-youtube', storage: 'temporary files on execution computer', databaseOrS3Required: false, ownerOAuthConfigured: !!process.env.EME_YOUTUBE_CLIENT_FILE && !!process.env.EME_YOUTUBE_OWNER_EMAIL, realUploadVerified: false }));
} else if (action === 'publish') {
  if (!/^[a-f0-9]{20}$/.test(jobId ?? '') || !approvalPath) throw new Error('JOB_AND_EXPLICIT_OWNER_APPROVAL_FILE_REQUIRED');
  const directory = resolve('.studio/acquisition/jobs', jobId), request = JSON.parse(readFileSync(join(directory, 'render-request.json'), 'utf8'));
  const rendered = JSON.parse(readFileSync(join(directory, 'render-result.json'), 'utf8')), approval = JSON.parse(readFileSync(resolve(approvalPath), 'utf8'));
  const video = join(directory, 'video.mp4'), thumbnail = join(directory, 'thumbnail.jpg'), videoSha256 = await fileHash(video), thumbnailSha256 = await fileHash(thumbnail);
  if (rendered.schema !== 'eme.render-result.v1' || request.jobId !== jobId || rendered.jobId !== jobId || rendered.sourceHash !== request.sourceHash || rendered.promptHash !== request.promptHash || rendered.videoSha256 !== videoSha256 || rendered.thumbnailSha256 !== thumbnailSha256 || rendered.videoCodec !== 'avc' || rendered.audioCodec !== 'aac' || Math.abs(rendered.duration - request.duration) > .15) throw new Error('RENDERED_VIDEO_BINDING_OR_QA_FAILED');
  const owner = process.env.EME_YOUTUBE_OWNER_EMAIL, clientFile = process.env.EME_YOUTUBE_CLIENT_FILE;
  if (!owner || !clientFile) throw new Error('OWNER_GOOGLE_CONFIGURATION_REQUIRED');
  if (approval.jobId !== jobId || approval.videoSha256 !== videoSha256 || approval.ownerEmail?.toLowerCase() !== owner.toLowerCase() || approval.approvePrivateUpload !== true || approval.confirmedRights !== true || approval.visualAndAudioReviewed !== true || typeof approval.authorizationReference !== 'string' || approval.authorizationReference.length < 8 || !Number.isFinite(Date.parse(approval.expiresAt)) || Date.parse(approval.expiresAt) <= Date.now()) throw new Error('VALID_SPECIFIC_OWNER_APPROVAL_AND_RIGHTS_REQUIRED');
  execFileSync(process.execPath, [fileURLToPath(new URL('./inspect-render.mjs', import.meta.url)), video, String(request.duration), join(directory, 'video-inspection.json')], { timeout: 180000, windowsHide: true, maxBuffer: 1024 * 1024 });
  execFileSync(pythonCommand(), [fileURLToPath(new URL('./decode-render-output.py', import.meta.url)), video, join(directory, 'video-full-decode.json')], { timeout: 660000, windowsHide: true, maxBuffer: 1024 * 1024 });
  if (JSON.parse(readFileSync(join(directory, 'video-full-decode.json'), 'utf8')).videoSha256 !== videoSha256) throw new Error('FULL_DECODE_VIDEO_CHANGED');
  const client = await authorizeWorker(clientFile, owner, url => console.log(JSON.stringify({ stage: 'OWNER_GOOGLE_AUTHORIZATION_REQUIRED', authorizationUrl: url, note: 'Owner completes Google login; never paste credentials or tokens into chat.' })));
  const requestGoogle = async (url: string, init: RequestInit = {}) => {
    const target = new URL(url);
    if (target.protocol !== 'https:' || target.hostname !== 'www.googleapis.com') throw new Error('GOOGLE_ENDPOINT_REJECTED');
    const send = async () => fetch(target, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), Authorization: `Bearer ${(await client.getAccessToken()).token}` }, redirect: 'error', signal: AbortSignal.timeout(60000) });
    let response = await send();
    if (response.status === 401) { await client.refreshAccessToken(); response = await send(); }
    return response;
  };
  const youtube = new PrivateYouTube(requestGoogle), statePath = join(directory, 'private-upload-state.json');
  const state: PrivateUploadState = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { jobId, videoSha256, bytes: statSync(video).size, offset: 0 };
  if (state.jobId !== jobId || state.videoSha256 !== videoSha256 || state.bytes !== statSync(video).size) throw new Error('UPLOAD_CHECKPOINT_BINDING_FAILED');
  const save = async (value: PrivateUploadState) => { writeFileSync(`${statePath}.tmp`, JSON.stringify(value), { mode: 0o600 }); renameSync(`${statePath}.tmp`, statePath); console.log(JSON.stringify({ stage: 'PRIVATE_UPLOAD', jobId, uploadedBytes: value.offset, totalBytes: value.bytes, videoId: value.videoId })); };
  try {
    const description = `${request.artist} — ${request.title}\n${request.album}\nEME job ${jobId} / ${videoSha256.slice(0, 16)}`;
    const videoId = await youtube.upload(video, `${request.artist} — ${request.title}`, description, state, save);
    if (!state.thumbnailSet) { await youtube.thumbnail(videoId, readFileSync(thumbnail)); state.thumbnailSet = true; await save(state); }
    for (let attempt = 0; attempt < 20; attempt++) {
      const status = await youtube.status(videoId);
      console.log(JSON.stringify({ stage: 'YOUTUBE_PROCESSING', jobId, ...status }));
      if (status.complete) {
        const result = { schema: 'eme.youtube-private-result.v1', jobId, videoSha256, thumbnailSha256, ...status, thumbnailSet: true, verifiedAt: new Date().toISOString(), temporaryFilesRemoved: false };
        writeFileSync(join(directory, 'youtube-private-result.json'), JSON.stringify(result, null, 2));
        if (approval.removeTemporaryAfterPrivate === true) {
          const externalTask = JSON.parse(readFileSync(join(directory, 'external-task.json'), 'utf8'));
          if (externalTask.jobId !== jobId) throw new Error('CLEANUP_TASK_BINDING_FAILED');
          const receipts = resolve('.studio/handoff'); mkdirSync(receipts, { recursive: true });
          // A tiny acknowledgment is handed to the workbench; no audio, lyrics, prompts or tokens.
          const receiptPath = join(receipts, `${jobId}-youtube-private-result.json`);
          writeFileSync(receiptPath, JSON.stringify({ ...result, temporaryFilesRemoved: false }, null, 2));
          const cleanup = removeCompletedTemporaryFiles(process.cwd(), jobId, externalTask.requestHash, { complete: status.complete, privacyStatus: status.privacyStatus, thumbnailSet: !!state.thumbnailSet });
          writeFileSync(receiptPath, JSON.stringify({ ...result, ...cleanup }, null, 2));
          console.log(JSON.stringify({ ...result, ...cleanup, receiptPath, remaining: 'Only the small handoff receipt remains until the owner acknowledges it. Tool installation and unrelated projects are preserved.' }));
        } else console.log(JSON.stringify({ ...result, cleanup: 'Owner approval did not authorize deletion; temporary files retained.' }));
        break;
      }
      if (attempt === 19) throw new Error('PROCESSING_PENDING_KEEP_FILES_AND_RESUME');
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
  } finally { client.setCredentials({}); }
} else throw new Error('Usage: private-publish.ts doctor | publish JOB_ID OWNER_APPROVAL_FILE');
}
void main().catch(error => {
  const message = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'PRIVATE_WORKER_FAILED_SECRETS_REDACTED';
  console.error(JSON.stringify({ state: 'PRIVATE_UPLOAD_NOT_CONFIRMED', code: message, httpStatus: Number(error?.response?.status) || undefined, temporaryFilesRetained: true }));
  process.exitCode = 1;
});
