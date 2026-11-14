'use client';

import { useEffect, useState } from 'react';
import type { Media, Settings } from '@/lib/model';
import { request } from '@/lib/repository';

export function useEditPreview(media: Media | undefined, profile: Settings['performanceProfile'], online: boolean) {
  const id = media?.id;
  const [preview, setPreview] = useState<Media>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!online || !id || !media?.url.startsWith('/api/media/')) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function check(first: boolean) {
      try {
        const result = await request<Media>(first ? `/api/media/${id}/preview${retry ? '?retry=true' : ''}` : `/api/media/${id}/metadata`, {
          method: first ? 'POST' : 'GET', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(6000)]),
        });
        if (controller.signal.aborted) return;
        setPreview(result);
        if (result.previewStatus === 'queued' || result.previewStatus === 'running') timer = setTimeout(() => void check(false), 1200);
      } catch {
        if (!controller.signal.aborted) setPreview(undefined);
      }
    }
    void check(true);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [id, media?.url, online, profile, retry]);
  return { media: media && preview?.id === media.id ? preview : media, retry: () => setRetry(value => value + 1) };
}
