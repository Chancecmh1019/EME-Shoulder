import { MeshGradientRenderer } from '@applemusic-like-lyrics/core';
// Version-locked boundary adapter. AMLL 0.6.0 owns shaders, texture processing,
// mesh and GL resources; this adapter owns time and deterministic control points.
interface MeshInternals {
  requestTick: () => void; disconnectResizeObserver: () => void;
  onResize: (w: number, h: number) => void; onRedraw: (time: number, delta: number) => boolean;
  meshStates: { alpha: number }[]; contextLost: boolean;
}
export class AlbumBackground {
  readonly canvas = document.createElement('canvas');
  private renderer: MeshGradientRenderer;
  private internal: MeshInternals;
  constructor() {
    this.canvas.width = 960; this.canvas.height = 540;
    this.renderer = new MeshGradientRenderer(this.canvas);
    this.renderer.pause();
    this.internal = this.renderer as unknown as MeshInternals;
    if (typeof this.internal.onRedraw !== 'function' || !Array.isArray(this.internal.meshStates)) { this.renderer.dispose(); throw new Error('AMLL adapter version mismatch'); }
    this.internal.requestTick = () => {}; this.internal.disconnectResizeObserver();
    this.renderer.setManualControl(true); this.renderer.setLowFreqVolume(0);
    this.internal.onResize(960, 540);
  }
  async setArtwork(image: HTMLImageElement) {
    await this.renderer.setAlbum(image);
    this.renderer.pause(); this.renderer.resizeControlPoints(4, 4); this.renderer.resetSubdivition(24);
    if (!this.internal.meshStates.length) throw new Error('專輯背景載入失敗');
    this.internal.meshStates.forEach(s => { s.alpha = 1.1; });
  }
  draw(time: number, flowSpeed: number) {
    if (this.internal.contextLost) throw new Error('WebGL context lost. 請重新開啟預覽或重試渲染。');
    const phase = time * flowSpeed * 0.18;
    for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) {
      const p = this.renderer.getControlPoint(x, y); if (!p) continue;
      const edge = x === 0 || x === 3 || y === 0 || y === 3;
      p.location.x = x / 3 * 2 - 1 + (edge ? 0 : Math.sin(phase + x * 1.7 + y) * 0.16);
      p.location.y = y / 3 * 2 - 1 + (edge ? 0 : Math.cos(phase * 0.8 + y * 1.4 + x) * 0.16);
      p.uRot = 0; p.vRot = Math.PI / 2; p.uScale = 2 / 3; p.vScale = 2 / 3;
    }
    this.internal.meshStates.forEach(s => { s.alpha = 1.1; });
    this.internal.onRedraw(time * 1000 * flowSpeed, 0);
    return this.canvas;
  }
  dispose() { this.renderer.dispose(); this.canvas.getContext('webgl')?.getExtension('WEBGL_lose_context')?.loseContext(); this.canvas.width = 1; this.canvas.height = 1; }
}
