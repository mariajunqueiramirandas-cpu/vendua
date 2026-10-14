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
    .describe('0–10 ICP fit — how well this business matches the target audience')
    .optional(),
  fitReason: s.string({ max: 300 }).describe('one line: why this fit score').optional(),
  intentScore: s
    .int({ min: 0, max: 10 })
    .describe(
      '0–10 buying intent — what the research showed: whatsapp-active business with NO ordering link of its own (sells via iFood/WhatsApp only), recent reviews asking for menu/ordering, hiring or other growth signals',
    )
    .optional(),
  intentReason: s.string({ max: 300 }).describe('one line: the intent signals observed').optional(),
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
    'the message exactly as the lead will read it: plain text, sized like a real chat message (1-3 short lines on whatsapp/instagram), at most one question, no markdown, bullets or em dashes',
  );

export const MESSAGE_SUBJECT = s
  .string({ max: 200 })
  .describe('email only: short and plain, the way a person titles an email')
  .optional();
