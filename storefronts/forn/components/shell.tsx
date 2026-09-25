import { Link } from 'react-router-dom';
import { useStore } from '@vendua/kernel';
import { BagButton } from './bag-button.tsx';
import { DayClock } from './day-clock.tsx';

export function Shell({ children }: { children: React.ReactNode }) {
  const { store } = useStore();
  return (
    <>
      <div className="wrap subhead">
        <Link to="/" className="brandlink" aria-label="Forn do Bairro — início">
          forn<span>do bairro</span>
        </Link>
        <BagButton />
      </div>
      <div className="wrap">
        <DayClock compact />
      </div>
      <main className="wrap page-fade">{children}</main>
      <Colophon />
    </>
  );
}

export function Colophon() {
  const { store } = useStore();
  return (
    <footer className="wrap colophon">
      <span>
        {store?.name ?? 'Forn do Bairro'}
        {store?.address ? ` — ${store.address}` : ''}
        {store?.city ? ` · ${store.city}` : ''}
      </span>
      <span className="mono">padoca · venduá</span>
    </footer>
  );
}
