import type { Agent, Transport } from '@vendua/agent-runtime';
import type { Sql } from '../../platform/db.ts';
import { copilotTransport } from '../../copilot/view.ts';
import { vendedorTransport } from '../../vendedor/transport.ts';
import { copilot } from './copilot/index.ts';
import { crmAgent } from './crm/index.ts';
import { crmDiscovery } from './crm/discovery.ts';
import { crmLogTransport } from './crm/shared.ts';
import { crmStrategist } from './crm/strategist.ts';
import { vendedor } from './vendedor/index.ts';
import { vendedorOnboarding } from './vendedor-onboarding/index.ts';

/**
 * Agents on Runtime v3, one file each under `agents/<id>/`. The Vendedor (ADR 0031) is the
 * first, Duá Copilot (ADR 0034) works for the store's people in the admin, and the CRM's agents
 * (ADR 0030 steps 2–4) sell Venduá to leads under the platform tenant.
 */
export const AGENTS: Agent<Sql>[] = [
  vendedor,
  vendedorOnboarding,
  copilot,
  crmAgent,
  crmDiscovery,
  crmStrategist,
];

/** Transports those agents reply through (`whatsappTransport` with the agent's recipient). */
export const TRANSPORTS: Transport<Sql>[] = [vendedorTransport, copilotTransport, crmLogTransport];
