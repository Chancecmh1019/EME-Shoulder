import React, { useEffect, useRef, useState } from 'react';
import { ProductionGuard, type WakeState } from '../services/productionGuard';

const labels: Record<WakeState, string> = {
  idle: '準備工作保護', requesting: '正在保持螢幕喚醒…', active: '螢幕保持喚醒中',
  unsupported: '此瀏覽器無法保持螢幕喚醒', hidden: '頁面已離開前景，喚醒保護可能已解除',
  released: '系統已解除螢幕喚醒', denied: '系統未允許保持螢幕喚醒',
};
export function ProductionProtection({ engaged, paused, resume, report }: {
  engaged: boolean; paused: boolean; resume: () => Promise<void>; report: (message: string) => void;
}) {
  const guard = useRef<ProductionGuard | null>(null);
  const [state, setState] = useState<WakeState>('idle');
  useEffect(() => {
    if (!engaged) { setState('idle'); return; }
    const current = new ProductionGuard(setState); guard.current = current;
    return () => { current.dispose(); guard.current = null; };
  }, [engaged]);
  if (!engaged && !paused) return null;
  return <aside className="production-protection" aria-label="製作工作保護">
    <div><strong>{paused ? '工作已保留，佇列暫停中' : '渲染／上傳工作進行中'}</strong>
      <p>{paused ? '偵測到上次未完成的工作。恢復後依原順序處理；中斷的渲染會重新開始，上傳會先確認續傳進度。' : '請讓這個頁面保持在前景，勿重整、關閉或手動鎖屏。網站內切換工作區不影響排程。'}</p>
      {engaged && <small role="status">{labels[state]}。瀏覽器無法阻止電源鍵鎖屏或系統強制關閉。</small>}
    </div><div className="protection-actions">
      {paused && <button className="primary" onClick={() => { void resume().catch(e => report(e.message)); }}>恢復佇列</button>}
      {engaged && state !== 'active' && state !== 'requesting' && <button onClick={() => { void guard.current?.request(); }}>重試保持螢幕喚醒</button>}
      <a className="button" href="#/queue">查看佇列</a>
    </div>
  </aside>;
}
