export function youtubeId(value: string) {
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    const segments = url.pathname.split('/').filter(Boolean);
    let id: string | null = null;
    if (url.hostname === 'youtu.be' && segments.length === 1) id = segments[0];
    if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com'].includes(url.hostname)) {
      if (url.pathname === '/watch') id = url.searchParams.get('v');
      if (segments.length === 2 && ['shorts', 'embed', 'live'].includes(segments[0])) id = segments[1];
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function isHttpsMediaLink(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash && !youtubeId(value);
  } catch {
    return false;
  }
}
