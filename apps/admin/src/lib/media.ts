import { useEffect, useState } from 'react';
import { platform } from '../platform/index.ts';

/** A picture Core returns (`/v1/media/…`) as an <img> src: same origin on the web, Core's own
 *  address in the app. Absolute, blob: and data: URLs pass through. */
export const mediaUrl = (u: string) => platform.http.mediaUrl(u);

/** An /admin/v1 picture behind the session (a copilot photo): the URL itself on the web, where
 *  the cookie rides along; in the app it's fetched with the token and shown from memory. */
export function usePrivateMedia(path: string): string | undefined {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let live = true;
    let made: string | undefined;
    void platform.http.privateMedia(path).then(
      (u) => {
        if (u.startsWith('blob:')) made = u;
        if (live) setSrc(u);
        else if (made) URL.revokeObjectURL(made);
      },
      () => undefined,
    );
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [path]);
  return src;
}
