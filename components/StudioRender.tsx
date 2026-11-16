import React, { useRef, useState } from 'react';
import { runStudioRender } from '../services/studioRender';
import type { RenderRequest } from '../studio/renderContract';
import '../index.css';
import './dot.css';
export default function StudioRender() {
  const [request, setRequest] = useState<RenderRequest>(), [audio, setAudio] = useState<File>(), [artwork, setArtwork] = useState<File>();
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(0), [error, setError] = useState(''), [result, setResult] = useState<any>();
  const controller = useRef<AbortController | null>(null), urls = useRef<string[]>([]);
  React.useEffect(() => () => { controller.current?.abort(); urls.current.forEach(url => URL.revokeObjectURL(url)); }, []);
  return <main className="dot-control"><a href="/dot">返回 Dot 工作台</a><h1>專用渲染工作入口</h1><aside>使用原 CD-Booklet 引擎輸出完整影片與縮圖。此電腦的瀏覽器是執行器；不在 Vercel handler 渲染。產物必須另行保存與驗收，本頁不提供 YouTube 上傳。</aside>
    <label htmlFor="render-request">已接受翻譯的 render-request.json</label><input id="render-request" type="file" accept=".json" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) void file.text().then(text => { if (file.size > 2000000) throw new Error('套件過大'); setRequest(JSON.parse(text)); }).catch(e => setError(String(e))); }}/>
    <label htmlFor="render-audio">與套件雜湊一致的 render-audio.wav</label><input id="render-audio" type="file" accept=".wav" disabled={busy} onChange={e => setAudio(e.target.files?.[0])}/>
    <label htmlFor="render-artwork">與套件雜湊一致的原專輯封面</label><input id="render-artwork" type="file" accept="image/jpeg,image/png" disabled={busy} onChange={e => setArtwork(e.target.files?.[0])}/>
    <button disabled={busy || !request || !audio || !artwork} onClick={async () => { if (!request || !audio || !artwork) return; setBusy(true); setError(''); controller.current = new AbortController(); try { const output = await runStudioRender(request, audio, artwork, setProgress, controller.current.signal); urls.current.forEach(url => URL.revokeObjectURL(url)); const video = URL.createObjectURL(output.video), thumbnail = URL.createObjectURL(output.thumbnail), report = URL.createObjectURL(new Blob([JSON.stringify(output.report, null, 2)], { type: 'application/json' })); urls.current = [video, thumbnail, report]; setResult({ video, thumbnail, report, data: output.report }); } catch (e) { setError(String(e)); } finally { setBusy(false); } }}>檢查素材並產生完整影片與縮圖</button>
    {busy && <><progress aria-label="實際渲染進度" max={100} value={progress}/><p role="status">已渲染 {progress.toFixed(1)}%；請保持執行器運作。</p><button onClick={() => controller.current?.abort()}>取消本次渲染</button></>}{error && <p role="alert">{error}</p>}
    {result && <section><h2>已在此電腦產生，尚未交付雲端</h2><video controls src={result.video} style={{ width: '100%' }}/><img src={result.thumbnail} alt="實際產生的 CD-Booklet 縮圖" style={{ width: '100%' }}/><a href={result.video} download="video.mp4">保存完整影片</a> · <a href={result.thumbnail} download="thumbnail.jpg">保存縮圖</a> · <a href={result.report} download="render-result.json">保存產物證據</a><pre>{JSON.stringify(result.data, null, 2)}</pre></section>}
  </main>;
}
