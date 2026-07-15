import { useEffect, useState } from 'react';
import { api, fmt } from '../api.js';
import { Icon } from '../components/icons.jsx';

// Motor propio de cálculo — independiente del motor externo.
// Solo aplica hoy a documentos DTE XML (cantidad/unidad/monto reales);
// PDF/JPG/PNG/HEIC siguen con el motor externo (sin OCR en este entorno).
export default function MotorPropio() {
  const [categorias, setCategorias] = useState([]);
  const [stats, setStats] = useState(null);
  const [edit, setEdit] = useState(null);
  const [toast, setToast] = useState(null);
  const flash = (msg, err = false) => { setToast({ msg, err }); setTimeout(() => setToast(null), 3500); };

  const cargar = () => Promise.all([api.motorCategorias(), api.motorEstadisticas()])
    .then(([c, s]) => { setCategorias(c.categorias); setStats(s); })
    .catch((e) => flash(e.message, true));
  useEffect(() => { cargar(); }, []);

  async function guardar() {
    try {
      await api.guardarCategoriaMotor(edit.codigo, {
        nombre: edit.nombre,
        factor_fisico_kgco2e: edit.unidad_fisica ? (parseFloat(edit.factor_fisico) || 0) : null,
        factor_gasto_kgco2e_clp1000: parseFloat(edit.factor_gasto) || 0,
        palabras_clave: edit.palabras.split(',').map((s) => s.trim()).filter(Boolean),
        fuente: edit.fuente,
        activo: edit.activo,
      });
      setEdit(null); cargar(); flash('Categoría actualizada.');
    } catch (e) { flash(e.message, true); }
  }

  return (
    <div>
      <div className="admin-head">
        <div>
          <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: 'var(--green-600)' }}><Icon.Cog size={24} /></span> Motor propio de cálculo
          </h1>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 14 }}>
            Cálculo determinista de CO2e a partir de los datos reales de cada DTE XML (cantidad, unidad, monto).
            Documentos sin texto extraíble (PDF/JPG/PNG/HEIC) siguen usando el motor externo.
          </p>
        </div>
      </div>

      {stats && (
        <div className="card card-pad" style={{ marginBottom: 18, maxWidth: 420 }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--green-600)' }}>{fmt(stats.porcentaje_propio, 1)}%</div>
          <div className="muted" style={{ fontSize: 13 }}>
            de las facturas ya se calculan con motor propio ({stats.propio} de {stats.total})
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
        {categorias.map((c) => (
          <div className="card card-pad" key={c.codigo}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <b style={{ fontSize: 16 }}>{c.nombre}</b>
              <span className={`badge ${c.activo ? 'badge-green' : 'badge-gray'}`}>{c.activo ? 'Activa' : 'Inactiva'}</span>
            </div>
            {c.unidad_fisica && (
              <div style={{ fontSize: 13, marginTop: 8 }}>
                <b>{fmt(c.factor_fisico_kgco2e, 4)}</b> kgCO2e / {c.unidad_fisica} <span className="muted">(físico)</span>
              </div>
            )}
            <div style={{ fontSize: 13, marginTop: 4 }}>
              <b>{fmt(c.factor_gasto_kgco2e_clp1000, 3)}</b> kgCO2e / $1.000 <span className="muted">(gasto)</span>
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              Palabras clave: {(c.palabras_clave || []).join(', ') || '—'}
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{c.fuente}</div>
            <button className="btn btn-outline btn-sm" style={{ marginTop: 10 }}
              onClick={() => setEdit({
                codigo: c.codigo, nombre: c.nombre, unidad_fisica: c.unidad_fisica,
                factor_fisico: String(c.factor_fisico_kgco2e ?? ''),
                factor_gasto: String(c.factor_gasto_kgco2e_clp1000),
                palabras: (c.palabras_clave || []).join(', '),
                fuente: c.fuente || '', activo: c.activo,
              })}>Editar</button>
          </div>
        ))}
        {categorias.length === 0 && <p className="muted">Sin categorías cargadas.</p>}
      </div>

      {edit && (
        <div className="modal-bg" onClick={(e) => e.target.className === 'modal-bg' && setEdit(null)}>
          <div className="modal" style={{ maxWidth: 480 }}>
            <h2 style={{ marginTop: 0 }}>{edit.nombre}</h2>
            <div className="field"><label>Nombre</label>
              <input value={edit.nombre} onChange={(e) => setEdit({ ...edit, nombre: e.target.value })} /></div>
            {edit.unidad_fisica && (
              <div className="field"><label>Factor físico (kgCO2e / {edit.unidad_fisica})</label>
                <input value={edit.factor_fisico} onChange={(e) => setEdit({ ...edit, factor_fisico: e.target.value.replace(/[^\d.,]/g, '').replace(',', '.') })} /></div>
            )}
            <div className="field"><label>Factor por gasto (kgCO2e / $1.000 CLP)</label>
              <input value={edit.factor_gasto} onChange={(e) => setEdit({ ...edit, factor_gasto: e.target.value.replace(/[^\d.,]/g, '').replace(',', '.') })} /></div>
            <div className="field"><label>Palabras clave (separadas por coma)</label>
              <input value={edit.palabras} onChange={(e) => setEdit({ ...edit, palabras: e.target.value })} /></div>
            <div className="field"><label>Fuente</label>
              <input value={edit.fuente} onChange={(e) => setEdit({ ...edit, fuente: e.target.value })} /></div>
            <div className="field" style={{ marginBottom: 14 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500 }}>
                <input type="checkbox" checked={edit.activo} onChange={(e) => setEdit({ ...edit, activo: e.target.checked })} style={{ width: 'auto' }} /> Activa
              </label>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={() => setEdit(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={guardar}>Guardar</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}
    </div>
  );
}
