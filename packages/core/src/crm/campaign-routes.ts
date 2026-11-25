import type { Context, Hono } from 'hono';
import type { Sql } from '../platform/db.ts';
import { HttpError, UUID_RE } from '../platform/http.ts';
import { controlIdemKey, controlTx } from '../modules/control.ts';
import {
  bumpCampaignBudget,
  CAMPAIGN_GOAL_KINDS,
  CAMPAIGN_SCOPES,
  CAMPAIGN_STATUSES,
  campaignJson,
  getCampaignDetail,
  guideCampaign,
  listCampaigns,
  pauseCampaign,
  preflightCampaignTx,
  resumeCampaign,
  startCampaign,
  stopCampaign,
  type CampaignGoalKind,
  type CampaignScope,
  type CampaignStatus,
} from './campaigns.ts';

async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  const raw = await c.req.text();
  if (Buffer.byteLength(raw) > 32_000) throw new HttpError(413, 'TOO_LARGE', 'body too large');
  try {
    const v = JSON.parse(raw || '{}') as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'BAD_JSON', 'body must be a JSON object');
  }
}

function campaignIdParam(c: Context): string {
  const id = c.req.param('id');
  if (!id || !UUID_RE.test(id)) throw new HttpError(400, 'BAD_ID', 'id must be a uuid');
  return id;
}

/**
 * Staff REST surface for Autonomous Campaign Mode (`/control/v1/agent/campaigns*`).
 * Every mutating route requires an `Idempotency-Key` header via `controlIdemKey` + `claimControl`.
 */
