// The admin's routes live under /admin/ on the web and at / in the app (vite `base`).

export const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

/** `/entrar` → `/admin/entrar` on the web, `/entrar` in the app: for a full page load */
export const appPath = (route: string) => `${BASE}${route}`;

/** `/admin/pedidos/1` (a push's url, a link into the app) → `/pedidos/1`, the router's path */
export const routeOf = (url: string) => url.replace(/^\/admin(?=[/?#]|$)/, '') || '/';
