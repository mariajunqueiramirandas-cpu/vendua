import type { AdminApp, AdminDeps } from '../../admin/context.ts';

// STUB (CORE-PAY replaces): PUBLIC routes mounted before the admin session gate —
// POST /hooks/mercadopago (webhook) and the fake driver's dev routes.
export function mountPaymentsPublic(_admin: AdminApp, _d: Omit<AdminDeps, 'admin'>) {}
