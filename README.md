# EME-Shoulder

The browser-based production workspace behind EMBRASEA Music Entertainment's Traditional Chinese translated lyric-video workflow.

EME-Shoulder brings translation preparation, album review, CD-Booklet lyric videos, MV subtitles, publishing assets, and YouTube delivery into one workspace. It also produces promotional excerpts for manual publication on Threads. Media processing takes place in the browser; a small server layer handles Google authorization and YouTube upload coordination.

The production model centers on line-by-line timing, human-reviewed translations, album projects, deterministic visual state, and a consistent channel identity. It does not include a generative AI service, TTML, or word-by-word lyric timing.

## Product philosophy

EMBRASEA connects the ideas of embrace and sea: accepting distance and allowing distant voices to arrive in another language. That perspective informs the paired original and translated lyrics, album-derived atmosphere, restrained hierarchy, and deliberate review process. Translation and publication remain human decisions.

## Production workflow

**Translation preparation → LRC Lab → Album Import → Track Review → CD-Booklet Preview → Render Queue → YouTube Publish Queue**

An `AlbumProject` contains multiple `TrackProject` records, shared artwork and visual settings, and track-specific production state. Review, rendering, and uploading are separate operations. A reviewer can move to the next track while an approved track renders or uploads. Rendering without uploading is supported; saved masters can be published later without rendering again.

### LRC Lab

LRC Lab has two stages inside the application's dialog workflow:

- **Static Translation Prompt Library:** predefined LRC and SRT prompts can be copied for external use. EME-Shoulder does not call an AI service or bundle a generative AI API.
- **Correction and validation:** imported or pasted lyrics are parsed, corrected, reviewed, copied, and exported. The workbench supports Copy & Clear, Clear, Undo, and clearing the current correction session. Optional audio playback and line-level editing support proofreading and timing review.

Correction addresses malformed or joined timestamps, ordering, whitespace, optional Traditional Chinese conversion, and pairing warnings. Corrected lyrics can be applied directly to album tracks or MV subtitle projects. Clearing a Lab session resets its lyric and audio review state; Undo restores the preceding session state while the dialog remains mounted.

### Lyric model

EME-Shoulder intentionally uses **line-by-line LRC** for CD-Booklet videos. One timed item contains an original lyric and an optional Traditional Chinese translation. Matching original and translation lines form one bilingual visual unit and share timing and depth state.

Multiline text is supported inside an item. It does not introduce word-level synchronization. TTML is not supported. SRT is used for the independent MV subtitle workflow.

## Album workspace

Audio imports are processed locally. `music-metadata` reads audio tags, embedded artwork, and available lyrics. Original media is retained; unsupported browser audio formats can be converted to WAV through locally hosted FFmpeg assets.

Tracks group by album title within an import batch, including OST and Various Artists collections where album-artist tags may be missing. Sorting uses disc number, track number, and stable import order; missing track numbers sort last. Same-title editions can be kept separate by importing them in separate batches.

Track review includes editable lyrics and timestamps, playback and seeking, and a track-level lyric offset with millisecond adjustment controls. Review, render, and publish states are stored independently. Unsynchronized embedded text remains available for manual preparation rather than being silently treated as timed lyrics.

## CD-Booklet visual system

CD-Booklet is the single album lyric-video composition. Artwork and centered artist, song, and album metadata occupy the left column. A continuous bilingual lyric stream occupies the right. An album-derived animated background, EMBRASEA branding, and disc/track information complete the frame.

The composition draws from editorial CD booklets, full-screen music players, and Apple Music-like lyric depth and motion. EME-Shoulder is an independent application and is not affiliated with Apple.

### Background environment

