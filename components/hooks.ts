import { useEffect, useState } from 'react';
import { getMedia } from '../services/storage';
export function useMediaUrl(key?: string) {
  const [url, setUrl] = useState<string>();
  useEffect(() => { let alive = true, created: string | undefined; setUrl(undefined); if (key) void getMedia(key).then(blob => { if (alive && blob) { created = URL.createObjectURL(blob); setUrl(created); } }); return () => { alive = false; if (created) URL.revokeObjectURL(created); }; }, [key]);
  return url;
}
