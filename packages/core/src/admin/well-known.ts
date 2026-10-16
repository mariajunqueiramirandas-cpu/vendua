import type { Hono } from 'hono';
import { HttpError } from '../platform/http.ts';

// Universal Links (iOS) and App Links (Android) for painel.vendua.com.br/admin/* (ADR 0044 §6):
// on a phone with the app, an /admin/… link (a push's url, the e-mail sign-in link, a team invite,
// the print pairing QR, Mercado Pago's way back) opens the app on that route. The admin's nginx
// proxies /.well-known/ here. Off until the app's identity is configured:
//   VENDUA_IOS_APP_IDS         — `<TEAMID>.br.com.vendua.painel`, comma-separated
//   VENDUA_ANDROID_CERT_SHA256 — the Play signing key's SHA-256 fingerprint(s), comma-separated

export const ANDROID_PACKAGE = 'br.com.vendua.painel';

const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** Paths the app never takes: the API, the bundle, and the website-only flows (signup and the
 *  plan's payment, ADR 0044 decision 1). Order matters: the first match wins. */
const EXCLUDED = ['/admin/v1/*', '/admin/app/*', '/admin/comecar*'];

export function appleAppSiteAssociation(appIds: string[]) {
  return {
    applinks: {
      details: [
        {
          appIDs: appIds,
          components: [
            ...EXCLUDED.map((p) => ({ '/': p, exclude: true })),
            // the card authorization's way back belongs to the website's signup and Conta
            { '?': { assinatura: '*' }, exclude: true },
            { '/': '/admin', comment: 'the admin' },
            { '/': '/admin/*', comment: 'any admin screen' },
          ],
        },
      ],
    },
  };
}

export function assetLinks(fingerprints: string[]) {
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: ANDROID_PACKAGE,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];
}

export function mountWellKnown(app: Hono<any>) {
  app.get('/.well-known/apple-app-site-association', (c) => {
    const ids = list(process.env.VENDUA_IOS_APP_IDS);
    if (!ids.length) throw new HttpError(404, 'NOT_FOUND', 'not found');
    // Apple's CDN fetches it: JSON with no extension, no redirect
    c.header('cache-control', 'public, max-age=3600');
    return c.json(appleAppSiteAssociation(ids));
  });
  app.get('/.well-known/assetlinks.json', (c) => {
    const prints = list(process.env.VENDUA_ANDROID_CERT_SHA256);
    if (!prints.length) throw new HttpError(404, 'NOT_FOUND', 'not found');
    c.header('cache-control', 'public, max-age=3600');
    return c.json(assetLinks(prints));
  });
}
