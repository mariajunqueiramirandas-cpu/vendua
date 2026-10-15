import { useEffect } from 'react';

/**
 * A link to one part of a screen (/loja/horarios#mensagens) lands on it once the screen has
 * filled in: `ready` turns true when the part can be on the page.
 */
export function useLandOnHash(ready: boolean) {
  useEffect(() => {
    const id = location.hash.slice(1);
    if (ready && id) document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, [ready]);
}
