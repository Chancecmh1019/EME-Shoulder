export function checkAbort(signal: AbortSignal) { if (signal.aborted) throw new DOMException('已取消', 'AbortError'); }
