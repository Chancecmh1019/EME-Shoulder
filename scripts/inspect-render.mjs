import { readFile, writeFile } from 'node:fs/promises';
import { Input, BufferSource, ALL_FORMATS } from 'mediabunny';

const [path, secondsText, reportPath] = process.argv.slice(2);
if (!path || !secondsText || !(Number(secondsText) > 0)) throw new Error('Usage: node scripts/inspect-render.mjs <mp4> <expected-seconds> [report.json]');
const bytes = await readFile(path);
const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
try {
  const duration = await input.computeDuration(), video = await input.getPrimaryVideoTrack(), audio = await input.getPrimaryAudioTrack();
  const stats = await video?.computePacketStats();
  const report = {
    bytes: bytes.length, duration, width: video?.displayWidth, height: video?.displayHeight,
    videoCodec: video?.codec, audioCodec: audio?.codec, channels: audio?.numberOfChannels, sampleRate: audio?.sampleRate,
    frames: stats?.packetCount, averageFrameRate: stats?.averagePacketRate,
    passed: Math.abs(duration - Number(secondsText)) <= .15 && video?.displayWidth === 1920 && video?.displayHeight === 1080 && video?.codec === 'avc' && audio?.codec === 'aac' && Math.abs((stats?.averagePacketRate ?? 0) - 60) < .2,
    limits: 'Container/packet inspection only; does not establish black-frame, audio loudness, decode integrity, lyric identity, alignment or visual parity.',
  };
  if (reportPath) await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
} finally { input.dispose(); }
