export type WakeState = 'idle' | 'requesting' | 'active' | 'unsupported' | 'hidden' | 'released' | 'denied';

// Browsers may revoke a screen lock, and mobile OS shutdown cannot be vetoed.
// Keep the protection scoped to production, never to ordinary browsing.
export class ProductionGuard {
  private lock?: WakeLockSentinel;
  private requesting = false;
  private disposed = false;
  constructor(private report: (state: WakeState) => void) {
    window.addEventListener('beforeunload', this.beforeUnload);
    window.addEventListener('keydown', this.keydown, true);
    document.addEventListener('visibilitychange', this.visibility);
    void this.request();
  }
  private beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
  private keydown = (event: KeyboardEvent) => {
    if (event.key === 'F5' || (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r') event.preventDefault();
  };
  private visibility = () => { if (document.visibilityState === 'visible') void this.request(); else this.report('hidden'); };
  request = async () => {
    if (this.disposed || this.requesting) return;
    if (document.visibilityState !== 'visible') { this.report('hidden'); return; }
    if (this.lock && !this.lock.released) { this.report('active'); return; }
    if (!navigator.wakeLock?.request) { this.report('unsupported'); return; }
    this.requesting = true; this.report('requesting');
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (this.disposed || document.visibilityState !== 'visible') { await lock.release(); return; }
      this.lock = lock;
      lock.addEventListener('release', () => {
        if (this.lock !== lock) return;
        this.lock = undefined;
        if (!this.disposed) this.report(document.visibilityState === 'visible' ? 'released' : 'hidden');
      }, { once: true });
      this.report('active');
    } catch { if (!this.disposed) this.report('denied'); }
    finally { this.requesting = false; }
  };
  dispose() {
    this.disposed = true;
    window.removeEventListener('beforeunload', this.beforeUnload);
    window.removeEventListener('keydown', this.keydown, true);
    document.removeEventListener('visibilitychange', this.visibility);
    void this.lock?.release().catch(() => {}); this.lock = undefined;
  }
}
