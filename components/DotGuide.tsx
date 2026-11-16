import React from 'react';
import { dotFirstRunInstructions } from '../studio/dotWorkflow';
import './dot.css';
import '../index.css';
export default function DotGuide() {
  const instructions = dotFirstRunInstructions(location.origin);
  const [copied, setCopied] = React.useState(false);
  return <main className="dot-control"><header><a href="/dot">← Dot 暫存工作台</a><a href="/dot-cloud">選用雲端模式</a></header>
    <h1>Dot 首次操作</h1><aside>整體 No-Go。這是操作合約，不代表外部工具、雲端交接、渲染或上傳已在你的 Dot 環境驗證。正式製作前逐項確認可用能力。</aside>
    <section><h2>在對的地方執行</h2><table><thead><tr><th>操作</th><th>執行位置</th><th>通過證據</th></tr></thead><tbody>
      <tr><td>取得音源</td><td>Dot 終端或獨立 Mornye worker</td><td>完整檔案、來源、時長、雜湊</td></tr>
      <tr><td>素材交接與核對</td><td>Dot 電腦檔案與 EME 本機工作台，不需要 S3</td><td>完整解碼、首末句、可追溯 offset</td></tr>
      <tr><td>翻譯</td><td>Dot 讀取 EME 當次完整指令</td><td>逐行檢查及保存後讀回</td></tr>
      <tr><td>渲染</td><td>/studio-render 原引擎／專用 browser worker</td><td>影片、縮圖及實際產物雜湊；全流程待實測</td></tr>
      <tr><td>Private 上傳</td><td>擁有者授權的原生 private-publish worker</td><td>Google 回讀 Private／processed／succeeded；尚未真實驗收</td></tr>
    </tbody></table></section>
    <section><h2>可複製的完整啟動指令</h2><button onClick={async () => { await navigator.clipboard.writeText(instructions); setCopied(true); }}>複製 Dot 首次指令</button>{copied && <p role="status">已複製，請先填入實際任務及核准的環境。</p>}<pre aria-label="Dot 首次使用完整指令">{instructions}</pre></section>
    <section><h2>中斷後如何接續</h2><p>重新登入後先讀工作清單、歌曲狀態與不可變更歷程。沿用原任務與收據；有檔案時先驗雜湊，不重新下載。只有版本或素材變更才重做相應核對。不要把無更新的畫面當成執行中，也不要推測進度百分比。</p></section>
  </main>;
}
