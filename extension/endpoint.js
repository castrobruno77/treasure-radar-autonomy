export function normalizeEndpoint(value) {
  const url = new URL(value.trim());
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')) throw new Error('HTTPS_REQUIRED');
  if (url.username || url.password || (url.pathname !== '/' && url.pathname !== '')) throw new Error('ORIGIN_REQUIRED');
  return url.origin;
}
