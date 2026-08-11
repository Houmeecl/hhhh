import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Actividad() {
  const [items, setItems] = useState([]);
  useEffect(() => { api.actividad().then((r) => setItems(r.actividad)).catch(() => {}); }, []);

  return (
    <div>
      <div className="admin-head"><h1>Log de actividad</h1></div>
      <div className="card">
        <div className="table-scroll">
        <table className="data">
          <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Entidad</th><th>IP</th></tr></thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id}>
                <td className="muted" style={{ fontSize: 13 }}>{new Date(a.created_at).toLocaleString('es-CL')}</td>
                <td>{a.usuario_email || '—'}</td>
                <td><span className="badge badge-gray">{a.accion}</span></td>
                <td className="muted">{a.entidad || '—'}</td>
                <td className="muted" style={{ fontSize: 12 }}>{a.ip || '—'}</td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 30 }}>Sin actividad registrada.</td></tr>}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
