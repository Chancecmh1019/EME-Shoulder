import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('public/ffmpeg', { recursive: true });
for (const file of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) await copyFile(`node_modules/@ffmpeg/core/dist/esm/${file}`, `public/ffmpeg/${file}`);
await mkdir('public/licenses', { recursive: true });
for (const family of ['noto-serif', 'noto-serif-tc', 'noto-serif-jp', 'noto-serif-kr']) await copyFile(`node_modules/@fontsource/${family}/LICENSE`, `public/licenses/${family}-OFL.txt`);
