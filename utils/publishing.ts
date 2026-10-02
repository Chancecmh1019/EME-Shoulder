import type { TrackProject } from '../types';
export const videoTitle = (t: TrackProject) => t.titleOverride ?? `${t.artist} — ${t.title}｜繁體中文歌詞${t.kind === 'mv' ? ' · MV' : ''}`;
export const videoDescription = (t: TrackProject) => t.descriptionOverride ?? [
  `〈${t.title}〉｜${t.artist}`, '',
  '「願遠方而來的潮汐，都能在此尋得一處停靠的淺灘。」', '',
  '── 曲目札記 ──', `曲名｜${t.title}`, `演出｜${t.artist}`,
  ...(t.album ? [`專輯｜${t.album}`] : []),
  ...(t.trackNumber ? [`曲序｜${t.discNumber || 1} − ${String(t.trackNumber).padStart(2, '0')}`] : []),
  `呈現｜繁體中文${t.lyrics.some(l => l.translation) ? '翻譯與' : ''}歌詞${t.kind === 'mv' ? '字幕' : '影片'}`, '',
  '── 關於我們 ──', 'EMBRASEA Music Entertainment', 'Embrace what arrives. Let the sea move.', '',
  '影像製作｜EME-Shoulder', '音樂與影像權利歸原權利人所有。',
].join('\n');
export function validatePublishing(t: TrackProject) { const issues: string[] = []; if (!videoTitle(t).trim() || [...videoTitle(t)].length > 100) issues.push('YouTube 標題必須為 1–100 字'); if (new TextEncoder().encode(videoDescription(t)).length > 5000) issues.push('YouTube 說明超過 5000 bytes'); if (/[<>]/.test(videoTitle(t) + videoDescription(t))) issues.push('YouTube 標題與說明不可包含 < 或 >'); return issues; }
