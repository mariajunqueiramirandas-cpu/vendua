import type { Agent, Transport } from '@vendua/agent-runtime';
import type { Sql } from '../../platform/db.ts';
import { vendedorTransport } from '../../vendedor/transport.ts';
import { vendedor } from './vendedor/index.ts';
import { vendedorOnboarding } from './vendedor-onboarding/index.ts';

/**
 * Agents on Runtime v3, one file each under `agents/<id>/`. The Vendedor (ADR 0031) is the
 * first; the CRM agent joins after its port (ADR 0030, migration step 2).
 */
export const AGENTS: Agent<Sql>[] = [vendedor, vendedorOnboarding];

/** Transports those agents reply through (`whatsappTransport` with the agent's recipient). */
export const TRANSPORTS: Transport<Sql>[] = [vendedorTransport];
