// A photo shared into the app from the gallery (manifest share_target): the service
// worker parks it in a cache, "novo produto" picks it up once.
export async function takeSharedPhoto(): Promise<File | null> {
  try {
    const c = await caches.open('vendua-admin-share');
    const res = await c.match('/admin/__share/photo');
    if (!res) return null;
    await c.delete('/admin/__share/photo');
    const blob = await res.blob();
    const name = decodeURIComponent(res.headers.get('x-name') ?? 'foto');
    return new File([blob], name, { type: blob.type });
  } catch {
    return null;
  }
}
