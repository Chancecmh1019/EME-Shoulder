import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
// Execute the same server-only handlers locally; never serve their TS as JS.
function localApi(): Plugin {
  return { name: 'eme-local-api', configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url || '/', 'http://localhost');
      if (!url.pathname.startsWith('/api/')) return next();
      const json = (status: number, data: unknown) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(data)); };
      if (!['/api/auth', '/api/youtube'].includes(url.pathname)) return json(404, { error: 'API endpoint not found' });
      try {
        let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 65536) return json(413, { error: 'Request too large' }); }
        Object.assign(req, { query: Object.fromEntries(url.searchParams), body: body ? JSON.parse(body) : undefined });
        const response = Object.assign(res, { status(code: number) { res.statusCode = code; return response; }, json(data: unknown) { json(res.statusCode, data); }, redirect(code: number, target: string) { res.statusCode = code; res.setHeader('Location', target); res.end(); } });
        const module = await server.ssrLoadModule(`${url.pathname}.ts`); await module.default(req, response);
      } catch (e) { if (!res.writableEnded) json(500, { error: e instanceof Error ? e.message : 'API request failed' }); }
    });
  } };
}
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  for (const name of ['APP_ORIGIN', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SESSION_SECRET', 'OWNER_EMAIL']) if (env[name]) process.env[name] = env[name];
  return { plugins: [localApi(), react()], server: { port: 3000, host: '127.0.0.1' }, build: { target: 'es2022' }, optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] } };
});
