import React, { useEffect, useRef, useState } from 'react';
import { BookletScene, drawSubtitles, loadSceneFonts } from '../services/scene';
import { getMedia } from '../services/storage';
import { makeThumbnail } from '../services/renderEngine';
import type { AlbumProject, TrackProject, VisualConfig } from '../types';
import { useMediaUrl } from './hooks';
type AlbumView = Pick<AlbumProject, 'id' | 'artworkKey' | 'visual'>;
export function Preview({ track, album, onTime, mediaRef }: { track: TrackProject; album: AlbumView; onTime: (time: number) => void; mediaRef: React.RefObject<HTMLMediaElement | null> }) {
  const canvas = useRef<HTMLCanvasElement>(null); const video = useRef<HTMLVideoElement>(null);
  const url = useMediaUrl(track.kind === 'mv' ? track.sourceKey : track.audioKey); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true, frame = 0, scene: BookletScene | undefined; setError(''); setLoading(true);
    const context = canvas.current!.getContext('2d')!; let lastTime = -1;
    const run = async () => {
      try {
        await loadSceneFonts(track);
        if (track.kind === 'lyric') scene = await BookletScene.create(track, album.visual, await getMedia(track.artworkKey || album.artworkKey || ''), context);
        if (!alive) { scene?.dispose(); return; } setLoading(false);
        const draw = () => {
          if (!alive) return;
          try {
            const time = mediaRef.current?.currentTime || 0;
            if (Math.abs(time - lastTime) >= 1 / album.visual.fps || lastTime < 0 || mediaRef.current?.paused && time !== lastTime) {
              if (scene) scene.draw(context, { currentTimeSeconds: time });
              else { context.clearRect(0, 0, 1920, 1080); drawSubtitles(context, track, { currentTimeSeconds: time }); }
              lastTime = time;
            }
            frame = requestAnimationFrame(draw);
          } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
        }; draw();
      } catch (e) { if (alive) { setLoading(false); setError(e instanceof Error ? e.message : String(e)); } }
    }; void run();
    return () => { alive = false; cancelAnimationFrame(frame); scene?.dispose(); };
  }, [track.id, track.title, track.artist, track.album, track.lyrics, track.lyricOffset, track.artworkKey, album.artworkKey, album.visual.fps, album.visual.flowSpeed, album.visual.fontScale, album.visual.vignette]);
  return <section className="preview-panel" aria-label="影片預覽"><div className="preview-label"><span>{track.kind === 'mv' ? 'MV SUBTITLE' : 'CD—BOOKLET / 02'}</span><span>1920 × 1080 · {album.visual.fps} FPS</span></div><div className="stage">
    {track.kind === 'mv' && <video ref={el => { video.current = el; mediaRef.current = el; }} src={url} onTimeUpdate={e => onTime(e.currentTarget.currentTime)} playsInline />}
    <canvas ref={canvas} width={1920} height={1080} aria-label={`${track.title} 同步歌詞預覽`} />
    {loading && <div className="stage-message">準備專輯背景…</div>}{error && <div className="stage-message error" role="alert">{error}</div>}
  </div>{track.kind === 'lyric' ? <audio ref={el => { mediaRef.current = el; }} src={url} controls onTimeUpdate={e => onTime(e.currentTarget.currentTime)} /> : <div className="mv-controls"><button onClick={() => { if (video.current?.paused) void video.current.play(); else video.current?.pause(); }}>播放 / 暫停</button><input aria-label="影片播放位置" type="range" min="0" max={track.duration || 1} step="0.05" onChange={e => { if (video.current) { video.current.currentTime = Number(e.target.value); onTime(Number(e.target.value)); } }} /></div>}
    <p className="caption">以播放時間計算完整畫面。點選歌詞時間即可定位。</p>
  </section>;
}
export function ThumbnailPreview({ track, album, onReshuffle }: { track: TrackProject; album: AlbumView; onReshuffle: () => void }) {
  const [url, setUrl] = useState<string>(), [error, setError] = useState('');
  useEffect(() => {
    let alive = true, created: string | undefined; setError(''); setUrl(undefined);
    const timer = setTimeout(() => { void makeThumbnail(track, album).then(blob => { if (alive) { created = URL.createObjectURL(blob); setUrl(created); } }).catch(e => { if (alive) setError(e.message); }); }, 500);
    return () => { alive = false; clearTimeout(timer); if (created) URL.revokeObjectURL(created); };
  }, [track.id, track.title, track.artist, track.album, track.thumbnailSeed, track.artworkKey, album.id, album.artworkKey, album.visual.flowSpeed, album.visual.vignette]);
  return <div className="thumbnail-section"><div className="section-label">DYNAMIC STILL <button onClick={onReshuffle}>重選背景</button></div>{url ? <><a href={url} target="_blank" rel="noreferrer" title="開啟完整 1280 × 720 縮圖"><img src={url} alt={`${track.title} 完整縮圖`} /></a><div className="feed-preview"><img src={url} alt="YouTube 小尺寸縮圖預覽"/><p>{track.title}<br/><small>{track.artist} · YouTube feed</small></p></div></> : <p className="caption">{error || '準備縮圖…'}</p>}</div>;
}
