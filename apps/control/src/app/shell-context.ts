import { createContext, useContext } from 'react';
import type { AgentStatus } from '@/lib/queries.ts';

export interface ShellApi {
  openPalette: () => void;
  openHelp: () => void;
  logout: () => void;
  install: (() => void) | undefined;
  agentStatus: AgentStatus;
}

export const ShellContext = createContext<ShellApi | null>(null);

export function useShell(): ShellApi {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useShell outside AppShell');
  return ctx;
}