export function mountCampaignRoutes(o: {
  app: Hono<any>;
  sql: Sql;
  controlGate: (c: Context) => void;
}): void {
  const { app, sql, controlGate } = o;

  app.get('/control/v1/agent/campaigns', async (c) => {
    controlGate(c);
    const rawStatus = c.req.query('status');
    const status =
      rawStatus === 'open' || CAMPAIGN_STATUSES.includes(rawStatus as CampaignStatus)
        ? (rawStatus as CampaignStatus | 'open')
        : undefined;
    if (rawStatus !== undefined && !status) {
      throw new HttpError(400, 'BAD_REQUEST', 'invalid status filter');
    }
    const rawLimit = c.req.query('limit');
    const limit = rawLimit ? Number(rawLimit) : undefined;
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 50)) {
      throw new HttpError(400, 'BAD_REQUEST', 'limit must be an integer in [1, 50]');
    }
    const [campaigns, preflight] = await Promise.all([
      listCampaigns(sql, { ...(status ? { status } : {}), ...(limit ? { limit } : {}) }),
      controlTx(sql, (tx) => preflightCampaignTx(tx, 'signup')),
    ]);
    return c.json({ campaigns, preflight });
  });

  app.get('/control/v1/agent/campaigns/:id', async (c) => {
    controlGate(c);
    const detail = await getCampaignDetail(sql, campaignIdParam(c));
    if (!detail) throw new HttpError(404, 'NOT_FOUND', 'campaign not found');
    return c.json(detail);
  });

  app.post('/control/v1/agent/campaigns', async (c) => {
    controlGate(c);
    const key = controlIdemKey(c);
    const b = await jsonBody(c);
    const title = typeof b.title === 'string' ? b.title : '';
    const objective = typeof b.objective === 'string' ? b.objective : '';
    if (b.goalKind !== undefined && !CAMPAIGN_GOAL_KINDS.includes(b.goalKind as CampaignGoalKind)) {
      throw new HttpError(422, 'BAD_REQUEST', 'goalKind must be signup, meeting, or reply');
    }
    if (b.goalScope !== undefined && !CAMPAIGN_SCOPES.includes(b.goalScope as CampaignScope)) {
      throw new HttpError(422, 'BAD_REQUEST', 'goalScope must be any or campaign_only');
    }
    const res = await startCampaign(sql, {
      title,
      objective,
      ...(b.goalKind ? { goalKind: b.goalKind as CampaignGoalKind } : {}),
      ...(typeof b.goalTarget === 'number' ? { goalTarget: b.goalTarget } : {}),
      ...(b.goalScope ? { goalScope: b.goalScope as CampaignScope } : {}),
      ...(typeof b.budgetUsd === 'number' ? { budgetUsd: b.budgetUsd } : {}),
      ...(typeof b.maxDays === 'number' ? { maxDays: b.maxDays } : {}),
      ...(typeof b.maxHuntsPerDay === 'number' ? { maxHuntsPerDay: b.maxHuntsPerDay } : {}),
      ...(typeof b.targetWip === 'number' ? { targetWip: b.targetWip } : {}),
      ...(typeof b.checkIntervalMin === 'number' ? { checkIntervalMin: b.checkIntervalMin } : {}),
      ...(typeof b.focusSegment === 'string' ? { focusSegment: b.focusSegment } : {}),
      ...(typeof b.focusCity === 'string' ? { focusCity: b.focusCity } : {}),
      ...(typeof b.allowExistingLeads === 'boolean'
        ? { allowExistingLeads: b.allowExistingLeads }
        : {}),
      ...(b.enableAutopilot === true ? { enableAutopilot: true } : {}),
      by: typeof b.by === 'string' && b.by.trim() ? b.by.trim() : 'staff',
      idemKey: `campaign:start:${key}`,
    });
    return c.json(
      { campaign: campaignJson(res.campaign), mailboxId: res.mailboxId },
      res.replayed ? 200 : 201,
    );
  });

  app.post('/control/v1/agent/campaigns/:id/pause', async (c) => {
    controlGate(c);
    const key = controlIdemKey(c);
    const b = await jsonBody(c);
    const r = await pauseCampaign(sql, {
      campaignId: campaignIdParam(c),
      reason: typeof b.reason === 'string' ? b.reason : null,
      by: typeof b.by === 'string' && b.by.trim() ? b.by.trim() : 'staff',
      idemKey: `campaign:pause:${key}`,
    });
    return c.json({ campaign: campaignJson(r.campaign) });
  });

  app.post('/control/v1/agent/campaigns/:id/resume', async (c) => {
    controlGate(c);
    const key = controlIdemKey(c);
    const b = await jsonBody(c);
    const r = await resumeCampaign(sql, {
      campaignId: campaignIdParam(c),
      by: typeof b.by === 'string' && b.by.trim() ? b.by.trim() : 'staff',
      ...(typeof b.extraBudgetUsd === 'number' ? { extraBudgetUsd: b.extraBudgetUsd } : {}),
      ...(typeof b.extendDays === 'number' ? { extendDays: b.extendDays } : {}),
      idemKey: `campaign:resume:${key}`,
    });
    return c.json({ campaign: campaignJson(r.campaign), mailboxId: r.mailboxId });
  });

  app.post('/control/v1/agent/campaigns/:id/stop', async (c) => {
    controlGate(c);
    const key = controlIdemKey(c);
    const b = await jsonBody(c);
    const r = await stopCampaign(sql, {
      campaignId: campaignIdParam(c),
      reason: typeof b.reason === 'string' ? b.reason : null,
      by: typeof b.by === 'string' && b.by.trim() ? b.by.trim() : 'staff',
      idemKey: `campaign:stop:${key}`,
    });
    return c.json({ campaign: campaignJson(r.campaign) });
  });

  app.post('/control/v1/agent/campaigns/:id/guide', async (c) => {
    controlGate(c);
    const key = controlIdemKey(c);
    const b = await jsonBody(c);
    const guidance = typeof b.guidance === 'string' ? b.guidance : '';
    const r = await guideCampaign(sql, {
      campaignId: campaignIdParam(c),
      guidance,
      by: typeof b.by === 'string' && b.by.trim() ? b.by.trim() : 'staff',
      idemKey: `campaign:guide:${key}`,
    });
    return c.json({ campaign: campaignJson(r.campaign), mailboxId: r.mailboxId });
  });

  app.post('/control/v1/agent/campaigns/:id/budget', async (c) => {
    controlGate(c);
    const key = controlIdemKey(c);
    const b = await jsonBody(c);
    const addUsd = typeof b.addUsd === 'number' ? b.addUsd : NaN;
    const r = await bumpCampaignBudget(sql, {
      campaignId: campaignIdParam(c),
      addUsd,
      by: typeof b.by === 'string' && b.by.trim() ? b.by.trim() : 'staff',
      idemKey: `campaign:budget:${key}`,
    });
    return c.json({ campaign: campaignJson(r.campaign), resumed: r.resumed });
  });
}
