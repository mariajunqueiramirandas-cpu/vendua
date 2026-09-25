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

/** Phone-only header tools — on ≥768px the sidebar carries search, new lead and the account menu. */
export function GlobalActions() {
  const shell = useShell();
  const nav = useNavigate();
  const theme = useTheme();
  return (
    <div className="-mr-1.5 flex items-center md:hidden">
      <Button variant="ghost" size="icon" onClick={shell.openPalette} aria-label="buscar">
        <Search />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => nav('/pipeline?novo=1')}
        aria-label="novo lead"
      >
        <Plus />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="mais">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
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
            <SunMoon /> Tema: {THEME_LABEL[theme.pref]}
          </DropdownMenuItem>
          {shell.install && (
            <DropdownMenuItem onSelect={shell.install}>
              <Download /> Instalar app
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={shell.openHelp}>
            <Keyboard /> Atalhos
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={shell.logout}>
            <LogOut /> Sair
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
