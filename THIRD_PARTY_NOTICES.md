# Licensing and source availability

EME Shoulder is distributed under AGPL-3.0-only. The complete license is in LICENSE.
The upstream repository did not contain a license in this supplied checkout; publication under this license must be made by the repository copyright holder.

Apple Music-like Lyrics core 0.6.0, copyright SteveXMH and contributors, is AGPL-3.0-only.
Source: https://github.com/amll-dev/applemusic-like-lyrics
Package: https://www.npmjs.com/package/@applemusic-like-lyrics/core/v/0.6.0
Its original license is preserved in node_modules and included as the project's LICENSE.
No upstream source is modified or vendored. services/background.ts is an EME Shoulder adapter to the pinned package's mesh internals. It disables the wall clock, fixes control points and alpha, and draws at an absolute supplied time. Do not upgrade AMLL without reviewing this adapter and the frame equality checks.

Mediabunny is MPL-2.0 (https://github.com/Vanilagy/mediabunny); FFmpeg WASM wrappers are MIT, and @ffmpeg/core is GPL-2.0-or-later with its upstream FFmpeg component notices (https://github.com/ffmpegwasm/ffmpeg.wasm). React is MIT; Vite is MIT; music-metadata is MIT; opencc-js is MIT. Package license files remain in the dependency tree.

When deploying, make the corresponding source for the EXACT deployed build, package lock, adapter, build scripts and modifications available to every user interacting with this application. Settings includes a source link. Publish the rebuilt source to that repository before public hosting, or update Settings to a reachable repository/archive for the exact deployed version. If distributing the FFmpeg binaries in public/ffmpeg, also make the corresponding upstream core source and build configuration available, following its GPL requirements. npm run assets copies the binaries without altering them. Do not remove their notices. Keep deployment commits/tags identifiable. This checkout is not itself a publication of source to the remote repository.

Noto Serif (Latin), Noto Serif TC, JP and KR are locally hosted from Fontsource and distributed under the SIL Open Font License 1.1. Preserve the upstream copyright and OFL notices from their package directories when distributing fonts. Source: https://github.com/notofonts . No Noto Sans fonts are used in the application.