The background integrates the pinned `@applemusic-like-lyrics/core` 0.6.0 package from [Apple Music-like Lyrics (AMLL)](https://github.com/amll-dev/applemusic-like-lyrics). `services/background.ts` adapts its mesh renderer to album artwork and an explicit source-time clock, with fixed mesh control and no accumulated playback history. AMLL supplies the background renderer; EME-Shoulder owns the composition, lyric layout, and production workflow.

AMLL core is AGPL-3.0-only. This repository is distributed under AGPL-3.0-only and retains its source-availability and third-party notices.

### Bilingual lyric rendering

Original and translation use independently configured typography. Canvas measurement determines each complete item's height, including wrapped lines and the internal bilingual gap.

The continuous lyric stream has a focused active item and distance-based opacity, blur, and scale. Contextual original and translation lines move into depth together; the active item remains sharp. Inter-item spacing and source-time scrolling preserve the relationship between complete bilingual blocks.

Visible future context is adaptive rather than a fixed row template. Short items can reveal additional upcoming lyrics when their measured geometry fits below the active item. Taller bilingual or multiline items naturally reveal fewer. Soft edge masks let the stream recede at the viewport boundaries. Typography is not reduced and gaps are not stretched to fill unused space.

### Deterministic scene state

The rendering principle is `SceneState(Project, Time)`: visual state is derived from source media time rather than elapsed animation frames. Preview and export share `BookletScene`, including measurement, layout, depth, masks, and background control.

Seeking to a timestamp and rendering that timestamp offline use the same scene logic. Threads excerpts retain the original source timestamp for their visuals even though exported clips begin at output time zero. This avoids separate preview and export layouts or animation histories.

## Video output and media processing

The shared master renderer currently produces:

| Property | Implementation |
| --- | --- |
| Frame size | 1920 × 1080 |
| Frame rate | 60 FPS |
| Container | Fragmented MP4 |
| Video | H.264 / AVC, configured at 8 Mbps |
| Audio | AAC, configured at 192 kbps when a source audio track exists |
| Composition | 16:9 CD-Booklet or MV subtitle canvas |

These values come from `services/renderEngine.ts`. Threads clips use the same specification with a selected source range. MV footage is fitted within the shared canvas, including letterboxing where necessary.

[Mediabunny](https://github.com/Vanilagy/mediabunny) 1.61.0 provides media input, decoding adapters, WebCodecs-backed encoding, and MP4 muxing. Canvas frames and decoded audio are interleaved during export. OPFS provides a streaming scratch target when available; a memory buffer is the fallback. Completed output is saved to IndexedDB before publication. Temporary OPFS output is removed when a render finishes or fails.

Production requires H.264/AAC WebCodecs and WebGL support. The interface directs users to current Chrome or Edge. Available memory, storage quota, and keeping the page open remain practical constraints; background tabs can throttle processing. No server-side video encoder is part of this architecture.

## Publishing assets

### CD-Booklet thumbnails

Thumbnails use a consistent channel composition and album-derived background. A deterministic Dynamic Still time is selected from album identity, disc/track data, track title, and a reshuffle seed. Tracks from one album can share a visual family while producing different stills.

Current thumbnails are 1280 × 720 JPEGs. Publishing titles and structured descriptions derive from track metadata and preserve manual overrides.

### Threads Clip

Threads Clip analyzes tracks locally to propose excerpt candidates. Scoring combines LRC boundaries and repetition with sampled RMS audio energy, energy changes, and ending conditions. This is heuristic selection, not an AI service or a perceptual loudness standard.

Typical candidates span 25–40 seconds; short songs can use their complete duration. Reviewers select candidates, adjust ranges, optionally align them with lyric boundaries, and preview excerpts. The shared render queue produces CD-Booklet clips and attempts automatic downloads. Saved clips remain available for explicit download if the browser blocks a delayed download.

**Threads publication remains manual by design.** There is no direct Threads API integration, and these excerpts are not a YouTube Shorts workflow.

### MV subtitles

The independent MV workflow combines MP4 footage and SRT text with subtitle review, rendering, and YouTube publishing. It shares queue, encoding, storage, and publishing infrastructure without requiring album ID3 metadata. Reusing metadata is an explicit review choice.

## Queues and persistence

### Heavy-render queue

`ProductionQueue` serializes `ALBUM_MASTER`, `MV_MASTER`, and `THREADS_CLIP` jobs in enqueue order. Default render concurrency is one. This bounds simultaneous encoder, WebGL, decoded-audio, and memory allocations, especially on tablets and constrained devices. It is not a guarantee of compatibility with every device.

Jobs retain snapshots of their source track and visual settings. Progress, cancellation, retry state, and output references are stored with the project. Interrupted jobs become recoverable states after reload.

### YouTube publish queue

A separate upload worker has concurrency one and can run alongside rendering. One track can upload while another renders. Upload retries use saved MP4 output rather than requiring a new render.

The workflow defaults to Private uploads, with explicit privacy metadata available during review. It uses resumable sessions, direct browser-to-Google media chunks, persisted byte progress, and confirmed YouTube video IDs. Custom thumbnails upload separately. A thumbnail failure retains the confirmed video ID so retrying does not create another video.

### Browser storage

IndexedDB separates project state from large media blobs in `state` and `media` stores. State includes album and track metadata, review decisions, offsets, Lab drafts, render jobs, clip selection, and upload recovery information. Media includes imported sources, prepared audio, artwork, thumbnails, and completed videos.

OPFS is temporary rendering storage rather than the durable project database. The application can request persistent browser storage, but website data is not an external backup. Original media should be retained; clearing website storage removes local projects and outputs.

## Google and YouTube integration

The current interface uses a same-tab Google OAuth authorization-code redirect with S256 PKCE, state, and nonce checks. It does not depend on a Google Identity Services popup or client-side GIS script. A server-side identity endpoint also supports ID-token verification through Google Auth Library.

Authorization is restricted to the configured owner account. Scopes cover identity, video/thumbnail uploads, and reading the destination channel. The YouTube Data API supports resumable sessions and thumbnail publication.

Access and refresh tokens are sealed in encrypted HttpOnly cookies. The browser requests a transient access token for direct Google media requests; tokens are not stored in project records. Server configuration uses environment variables; server-side secrets must never be placed in browser-visible `VITE_*` variables. Disconnect revokes the Google grant.

Publication remains subject to owner authorization, API permissions and quotas, and channel thumbnail eligibility. This overview does not assert that a particular deployed account has passed an upload verification.

## Application and deployment architecture

EME-Shoulder is designed for Vercel: Vite builds the browser application, and lightweight `api/` functions handle authorization, token refresh, upload-session creation, and status queries. Large video bodies go directly to Google rather than through serverless functions. Local Vite development exposes the same handlers; static preview alone does not provide the API layer.

Deployment configuration is documented separately in [DEPLOYMENT.md](DEPLOYMENT.md). The repository targets Node.js 22.x. Its build performs TypeScript checking before producing the bundle.

| Domain | Main modules and technologies |
| --- | --- |
| Interface and review | React 19, TypeScript, `App.tsx`, `components/` |
| Project model | `types.ts`, `services/library.ts` |
| Import and audio preparation | `services/importAlbum.ts`, `services/audioSupport.ts`, `music-metadata`, FFmpeg WASM |
| Lyric preparation | `utils/parsers.ts`, `utils/lyricCorrection.ts`, static prompts, `opencc-js` |
| Scene and background | `services/scene.ts`, `services/background.ts`, Canvas 2D, AMLL, WebGL |
| Encoding and clip analysis | `services/renderEngine.ts`, `services/clipAnalyzer.ts`, Mediabunny, WebCodecs |
| Persistence and scheduling | `services/storage.ts`, `services/queue.ts`, IndexedDB, OPFS |
| Publishing and authorization | `services/youtube.ts`, `utils/publishing.ts`, `api/`, Google Auth Library, YouTube Data API |
| Build and hosting | Vite 6, TypeScript, `scripts/assets.mjs`, `vercel.json` |

Noto Serif, Noto Serif TC, Noto Serif JP, and Noto Serif KR are locally hosted through Fontsource. Scene measurement waits for required fonts. The design principles are one coherent CD-Booklet identity, album-derived atmosphere, readable bilingual items, continuous motion, deterministic output, and less repeated manual work. Translation and publishing remain human-controlled.

## License and third-party software

EME-Shoulder is distributed under **AGPL-3.0-only**; see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Corresponding source is published in [Chancecmh1019/EME-Shoulder](https://github.com/Chancecmh1019/EME-Shoulder). Hosted versions must make the corresponding source for their exact deployed build available, including modifications and build configuration.

AMLL core is AGPL-3.0-only, Mediabunny is MPL-2.0, FFmpeg WASM wrappers are MIT, and the distributed `@ffmpeg/core` package is GPL-2.0-or-later. FFmpeg binary distribution also requires applicable source and build information; the notices identify upstream sources. Noto Serif fonts use SIL Open Font License 1.1, with retained notices in `public/licenses/`.

Required third-party notices and corresponding-source obligations are retained alongside this overview.
