import React, { useEffect, useState } from 'react';
import { acceptExternalTranslation, validateExternalPackage, type ExternalPackage } from '../studio/externalPackage';
import { parseDotTranslation } from '../studio/translationInput';
import { sha256Bytes, type RenderRequest } from '../studio/renderContract';
import { getMedia, putMedia, deleteMedia } from '../services/storage';
import '../index.css';
import './dot.css';
const ACTIVE = 'eme-dot-temporary-job-v1';
const saved = () => { try { return JSON.parse(localStorage.getItem(ACTIVE) ?? 'null'); } catch { return null; } };
function exportFile(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([typeof value === 'string' ? value : JSON.stringify(value, null, 2)], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export default function LocalDotControl() {
  const [pkg, setPackage] = useState<ExternalPackage | undefined>(() => saved()?.pkg), [bulk, setBulk] = useState(() => saved()?.bulk ?? ''), [accepted, setAccepted] = useState<any>(() => saved()?.accepted);
  const [audioReady, setAudioReady] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [audioUrl, setAudioUrl] = useState('');
  const [rendered, setRendered] = useState<any>(() => saved()?.rendered), [published, setPublished] = useState<any>(() => saved()?.published);
  async function run(work: () => Promise<void>) { setBusy(true); setMessage(''); try { await work(); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } }
  useEffect(() => { if (pkg) localStorage.setItem(ACTIVE, JSON.stringify({ pkg, bulk, accepted, rendered, published, updatedAt: new Date().toISOString() })); }, [pkg, bulk, accepted, rendered, published]);
  useEffect(() => {
    let active = true, url = '';
    setAudioReady(false); setAudioUrl('');
    if (pkg) void validateExternalPackage(pkg).then(async () => {
      const audio = await getMedia(`dot-local/${pkg.jobId}/audio`);
      if (!audio || !active) return;
      const hash = await sha256Bytes(await audio.arrayBuffer());
      if (![pkg.audioSha256, pkg.renderAudioSha256].includes(hash)) throw new Error('已暫存音檔的雜湊不符，請重新選取。');
      if (active) { url = URL.createObjectURL(audio); setAudioUrl(url); setAudioReady(true); }
    }).catch(error => { if (active) setMessage(String(error)); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [pkg]);
  return <main className="dot-control" aria-busy={busy}><header><a href="/">EME Studio 2.0</a><a href="/dot-guide">Dot 首次操作指令</a></header><h1>Dot 製作工作台</h1>
    <aside>預設為 Dot 電腦執行與暫存模式，不需要 Supabase、PostgreSQL 或 S3。素材留在此電腦，失敗時保留供續做；確認 YouTube Private 處理成功後才清除。完整 Dot → YouTube 驗收仍為 No-Go。</aside>
    <p>下載、語音核對與上傳由 Dot 的終端或獨立 worker 執行；網頁負責完整翻譯指令、結構檢查、原引擎渲染與進度。<a href="/dot-cloud">選用：雲端持久化模式</a></p><p role="status">{message}</p>
    <section><h2>1 / 接續已核對的歌曲</h2><label htmlFor="local-package">外部工具產生的 dot-local-package.json</label><input id="local-package" type="file" accept=".json" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) void run(async () => { if (file.size > 2000000) throw new Error('套件超過 2 MB'); const next = await validateExternalPackage(JSON.parse(await file.text())); if (pkg && pkg.jobId !== next.jobId) throw new Error('此電腦尚有未結案任務；請先完成或另用獨立瀏覽器工作階段，避免覆蓋。'); setPackage(next); setMessage('完整提示詞、來源版本及首末句核對資料已檢查；請選取實際音檔。'); }); }}/>
      {pkg && <><p>{pkg.artist} — {pkg.title}・{pkg.duration} 秒・工作 {pkg.jobId}</p><p>核對範圍：首句／末句。中間 {pkg.verification.interiorWeakLines.length} 行保留辨識不確定警示。</p><label htmlFor="local-audio">本機完整音檔或對應的 render-audio.wav（只讀取到此瀏覽器，不上傳網站伺服器）</label><input id="local-audio" type="file" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) void run(async () => { if (file.size > 1024 ** 3) throw new Error('音檔超過 1 GiB'); const hash = await sha256Bytes(await file.arrayBuffer()); if (![pkg.audioSha256, pkg.renderAudioSha256].includes(hash)) throw new Error('不是套件核對過的音檔，禁止翻譯。'); await putMedia(`dot-local/${pkg.jobId}/audio`, file); if (audioUrl) URL.revokeObjectURL(audioUrl); setAudioUrl(URL.createObjectURL(file)); setAudioReady(true); setMessage('實際音檔雜湊相符，已在此電腦暫存。'); }); }}/>{audioUrl && <audio controls src={audioUrl}/>}</>}
    </section>
    {pkg && <><section><h2>可視化進度</h2><ol className="workflow-stages">{[
      ['完整音源', audioReady ? '實際檔案雜湊相符' : '等待實際檔案'], ['原文與首末句', '外部核對已通過；中間行仍需留意'], ['翻譯', accepted ? '結構檢查通過，已在此電腦暫存' : audioReady ? '等待 Dot 依完整指令翻譯' : '等待音檔'], ['影片與縮圖', rendered ? '外部產物回報已讀取；上傳 worker 仍須核對檔案' : '尚未完成'], ['YouTube Private', published ? '回報 Private 且處理成功' : '尚未完成；需要擁有者授權'], ['清理', '上傳成功前保留暫存'],
    ].map(([label, status]) => <li key={label}><strong>{label}</strong><small>{status}</small></li>)}</ol><p>重新整理後會讀回此電腦的暫存；不同電腦不會自動同步。Dot 電腦若不保留磁碟，必須先匯出工作套件或改交獨立 worker。</p></section>
    <section><h2>2 / 一字不漏的 EME 翻譯指令</h2><p>完整指令 SHA-256：{pkg.promptHash}</p><details open><summary>本次完整原始指令</summary><pre>{pkg.exactLrcPrompt}</pre></details><details><summary>一次讀取全部原文、時間與行 ID</summary><pre aria-label="完整原文套件">{JSON.stringify(pkg, null, 2)}</pre></details>
      <label htmlFor="local-translations">一次貼入依原始提示詞輸出的完整雙語 LRC（亦接受 id／translation JSON）</label><textarea id="local-translations" disabled={!audioReady || busy} value={bulk} maxLength={200000} onChange={e => setBulk(e.target.value)}/>
      <button disabled={!audioReady || busy} onClick={() => void run(async () => { const translations = parseDotTranslation(bulk, pkg.lines); const input = { sourceRevision: pkg.sourceRevision, sourceHash: pkg.sourceHash, promptHash: pkg.promptHash, lines: pkg.lines.map(line => ({ ...line, translation: translations[line.id] })) }; const result = await acceptExternalTranslation(pkg, input); const correctedInput = { ...input, lines: result.lines }; setAccepted({ input: correctedInput, result }); exportFile('translation-input.json', correctedInput); setMessage('已通過原網站繁體與格式校正、原文及時間檢查，並匯出給 worker；仍需語意複核。'); })}>驗證全部譯文並匯出交接檔</button>
      {accepted && <><button onClick={() => exportFile('translation-input.json', accepted.input)}>重新匯出已保存譯文</button><button onClick={() => exportFile('translation.lrc', accepted.result.bilingualLrc)}>匯出雙語 LRC</button><pre>{JSON.stringify({ state: accepted.result.state, warnings: accepted.result.warnings }, null, 2)}</pre></>}
    </section>
    <section><h2>3 / 原 CD-Booklet 渲染與交付</h2><p>外部 worker 接受 translation-input.json 後，使用 package-render-file 命令建立具雜湊的渲染套件。</p><a href="/studio-render">開啟完整影片與縮圖渲染入口</a><label htmlFor="local-render-result">讀取實際產物 render-result.json</label><input id="local-render-result" type="file" accept=".json" onChange={e => { const file = e.target.files?.[0]; if (file) void run(async () => { const result = JSON.parse(await file.text()); if (!accepted || result.schema !== 'eme.render-result.v1' || result.jobId !== pkg.jobId || result.sourceHash !== pkg.sourceHash || result.promptHash !== pkg.promptHash) throw new Error('產物不是目前任務或版本。'); setRendered(result); }); }}/>
      <label htmlFor="local-upload-result">讀取上傳 worker 驗證的 youtube-private-result.json</label><input id="local-upload-result" type="file" accept=".json" onChange={e => { const file = e.target.files?.[0]; if (file) void run(async () => { const result = JSON.parse(await file.text()); if (!rendered || result.schema !== 'eme.youtube-private-result.v1' || result.jobId !== pkg.jobId || result.videoSha256 !== rendered.videoSha256 || result.privacyStatus !== 'private' || result.processingStatus !== 'succeeded' || result.uploadStatus !== 'processed') throw new Error('沒有此任務已處理完成的 Private 上傳確認，禁止清理。'); setPublished(result); }); }}/>
      <button disabled={!published || busy} onClick={() => void run(async () => { await deleteMedia(`dot-local/${pkg.jobId}/audio`); localStorage.removeItem(ACTIVE); setPackage(undefined); setAccepted(undefined); setRendered(undefined); setPublished(undefined); setBulk(''); setMessage('此瀏覽器的本次任務暫存已清除。外部 worker 檔案須由它在 YouTube 確認成功後清理；未動其他舊版專案。'); })}>Private 已完成，清除此瀏覽器暫存</button>
    </section></>}
  </main>;
}
