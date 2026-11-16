import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
const App = location.pathname === '/studio-render' ? lazy(() => import('./components/StudioRender')) : location.pathname === '/dot-guide' ? lazy(() => import('./components/DotGuide')) : location.pathname === '/dot' ? lazy(() => import('./components/LocalDotControl')) : location.pathname === '/dot-cloud' ? lazy(() => import('./components/DotControl')) : location.pathname === '/studio-access' ? lazy(() => import('./components/StudioAccess')) : location.pathname === '/studio-verify' ? lazy(() => import('./components/PairReview')) : location.pathname === '/render-probe' ? lazy(() => import('./components/RenderProbe')) : lazy(() => import('./App'));

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <Suspense fallback={<p role="status">正在開啟製作工作區…</p>}><App /></Suspense>
  </React.StrictMode>
);
