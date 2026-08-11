import { useState } from 'react';
import { Icon } from './icons.jsx';
import { api, fmt, fmtInt } from '../api.js';
import {
  MATERIALES_REP,
  calcularReciclabilidad,
  UMBRAL_EXENCION_REP_KG,
  EXENCION_REP_NOTA,
} from '../lib/rep.js';

// Color del badge según nivel de reciclabilidad REP. Compartido entre el
// terminal POS del mostrador presencial y el flujo web público.
export const NIVEL_BADGE = { Alto: 'badge-green', Medio: 'badge-amber', Bajo: 'badge-red' };

// Sección plegable: pre-declaración de embalaje por componentes (Ley 20.920)
// con % de reciclabilidad en vivo (preview local) y guardado real en el
// backend (POST /api/sesiones/:id/embalaje — el servidor recalcula todo).
// Componente controlado: `componentes`/`setComponentes` y la declaración ya
// guardada (`guardada`) viven en la página que lo usa, para sobrevivir a
// cambios de paso o re-render de la página.
export default function DeclaracionEmbalaje({ sesionId, componentes, setComponentes, guardada, onGuardada, onModificar }) {
  const [abierta, setAbierta] = useState(() => !!guardada);
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState('');
  const calculo = calcularReciclabilidad(componentes);

  const nivelBadge = NIVEL_BADGE;

  async function guardar() {
    setErrorGuardar('');
    setGuardando(true);
    try {
      // Solo componentes con peso efectivo; el servidor recalcula porcentaje,
      // nivel y pesos (no se le mandan resultados locales).
      const payload = componentes
        .map((c) => ({
          material: c.material,
          peso_gr: Number(c.peso_gr) || 0,
          cantidad: c.cantidad === '' ? 1 : Number(c.cantidad) || 0,
          reciclable: !!c.reciclable,
        }))
        .filter((c) => c.peso_gr > 0 && c.cantidad > 0);
      const { declaracion } = await api.guardarEmbalaje(sesionId, payload);
      onGuardada(declaracion);
    } catch (e) {
      setErrorGuardar(e.message || 'No se pudo guardar la declaración. Intenta de nuevo.');
    } finally {
      setGuardando(false);
    }
  }

  function agregar() {
    setComponentes((cs) => [...cs, { material: MATERIALES_REP[0].codigo, peso_gr: '', cantidad: '1', reciclable: true }]);
  }
  function actualizar(i, patch) {
    setComponentes((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  }
  function quitar(i) {
    setComponentes((cs) => cs.filter((_, j) => j !== i));
  }

  return (
    <div className="card" style={{ marginTop: 16, overflow: 'hidden' }}>
      <button type="button" onClick={() => setAbierta((a) => !a)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px',
          background: 'var(--bg)', border: 'none', cursor: 'pointer', textAlign: 'left',
          font: 'inherit', color: 'var(--navy)',
        }}>
        <span style={{ color: 'var(--green-600)', display: 'inline-flex', flexShrink: 0 }}><Icon.Package size={20} /></span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Declaración de embalaje (opcional)</span>
          <span className="muted" style={{ display: 'block', fontSize: 12 }}>Ley 20.920 · composición por componentes y reciclabilidad</span>
        </span>
        {guardada && <span className="badge badge-green" style={{ flexShrink: 0 }}>Guardada</span>}
        <span className="muted" style={{ flexShrink: 0, display: 'inline-flex', transform: abierta ? 'rotate(-90deg)' : 'rotate(90deg)', transition: 'transform 0.2s ease' }}>
          <Icon.ArrowRight size={14} />
        </span>
      </button>

      {/* Declaración ya guardada en el backend: resumen bloqueado + Modificar. */}
      {abierta && guardada && (
        <div style={{ padding: 16 }}>
          <div className="badge badge-green send-check-pop" style={{ display: 'block', padding: '10px 14px', marginBottom: 12 }}>
            ✓ Declaración guardada — quedará en la verificación pública
          </div>
          <div className="result-box" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--green-600)' }}>{fmt(guardada.porcentaje, 1)}%</div>
            <div style={{ minWidth: 0 }}>
              <span className={`badge ${nivelBadge[guardada.nivel] || 'badge-gray'}`}>Reciclabilidad: {guardada.nivel}</span>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {fmtInt(guardada.peso_reciclable_gr)} gr reciclables de {fmtInt(guardada.peso_total_gr)} gr totales
              </div>
            </div>
          </div>
          <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 12 }} onClick={onModificar}>
            Modificar
          </button>
        </div>
      )}

      {abierta && !guardada && (
        <div style={{ padding: 16 }}>
          {componentes.length === 0 && (
            <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
              Agrega los componentes del embalaje (caja, film, zuncho…) para estimar su reciclabilidad.
            </p>
          )}

          {componentes.map((c, i) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10,
              alignItems: 'end', padding: '10px 0', borderBottom: '1px solid var(--border)',
            }}>
              <div className="field" style={{ margin: 0, minWidth: 0 }}>
                <label>Material</label>
                <select value={c.material} onChange={(e) => actualizar(i, { material: e.target.value })}>
                  {MATERIALES_REP.map((m) => <option key={m.codigo} value={m.codigo}>{m.nombre}</option>)}
                </select>
              </div>
              <div className="field" style={{ margin: 0, minWidth: 0 }}>
                <label>Peso unitario (gr)</label>
                <input inputMode="decimal" value={c.peso_gr} placeholder="250"
                  onChange={(e) => actualizar(i, { peso_gr: e.target.value.replace(/[^\d.,]/g, '').replace(',', '.') })} />
              </div>
              <div className="field" style={{ margin: 0, minWidth: 0 }}>
                <label>Cantidad</label>
                <input inputMode="numeric" value={c.cantidad} placeholder="1"
                  onChange={(e) => actualizar(i, { cantidad: e.target.value.replace(/\D/g, '') })} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 10, minWidth: 0 }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--navy)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!c.reciclable} onChange={(e) => actualizar(i, { reciclable: e.target.checked })} />
                  Reciclable
                </label>
                <span className="rm" style={{ color: '#b91c1c', cursor: 'pointer', fontWeight: 600, fontSize: 13 }} onClick={() => quitar(i)}>Quitar</span>
              </div>
            </div>
          ))}

          <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 12 }} onClick={agregar}>
            + Agregar componente
          </button>

          {calculo.nivel && (
            <div className="result-box" style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--green-600)' }}>{fmt(calculo.porcentaje, 1)}%</div>
              <div style={{ minWidth: 0 }}>
                <span className={`badge ${nivelBadge[calculo.nivel]}`}>Reciclabilidad: {calculo.nivel}</span>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {fmtInt(calculo.peso_reciclable_gr)} gr reciclables de {fmtInt(calculo.peso_total_gr)} gr totales · preview local, el servidor recalcula al guardar
                </div>
              </div>
            </div>
          )}

          {errorGuardar && (
            <div className="badge badge-red" style={{ display: 'block', padding: '10px 14px', marginTop: 12 }}>
              {errorGuardar}
            </div>
          )}

          <button type="button" className="btn btn-primary" style={{ width: '100%', marginTop: 14 }}
            onClick={guardar} disabled={!calculo.nivel || guardando || !sesionId}>
            {guardando ? <span className="spinner" /> : 'Guardar declaración'}
          </button>

          <p className="muted" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
            <b>Exención &lt;{UMBRAL_EXENCION_REP_KG} kg/año:</b> {EXENCION_REP_NOTA}
          </p>
        </div>
      )}
    </div>
  );
}
