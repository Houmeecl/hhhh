import { useEffect, useState } from 'react';
import { api, fmt, fmtInt } from '../api.js';
import { Donut, Serie, Bar } from '../components/Charts.jsx';
import { SkeletonCards } from '../components/Skeleton.jsx';
import { Icon } from '../components/icons.jsx';

const TIPO_LABEL = {
  documento_escaneado: 'Documentos escaneados',
  mision_completada: 'Misiones completadas',
  trayecto_registrado: 'Trayectos',
  envase_reciclado: 'Envases reciclados',
};
const MATERIAL_LABEL = { pet: 'Botellas PET', vidrio: 'Vidrio', lata: 'Latas', tetra: 'Tetra' };

// Métricas de "Sube y Suma": participación de los equipos de las empresas
// cliente (jugadores, documentos, envases, trayectos). Muestra lo que se
// registró tal cual — nunca convierte envases a "CO2e evitado": no hay un
// factor validado para eso y no se inventa.
export default function Juego() {
  const [m, setM] = useState(null);
  useEffect(() => { api.adminJuegoResumen().then(setM).catch(() => {}); }, []);
  if (!m) return <div><div className="admin-head"><h1>Sube y Suma</h1></div><SkeletonCards n={3} /></div>;

  const maxPunto = Math.max(...m.por_punto_limpio.map((p) => p.envases), 1);

  return (
    <div>
      <div className="admin-head">
        <div>
          <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: 'var(--green-600)' }}><Icon.Sparkles size={24} /></span> Sube y Suma
          </h1>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 14 }}>
            Participación de las campañas gamificadas: documentos escaneados, envases entregados en
            puntos limpios y trayectos. Los puntos son un reconocimiento interno — no equivalen a
            bonos de carbono ni a CO2e evitado.
          </p>
        </div>
      </div>

      <div className="stat-grid" style={{ marginBottom: 18 }}>
        <div className="stat"><div className="n green">{fmtInt(m.jugadores)}</div><div className="l">Jugadores</div></div>
        <div className="stat"><div className="n green">{fmtInt(m.documentos_escaneados)}</div><div className="l">Documentos escaneados</div></div>
        <div className="stat"><div className="n green">{fmtInt(m.envases_reciclados)}</div><div className="l">Envases reciclados ({fmtInt(m.entregas_reciclaje)} entregas)</div></div>
        <div className="stat"><div className="n green">{fmt(m.km_trayectos, 1)}</div><div className="l">km en trayectos ({fmtInt(m.trayectos_cerrados)} cerrados)</div></div>
        <div className="stat"><div className="n green">{fmtInt(m.puntos_otorgados)}</div><div className="l">Puntos otorgados</div></div>
      </div>

      <div className="two-col-grid">
        <div className="card card-pad">
          <h3 style={{ marginTop: 0 }}>Puntos por origen</h3>
          <Donut data={m.puntos_por_tipo.map((t) => ({ label: TIPO_LABEL[t.tipo] || t.tipo, value: t.puntos }))} unit="pts" />
        </div>

        <div className="card card-pad">
          <h3 style={{ marginTop: 0 }}>Envases por material</h3>
          {m.envases_por_material.map((e, i) => (
            <Bar key={i} value={e.cantidad} max={Math.max(...m.envases_por_material.map((x) => x.cantidad), 1)}
              label={MATERIAL_LABEL[e.material] || e.material} right={fmtInt(e.cantidad)} />
          ))}
          {m.envases_por_material.length === 0 && <p className="muted">Sin entregas registradas todavía.</p>}
        </div>

        <div className="card card-pad">
          <h3 style={{ marginTop: 0 }}>Envases por mes</h3>
          <Serie data={m.serie_envases.map((s) => ({ label: s.mes, value: s.envases }))} unit="envases" />
        </div>

        <div className="card card-pad">
          <h3 style={{ marginTop: 0 }}>Entregas por punto limpio</h3>
          {m.por_punto_limpio.map((p, i) => (
            <Bar key={i} value={p.envases} max={maxPunto} label={p.nombre} right={`${fmtInt(p.envases)} env. · ${fmtInt(p.entregas)} entregas`} />
          ))}
          {m.por_punto_limpio.length === 0 && <p className="muted">Sin puntos limpios creados.</p>}
        </div>

        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <div className="table-scroll">
          <table className="data">
            <thead><tr><th>Campaña</th><th>Empresa</th><th className="num">Jugadores</th><th className="num">Envases</th><th className="num">Puntos</th></tr></thead>
            <tbody>
              {m.por_campana.map((c, i) => (
                <tr key={i}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{c.codigo}</td>
                  <td className="muted">{c.empresa || '—'}</td>
                  <td className="num">{fmtInt(c.jugadores)}</td>
                  <td className="num">{fmtInt(c.envases)}</td>
                  <td className="num"><b>{fmtInt(c.puntos)}</b></td>
                </tr>
              ))}
              {m.por_campana.length === 0 && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 30 }}>Sin campañas con jugadores todavía.</td></tr>}
            </tbody>
          </table>
          </div>
        </div>
      </div>
    </div>
  );
}
