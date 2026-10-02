# EME-Shoulder

by EMBRASEA Music Entertainment. A single-owner, browser-side album production studio.

## Workflows

- Import an album's audio files together. ID3/Vorbis/MP4 metadata, embedded line-based lyrics and artwork are read locally. Albums group by album title so OST / Various Artists with missing album artist stay together; same-title editions can be imported in separate batches. Track ordering is disc, track, stable import order. Missing track numbers sort last. Conversion concurrency is one. Unsupported codecs use locally hosted FFmpeg to produce a WAV while preserving the source.
- Review each track with audio playback, direct seeking, original + optional Traditional Chinese translation, editable timestamps and global delay. Approve, Render & Upload authorizes both operations and immediately advances to the next unresolved track.
- Render queue concurrency is one; upload queue concurrency is independently one. MP4 is persisted before upload starts. Upload failure never requires rerendering. Interrupted jobs become recoverable errors on reload. Downloads are explicit. Completed uploads can release their local MP4.
- One CD-Booklet composition, including a deterministic album-art-derived AMLL background. Thumbnails use a track-specific background time and a reshuffle counter, with a large preview and 168px feed preview. Titles and descriptions derive from metadata and preserve manual overrides.
- MV Subtitle imports MP4 and SRT, supports subtitle proofreading and shared rendering/upload infrastructure. Metadata reuse is a manual choice.
- LRC Lab retains the original widget's concentrated workflow: paste/import → Execute Correction → inspect warnings and editable result → copy/download. One correction repairs glued timestamps, normalizes mixed timestamp punctuation, sorts, optionally converts Chinese, cleans trailing spaces, preserves metadata and checks missing translations / unusual pairing. The same tool opens directly inside Album/MV review and applies the result without downloading and importing again. Optional audio/line review is expandable inside the popup. Untimed embedded lyrics are retained for manual preparation rather than silently treated as synchronized.

## Local development

Node 22+. `npm ci` installs dependencies and copies FFmpeg core to public/ffmpeg. `npm run dev` runs the UI; `npm run build` performs TypeScript checking and creates dist. OAuth handlers run server-side in local Vite development with the variables below.

## Vercel deployment

Import this project in Vercel with the Vite preset. The checked-in vercel.json sets SPA handling, CSP and local worker/WASM assets. No Vercel Function receives video bodies. Media encoding and storage stay in the browser; video chunks go directly to Google. Functions handle token exchange, refresh, session creation and empty upload status queries.

Set APP_ORIGIN to the exact HTTPS production origin (no path); GOOGLE_CLIENT_ID; GOOGLE_CLIENT_SECRET; OWNER_EMAIL; SESSION_SECRET (32 cryptographically random bytes encoded as base64). None is client-bundled. Use different credentials/settings for preview deployments. Set the Google OAuth Web client authorized origin to APP_ORIGIN and its redirect URI to `https://YOUR_ORIGIN/api/auth?action=callback`. Enable YouTube Data API v3, configure the OAuth consent screen and add the owner as a test user if applicable. Offline refresh tokens in testing mode may expire; reconnect when requested. Google Identity Services handles optional identity sign-in; YouTube authorization uses the official authorization endpoint with authorization code + S256 PKCE because the GIS code client's public options do not expose a custom PKCE challenge. Both identity and OAuth callback verify the configured owner. Grants are openid/email, youtube.upload (video + thumbnail) and youtube.readonly (display the destination channel). Default privacy is Private.

Access/refresh tokens live in AES-GCM encrypted, HttpOnly, Secure, SameSite cookies, expire in 30 days and are never stored in project storage. Same-origin POSTs require an explicit request header. Browser access tokens are requested only for direct Google media requests and are held transiently. Disconnect revokes the Google grant. No team/account systems are included.

Google API projects may require verification/audit; custom thumbnails require channel eligibility. A private upload and thumbnail must be exercised with the actual owner's credentials before deployment is called verified. OAuth/authentication, consent, thumbnail eligibility, API quotas and Content ID remain Google's controls.

## Rendering architecture

services/scene.ts owns lyric measurement, whole-line position/opacity/blur/scale, layout and the clock. Preview and export call the SAME Canvas scene with `audio.currentTime` or `frame / fps`. Variable original/translation height comes from actual text measurement. services/background.ts wraps the pinned AMLL MeshGradientRenderer 0.6.0 using fixed mesh geometry, explicit absolute time and no album crossfade history. PixiRenderer was not selected: its ticker, random sprite rotations and accumulated filters complicate arbitrary-time offline rendering. The mesh adapter can render after a backward seek without replaying frames. Context loss is surfaced as a recoverable error; every scene disposes GL objects and explicitly releases its context. Album cards are static artwork.

Mediabunny 1.61.0 replaces deprecated mp4-muxer for maintained WebCodecs source/sink adapters, AAC/H.264 MP4 muxing, bounded backpressure and OPFS streaming. Audio and video are interleaved during export; all exports use 1080p 60 FPS. OPFS is a render scratch target, IndexedDB stores durable metadata and media separately. A BufferTarget fallback is used when OPFS is unavailable. Long exports require enough device storage and the browser to stay open. Background tabs may throttle processing. Chrome/Edge with H.264/AAC WebCodecs and WebGL are the supported production targets. The shared 16:9 MV canvas fits portrait footage with letterboxing.

## Persistence and operational limits

Project metadata, imported blobs, rendering audio, review states, output MP4, thumbnail seed, title/description overrides, upload session URL, byte progress and confirmed YouTube IDs are kept in IndexedDB. Storage errors are visible. Persistent-storage permission reduces eviction, but browser storage is not an external backup. Keep original media. The new album database is versioned separately; the old application had no durable project database to migrate.

## Security and license

Previously committed API credentials must be revoked or rotated by the owner outside this repository. Removing them from this source does not invalidate historical exposed credentials. They were deleted, not migrated.

This source is AGPL-3.0-only. See LICENSE and THIRD_PARTY_NOTICES.md. Before hosting, publish the exact corresponding source and update/verify the Settings source link. Corresponding source: https://github.com/Chancecmh1019/EME-Shoulder . See DEPLOYMENT.md for the deployment walkthrough.

### 本機 API 與獨立匯出
`npm run dev` 現在會在 Node 端執行相同的 `/api/auth` 與 `/api/youtube` handlers。OAuth 變數寫入 `.env.local`；APP_ORIGIN 必須與實際網址及 Google callback 完全一致（例如 http://127.0.0.1:3001）。請勿使用純 `vite preview` 測試上傳，正式環境由 Vercel Functions 提供 API。
未設定 Google 時可使用「僅匯出影片 · 60 FPS」，在 Queue 下載 MP4；連接後可直接上傳既有輸出。所有正式匯出固定 1080p / 60 FPS。字型本機託管 Noto Serif、TC、JP、KR，場景量測前等待所需字元載入。歌詞預設原文 60px、翻譯 44px（1080p 基準），專輯字级滑桿可調。逐行列表及整份校正器各自捲動，不延伸整頁。

