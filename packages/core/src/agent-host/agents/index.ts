import type { Agent, Transport } from '@vendua/agent-runtime';
import type { Sql } from '../../platform/db.ts';
import { copilotTransport } from '../../copilot/view.ts';
import { vendedorTransport } from '../../vendedor/transport.ts';
import { copilot } from './copilot/index.ts';
import { vendedor } from './vendedor/index.ts';
import { vendedorOnboarding } from './vendedor-onboarding/index.ts';

/**
 * Agents on Runtime v3, one file each under `agents/<id>/`. The Vendedor (ADR 0031) is the
 * first, Duá Copilot (ADR 0034) works for the store's people in the admin; the CRM agent joins
 * after its port (ADR 0030, migration step 2).
 */
export const AGENTS: Agent<Sql>[] = [vendedor, vendedorOnboarding, copilot];

/** Transports those agents reply through (`whatsappTransport` with the agent's recipient). */
export const TRANSPORTS: Transport<Sql>[] = [vendedorTransport, copilotTransport];
