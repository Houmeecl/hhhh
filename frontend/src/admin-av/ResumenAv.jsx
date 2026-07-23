import { useEffect, useState } from 'react';
import { api, fmt, fmtInt, fmtFecha } from '../api.js';

const NIVEL_BADGE = { Alto: 'badge-green', Medio: 'badge-amber', Bajo: 'badge-red' };

export default function ResumenAv() {
  const [comp, setComp] = useState(null);
  const [embalajeResumen, setEmbalajeResumen] = useState(null);
  const [ultimasRep, setUltimasRep] = useState(null);
  const [ultimasComp, setUltimasComp] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.compensacionesResumen().then(setComp).catch((e) => setErr(e.message));
    api.embalajeResumenAv().then(setEmbalajeResumen).catch(() => {});
    api.embalajeAv('?limit=5').then((r) => setUltimasRep(r.declaraciones)).catch(() => {});
    api.compensacionesAv('?limit=5').then((r) => setUltimasComp(r.compensaciones)).catch(() => {});
  }, []);

  if (err) return <div className="badge badge-red" style={{ padding: 14 }}>{err}</div>;

  return (
    <div>
      <div className="admin-head"><h1>Resumen</h1></div>

      <div className="stat-grid">
        <div className="stat">
          <div className="n green">${comp ? fmtInt(comp.total_monto_clp) : '—'}</div>
          <div className="l">Compensación acumulada (CLP)</div>
        </div>
        <div className="stat">
          <div className="n">{comp ? fmt(comp.total_t_co2e, 3) : '—'}</div>
          <div className="l">t CO2e compensadas</div>
        </div>
        <div className="stat">
          <div className="n">{comp ? fmtInt(comp.n) : '—'}</div>
          <div className="l">Trámites compensados</div>
        </div>
        <div className="stat">
          <div className="n">{embalajeResumen ? fmtInt(embalajeResumen.total) : '—'}</div>
          <div className="l">Declaraciones REP registradas</div>
        </div>
      </div>

      {embalajeResumen && embalajeResumen.total > 0 && (
        <div className="card card-pad" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Distribución de reciclabilidad (REP)</h3>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {['Alto', 'Medio', 'Bajo'].map((nivel) => (
              <span key={nivel} className={`badge ${NIVEL_BADGE[nivel]}`}>
                {nivel}: {fmtInt(embalajeResumen.por_nivel[nivel] || 0)}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="two-col-grid" style={{ marginTop: 16, alignItems: 'stretch' }}>
        <div className="card card-pad">
          <h3 style={{ marginTop: 0 }}>Últimas declaraciones REP</h3>
          {(ultimasRep || []).length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {ultimasRep.map((d, i) => (
                <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, paddingBottom: 8, borderBottom: i < ultimasRep.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <span>{d.nombre_cliente || d.rut_cliente || 'Sin cliente'} · <span className={`badge ${NIVEL_BADGE[d.nivel] || 'badge-gray'}`} style={{ fontSize: 11 }}>{d.nivel}</span></span>
                  <span className="muted" style={{ whiteSpace: 'nowrap' }}>{fmtFecha(d.created_at)}</span>
                </div>
              ))}
            </div>
          ) : <p className="muted" style={{ fontSize: 13 }}>Sin declaraciones registradas todavía.</p>}
        </div>

        <div className="card card-pad">
          <h3 style={{ marginTop: 0 }}>Últimas compensaciones</h3>
          {(ultimasComp || []).length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {ultimasComp.map((c, i) => (
                <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, paddingBottom: 8, borderBottom: i < ultimasComp.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <span>{c.nombre_cliente || c.rut_cliente || 'Sin cliente'} · ${fmtInt(c.monto_clp)}</span>
                  <span className="muted" style={{ whiteSpace: 'nowrap' }}>{fmtFecha(c.created_at)}</span>
                </div>
              ))}
            </div>
          ) : <p className="muted" style={{ fontSize: 13 }}>Sin compensaciones registradas todavía.</p>}
        </div>
      </div>
    </div>
  );
}
