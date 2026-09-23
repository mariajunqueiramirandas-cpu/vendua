import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { api, type Stats } from '../api.ts';
import { onControlEvent } from '../events.ts';
import { Empty, LEAD_STATES, LEAD_STATE_LABEL, Page, fmtDay, fmtMoney } from '../components.tsx';

/** R$ compact for chart axis labels — "R$ 4,9 mil" fits where the full
 *  currency string wouldn't. */
const fmtCompact = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    notation: 'compact',
    maximumFractionDigits: 1,
  });

export default function Reports() {
  const [s, setS] = useState<Stats | null>(null);
  const [err, setErr] = useState('');
  const [snapping, setSnapping] = useState(false);
  // Loads overlap (mount + snapNow refresh) — newest-successful wins: an
  // older response still commits unless a newer success already landed, so
  // a failed refresh never discards good stats.
  const reqSeq = useRef(0);
  const okSeq = useRef(0);

  const load = useCallback(() => {
    const seq = ++reqSeq.current;
    api
      .stats()
      .then((stats) => {
        if (seq < okSeq.current) return;
        okSeq.current = seq;
        setS(stats);
        setErr('');
      })
      .catch((e) => {
        if (seq >= okSeq.current) setErr(String(e));
      });
  }, []);
  useEffect(load, [load]);
  useEffect(() => onControlEvent(['lead.change', 'run.update'], load), [load]);
  useEffect(() => {
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const snapNow = async () => {
    setSnapping(true);
    try {
      await api.snapshotNow();
      load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setSnapping(false);
    }
  };

  const fc = s?.forecast;
  const pipelineTotal = s ? Object.values(s.byState).reduce((t, b) => t + b.valueCents, 0) : 0;

  return (
    <Page
      title="Relatórios"
      sub={
        fc?.trend.length
          ? `${fc.trend.length} snapshots · desde ${fmtDay(fc.trend[0]!.takenOn)}`
          : 'um snapshot por dia'
      }
      actions={
        <button className="btn" onClick={() => void snapNow()} disabled={snapping}>
          <RefreshCw size={13} /> {snapping ? 'gravando…' : 'atualizar snapshot'}
        </button>
      }
    >
      {err && <Empty title="não foi possível carregar" hint={err} />}
      {s && fc && (
        <div className="stack">
          <div className="grid4">
            <div className="card stat">
              <div className="v" style={{ color: 'var(--forest-800)' }}>
                {fmtMoney(fc.weightedCents)}
              </div>
              <div className="k">previsão ponderada</div>
            </div>
            <div className="card stat">
              <div className="v">{fmtMoney(pipelineTotal)}</div>
              <div className="k">pipeline total</div>
            </div>
            <div className="card stat">
              <div className="v">{fmtMoney(s.won30d.valueCents)}</div>
              <div className="k">
                ganhos · 30d
                {!!s.won30d.count && <span className="warn-dot"> · {s.won30d.count}</span>}
              </div>
            </div>
            <div className="card stat">
              <div className="v">{fmtMoney(s.agent30d.costCents)}</div>
              <div className="k">custo do agente · 30d</div>
            </div>
          </div>

          <div className="grid2">
            <div className="card pad">
              <div className="card-head">
                <b>valor ponderado · últimos 30 snapshots</b>
                <span className="legend">
                  <i className="sw" style={{ background: 'var(--forest-800)' }} /> ponderado
                  <i
                    className="sw"
                    style={{ background: 'var(--sage-300)', marginInlineStart: 10 }}
                  />{' '}
                  pipeline
                </span>
              </div>
              <TrendChart trend={fc.trend} />
            </div>
            <div className="card pad">
              <div className="card-head">
                <b>por estágio</b>
                <Link to="/config" className="note">
                  probabilidades em config →
                </Link>
              </div>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>estágio</th>
                    <th className="num">leads</th>
                    <th className="num">valor</th>
                    <th className="num">prob.</th>
                    <th className="num">ponderado</th>
                  </tr>
                </thead>
                <tbody>
                  {LEAD_STATES.map(([st]) => {
                    const b = fc.byState[st];
                    return (
                      <tr key={st}>
                        <td>
                          <Link to="/funil">{LEAD_STATE_LABEL[st]}</Link>
                        </td>
                        <td className="num">{b?.count ?? 0}</td>
                        <td className="num">{fmtMoney(b?.valueCents)}</td>
                        <td className="num">{b ? `${Math.round(b.probability * 100)}%` : '—'}</td>
                        <td className="num">{fmtMoney(b?.weightedCents)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid2">
            <ValueBars title="valor por origem" rows={s.bySource} />
            <ValueBars title="valor por segmento" rows={s.bySegment} />
          </div>
        </div>
      )}
      {!s && !err && <Empty title="carregando…" />}
    </Page>
  );
}

/** Weighted forecast (area) vs raw pipeline value (line) over the daily
 *  snapshots — hand-rolled SVG, no chart dep. */
function TrendChart({ trend }: { trend: Stats['forecast']['trend'] }) {
  if (!trend.length)
    return (
      <Empty
        title="sem snapshots ainda"
        hint="o agente grava um por dia — use “atualizar snapshot” para gravar o primeiro"
      />
    );

  const W = 640;
  const H = 200;
  const PL = 46;
  const PR = 8;
  const PT = 12;
  const PB = 20;
  const iw = W - PL - PR;
  const ih = H - PT - PB;
  const max = Math.max(1, ...trend.flatMap((p) => [p.valueCents, p.weightedCents]));
  const x = (i: number) => PL + (trend.length === 1 ? iw / 2 : (i / (trend.length - 1)) * iw);
  const y = (v: number) => PT + ih - (v / max) * ih;
  const line = (f: (p: (typeof trend)[number]) => number) =>
    trend.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(f(p)).toFixed(1)}`).join(' ');
  const area = `${line((p) => p.weightedCents)} L${x(trend.length - 1).toFixed(1)},${PT + ih} L${x(0).toFixed(1)},${PT + ih} Z`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="evolução do valor ponderado e do pipeline"
      style={{ width: '100%', height: 'auto', display: 'block', marginTop: 6 }}
    >
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line
            x1={PL}
            x2={W - PR}
            y1={y(max * t)}
            y2={y(max * t)}
            stroke="var(--line)"
            strokeDasharray={t ? '3 4' : undefined}
          />
          <text x={PL - 6} y={y(max * t) + 3} textAnchor="end" className="chart-tick">
            {fmtCompact(max * t)}
          </text>
        </g>
      ))}
      <path d={area} fill="color-mix(in srgb, var(--forest-800) 14%, transparent)" />
      <path
        d={line((p) => p.valueCents)}
        fill="none"
        stroke="var(--sage-300)"
        strokeWidth={1.5}
        strokeDasharray="4 3"
      />
      <path
        d={line((p) => p.weightedCents)}
        fill="none"
        stroke="var(--forest-800)"
        strokeWidth={2}
      />
      {trend.map((p, i) => (
        <circle
          key={p.takenOn}
          cx={x(i)}
          cy={y(p.weightedCents)}
          r={2.4}
          fill="var(--forest-800)"
        />
      ))}
      <text x={PL} y={H - 5} textAnchor="start" className="chart-tick">
        {fmtDay(trend[0]!.takenOn)}
      </text>
      <text x={W - PR} y={H - 5} textAnchor="end" className="chart-tick">
        {fmtDay(trend.at(-1)!.takenOn)}
      </text>
    </svg>
  );
}

function ValueBars({
  title,
  rows,
}: {
  title: string;
  rows: { key: string; count: number; valueCents: number }[];
}) {
  // Rank by value — the arrays arrive count-ordered for the dashboard.
  const ranked = [...rows].sort((a, b) => b.valueCents - a.valueCents).slice(0, 8);
  const max = Math.max(1, ...ranked.map((r) => r.valueCents));
  return (
    <div className="card pad">
      <div className="card-head">
        <b>{title}</b>
      </div>
      <div className="hbars">
        {ranked.map((r) => (
          <div className="row" key={r.key}>
            <span className="lb" title={r.key}>
              {r.key || '—'}
            </span>
            <span className="track">
              <i style={{ width: `${Math.max(1.5, (r.valueCents / max) * 100)}%` }} />
            </span>
            <span className="v">{fmtMoney(r.valueCents)}</span>
            <span className="n">{r.count}</span>
          </div>
        ))}
        {!rows.length && <span style={{ color: 'var(--muted)' }}>sem dados ainda</span>}
      </div>
    </div>
  );
}
