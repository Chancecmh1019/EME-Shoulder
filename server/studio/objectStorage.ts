import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { cloudConfig } from './config.ts';
import { StudioError } from '../../studio/lrc.ts';
import { digest } from './sessions.ts';

export interface PrivateObjects {
  put(key: string, bytes: Uint8Array, mime: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
}
export function assetKey(owner: string, jobId: string, kind: string, hash: string) {
  if (!/^[a-f0-9-]{36}$/.test(jobId) || !/^(audio|artwork|source_lrc|output)$/.test(kind) || !/^[a-f0-9]{64}$/.test(hash)) throw new StudioError('INVALID_ASSET_KEY');
  return `${digest(owner)}/${jobId}/${kind}/${hash}`;
}
/** S3 secrets remain in this server module; no signed privileged URLs reach Dot. */
export class SupabasePrivateObjects implements PrivateObjects {
  private client: S3Client;
  private bucket: string;
  constructor(private config = cloudConfig(), private request: typeof fetch = fetch) {
    const endpoint = new URL(process.env.S3_ENDPOINT ?? '');
    const project = new URL(config.supabase).hostname.split('.')[0];
    if (endpoint.protocol !== 'https:' || ![`${project}.supabase.co`, `${project}.storage.supabase.co`].includes(endpoint.hostname) || endpoint.pathname !== '/storage/v1/s3' || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) throw new StudioError('INVALID_S3_ENDPOINT', 503);
    const accessKeyId = process.env.S3_ACCESS_KEY_ID, secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
    this.bucket = process.env.S3_BUCKET ?? '';
    if (!accessKeyId || !secretAccessKey || !process.env.S3_REGION || !/^[a-z0-9][a-z0-9-]{2,62}$/.test(this.bucket) || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new StudioError('STORAGE_NOT_CONFIGURED', 503);
    this.client = new S3Client({ endpoint: endpoint.href, region: process.env.S3_REGION, credentials: { accessKeyId, secretAccessKey }, forcePathStyle: true, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED', maxAttempts: 2 });
  }
  private async privacy() {
    const response = await this.request(`${this.config.supabase}/storage/v1/bucket/${encodeURIComponent(this.bucket)}`, { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}` }, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok || (await response.json()).public !== false) throw new StudioError('BUCKET_NOT_PRIVATE', 503, '儲存桶未確認為私人，拒絕寫入或讀取。');
  }
  private check(key: string) { if (!/^[a-f0-9]{64}\/[a-f0-9-]{36}\/(audio|artwork|source_lrc|output)\/[a-f0-9]{64}$/.test(key)) throw new StudioError('INVALID_ASSET_KEY'); }
  async put(key: string, bytes: Uint8Array, mime: string) {
    this.check(key); await this.privacy();
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: mime, CacheControl: 'private, no-store' }), { abortSignal: AbortSignal.timeout(20000) });
    const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }), { abortSignal: AbortSignal.timeout(10000) });
    if (head.ContentLength !== bytes.length) throw new StudioError('ASSET_SIZE_MISMATCH', 502);
  }
  async get(key: string) {
    this.check(key); await this.privacy();
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }), { abortSignal: AbortSignal.timeout(20000) });
    if (!response.Body || (response.ContentLength ?? Infinity) > 3 * 1024 * 1024) throw new StudioError('ASSET_TOO_LARGE', 413);
    const bytes = await response.Body.transformToByteArray();
    if (bytes.length > 3 * 1024 * 1024) throw new StudioError('ASSET_TOO_LARGE', 413);
    return bytes;
  }
}
