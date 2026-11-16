import { StudioError } from '../../studio/lrc.ts';

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new StudioError('STAGING_NOT_CONFIGURED', 503, '請先完成擁有者首次設定。');
  return value;
}
export function cloudConfig() {
  if (process.env.EME_DEPLOYMENT !== 'staging' || process.env.VERCEL_ENV === 'production') throw new StudioError('STAGING_ONLY', 503, '此版本僅允許隔離的 Staging／Preview。');
  const origin = new URL(required('STUDIO_ORIGIN'));
  if (origin.origin !== required('STUDIO_ORIGIN') || (origin.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(origin.hostname)))) throw new StudioError('INVALID_STUDIO_ORIGIN', 503);
  const supabase = new URL(required('SUPABASE_URL'));
  if (supabase.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(supabase.hostname) || supabase.pathname !== '/' || supabase.username || supabase.password || supabase.search || supabase.hash) throw new StudioError('INVALID_SUPABASE_ORIGIN', 503);
  return { origin: origin.origin, supabase: supabase.origin, authKey: required('SUPABASE_PUBLISHABLE_KEY'), owner: required('STUDIO_OWNER_EMAIL').toLowerCase(), databaseUrl: required('DATABASE_URL') };
}
