import { createContext, useContext } from 'react';

export interface ShellApi {
  openPalette: () => void;
  openHelp: () => void;
  logout: () => void;
  install: (() => void) | undefined;
  llmDriver: string;
}

export const ShellContext = createContext<ShellApi | null>(null);

export function useShell(): ShellApi {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useShell outside AppShell');
  return ctx;
}
