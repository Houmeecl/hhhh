import { useEffect, useState } from 'react';
import { api, fmtFecha } from '../api.js';

const NIVEL_BADGE = { Alto: 'badge-green', Medio: 'badge-amber', Bajo: 'badge-red' };

// Declaraciones de embalaje REP (Ley 20.920) ya registradas por el flujo
// de Aduana Verde — listado de solo lectura sobre declaraciones_embalaje
// (el % y el nivel ya se calcularon en el servidor al crear cada una).
export default function RepAv() {
  const [items, setItems] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.embalajeAv().then((r) => setItems(r.declaraciones)).catch((e) => setErr(e.message));
  }, []);

  return (
    <div>
      <div className="admin-head"><h1>REP — declaraciones de embalaje</h1></div>
      {err && <div className="badge badge-red" style={{ padding: '10px 14px', marginBottom: 14 }}>{err}</div>}
      <div className="card">
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Cliente</th><th>Fecha sesión</th><th className="num">Peso total (g)</th>
                <th className="num">Reciclable (g)</th><th className="num">%</th><th>Nivel</th><th>Registrada</th>
              </tr>
            </thead>
            <tbody>
              {(items || []).map((d) => (
                <tr key={d.id}>
                  <td>{d.nombre_cliente || d.rut_cliente || '—'}</td>
                  <td className="muted" style={{ fontSize: 13 }}>{d.fecha ? fmtFecha(d.fecha) : '—'}</td>
                  <td className="num">{d.peso_total_gr}</td>
                  <td className="num">{d.peso_reciclable_gr}</td>
                  <td className="num"><b>{d.porcentaje}%</b></td>
                  <td><span className={`badge ${NIVEL_BADGE[d.nivel] || 'badge-gray'}`}>{d.nivel}</span></td>
                  <td className="muted" style={{ fontSize: 13 }}>{fmtFecha(d.created_at)}</td>
                </tr>
              ))}
              {items && items.length === 0 && (
                <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 30 }}>Sin declaraciones de embalaje registradas todavía.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
