import React, { useEffect, useRef, useState } from 'react';
import { renderCapabilities, runSyntheticRender } from '../services/renderProbe';
import '../index.css';
import './dot.css';

export default function RenderProbe() {
  const [report, setReport] = useState<unknown>(), [progress, setProgress] = useState(0), [error, setError] = useState(''), [busy, setBusy] = useState(false), [url, setUrl] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); }, []);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  async function run(seconds?: 30 | 180) {
    setBusy(true); setError(''); controller.current = new AbortController();
    try {
      if (seconds) { const output = await runSyntheticRender(seconds, setProgress, controller.current.signal); setReport(output.report); setUrl(URL.createObjectURL(output.blob)); }
      else setReport(await renderCapabilities());
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <main className="dot-control"><a href="/dot">返回 Dot Control</a><h1>渲染環境探針</h1><aside>只使用程式產生的 440 Hz 音訊與測試文字，沿用原本 CD-Booklet 引擎。測試結果僅代表目前瀏覽器；不能當成 Dot 雲端驗證。</aside><button disabled={busy} onClick={() => void run()}>檢查 WebGL、H.264、AAC 與儲存</button><button disabled={busy} onClick={() => void run(30)}>產生 30 秒測試影片</button><button disabled={busy} onClick={() => void run(180)}>產生 180 秒合成長片測試</button>{busy && <><progress aria-label="渲染進度" max={100} value={progress}/><button onClick={() => controller.current?.abort()}>取消測試</button></>}{error && <p role="alert">{error}</p>}<pre aria-label="渲染能力報告">{JSON.stringify(report ?? {}, null, 2)}</pre>{url && <><video controls src={url} style={{ width: '100%' }}/><a href={url} download="eme-synthetic-probe.mp4">下載測試 MP4</a></>}</main>;
}
