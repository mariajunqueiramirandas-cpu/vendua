import { useNavigate } from 'react-router-dom';
import {
  Download,
  Keyboard,
  LogOut,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  SunMoon,
} from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import { Kbd } from '@/components/ui/controls.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/overlay.tsx';
import { THEME_LABEL, useTheme } from '@/lib/theme.ts';
import { useShell } from './shell-context.ts';

/** Search + quick add on every page header; phones also get the overflow menu (config, theme, logout). */
export function GlobalActions() {
  const shell = useShell();
  const nav = useNavigate();
  const theme = useTheme();
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="hidden h-8 w-44 justify-start text-muted-foreground lg:inline-flex"
        onClick={shell.openPalette}
      >
        <Search /> buscar…
        <Kbd className="ml-auto">⌘K</Kbd>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={shell.openPalette}
        aria-label="buscar"
      >
        <Search />
      </Button>
      <Button
        size="icon"
        className="md:size-8"
        onClick={() => nav('/pipeline?novo=1')}
        aria-label="novo lead"
        title="novo lead (n)"
      >
        <Plus />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="mais">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>agente · {shell.llmDriver || '…'}</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => nav('/config')}>
            <Settings /> Config
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              theme.cycle();
            }}
          >
            <SunMoon /> tema: {THEME_LABEL[theme.pref]}
          </DropdownMenuItem>
          {shell.install && (
            <DropdownMenuItem onSelect={shell.install}>
              <Download /> instalar app
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={shell.openHelp}>
            <Keyboard /> atalhos
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={shell.logout}>
            <LogOut /> sair
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
