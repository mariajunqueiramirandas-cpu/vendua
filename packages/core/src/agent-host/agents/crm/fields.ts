import { s } from '@vendua/agent-runtime';

// The lead fields an agent may write, as the old registry described them to the model.

const text = (max = 200) => s.string({ max }).optional();

export const LEAD_FIELDS = {
  businessName: text(),
  phone: text(40),
  whatsapp: text(60),
  email: text(200),
  instagram: text(200),
  website: text(500),
  city: text(120),
  segment: text(80),
  source: text(120),
  tags: s.array(s.string({ max: 60 }), { max: 20 }).optional(),
  dealValueCents: s.int({ min: 0, max: 100_000_000 }).optional(),
  nextActionAt: s.string({ max: 40 }).describe('ISO-8601').optional(),
  fitScore: s
    .int({ min: 0, max: 10 })
    .describe(
      '0–10 ICP fit + active operation: 0–3 off-ICP/closed/inactive; 4–5 plausible food shop with gaps or unconfirmed activity; 6 confirmed active food shop without a clear ordering gap yet; 7–8 confirmed active food shop with a concrete workflow fit (WhatsApp/DM orders, PDF/image menu, iFood dependency, no own link); 9–10 strong evidence of fit, activity and clear utility',
    )
    .optional(),
  fitReason: s
    .string({ max: 300 })
    .describe('one line: why this fit score (include active-operation signal)')
    .optional(),
  intentScore: s
    .int({ min: 0, max: 10 })
    .describe(
      '0–10 observable pain / buying readiness: 0–2 no visible gap (already has own storefront or minimal info); 3–5 moderate workflow friction (orders via WhatsApp/DM without own link, PDF/image menu, iFood-only); 6–7 strong friction or growth signal (high-volume manual orders/encomendas on WhatsApp, reviews/comments asking for menu/prices, launching delivery); 8–10 explicit buyer intent (asked price/how to start, wants to switch/stop manual WhatsApp)',
    )
    .optional(),
  intentReason: s
    .string({ max: 300 })
    .describe('one line: the pain or intent signals observed')
    .optional(),
};

export const NEXT_ACTION_REQUESTED = s
  .boolean()
  .describe(
    "true when the LEAD asked to be contacted at nextActionAt (\"me chama terça\") — marks the date 'requested': a promised callback that survives the lead's next message. Omit for the agent's own cadence.",
  )
  .optional();

export const MESSAGE_BODY = s
  .string({ min: 1, max: 4000 })
  .describe(
    'the message exactly as the lead will read it: warm, plain spoken Portuguese, sized like a real chat message (1-3 short lines on whatsapp/instagram), at most one genuine question, no sales clichés, no dossier dumps, no markdown, bullets or em dashes',
  );

export const MESSAGE_SUBJECT = s
  .string({ max: 200 })
  .describe('email only: short and plain, the way a person titles an email')
  .optional();
