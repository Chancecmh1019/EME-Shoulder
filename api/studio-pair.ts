import { cloudRuntime } from '../server/studio/runtime.ts';
import { PairWorkflow } from '../server/studio/pairWorkflow.ts';
import { StudioError } from '../studio/lrc.ts';
export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { config, db, sessions, repository } = cloudRuntime(), p = await sessions.authenticate(req), workflow = new PairWorkflow(db);
    if (p.role !== 'owner') throw new StudioError('SCOPE_DENIED', 403);
    const id = req.query.id;
    if (typeof id !== 'string' || id.length > 100) throw new StudioError('INVALID_TRACK');
    if (req.method === 'GET' && req.query.action === 'status') return res.json(await workflow.status(p, id));
    if (req.method !== 'POST' || req.headers.origin !== config.origin || req.headers['x-eme-request'] !== '1' || String(req.headers['content-type']).split(';')[0] !== 'application/json') throw new StudioError('ORIGIN_REJECTED', 403);
    if (Buffer.byteLength(JSON.stringify(req.body ?? {})) > 200000) throw new StudioError('REQUEST_TOO_LARGE', 413);
    await repository.rateLimit(p.owner);
    if (req.query.action === 'audio') return res.json(await workflow.selectAudio(p, id, req.body?.audioId));
    if (req.query.action === 'verify') return res.json(await workflow.verify(p, id, req.body?.sourceRevision, req.body?.audioId, req.body?.evidence));
    if (req.query.action === 'repair') return res.json(await workflow.repair(p, id, req.body?.sourceRevision, req.body?.mode));
    throw new StudioError('NOT_FOUND', 404);
  } catch (e) { return res.status(e instanceof StudioError ? e.status : 503).json({ code: e instanceof StudioError ? e.code : 'PAIR_SERVICE_UNAVAILABLE', error: e instanceof StudioError ? e.message : '音訊歌詞對照服務不可用；翻譯仍被阻擋。' }); }
}
