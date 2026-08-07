import { useEffect, useState } from 'react';
import { api, fmt } from '../api.js';
import { Icon } from '../components/icons.jsx';

// Motor propio de cálculo — independiente del motor externo.
// Cubre DTE XML (datos reales), PDF con texto extraíble y también imágenes vía OCR;
// solo los documentos que no se pueden procesar localmente van al motor externo.
export default function MotorPropio() {
  const [categorias, setCategorias] = useState([]);
  const [stats, setStats] = useState(null);
  const [versiones, setVersiones] = useState([]);
  const [propuestas, setPropuestas] = useState([]);
  const [fuentes, setFuentes] = useState([]);
  const [editFuente, setEditFuente] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const [edit, setEdit] = useState(null);
  const [toast, setToast] = useState(null);
  const flash = (msg, err = false) => { setToast({ msg, err }); setTimeout(() => setToast(null), 3500); };

  const cargar = () => Promise.all([
    api.motorCategorias(), api.motorEstadisticas(), api.motorVersiones(), api.motorPropuestas(), api.motorFuentes(),
  ])
    .then(([c, s, v, p, f]) => {
      setCategorias(c.categorias); setStats(s);
      setVersiones(v.versiones || []); setPropuestas(p.propuestas || []);
      setFuentes(f.fuentes || []);
    })
    .catch((e) => flash(e.message, true));
  useEffect(() => { cargar(); }, []);

  async function guardarFuente() {
    try {
      await api.guardarFuenteMotor(editFuente.id, {
        url: editFuente.url.trim() || null,
        version_anio: editFuente.version_anio.trim() || null,
        notas: editFuente.notas.trim() || null,
      });
      setEditFuente(null); cargar(); flash('Fuente actualizada.');
    } catch (e) { flash(e.message, true); }
  }

  async function marcarOficial(f) {
    if (!window.confirm(`¿Confirmas que tienes descargada la edición vigente de "${f.organismo} — ${f.documento}" (${f.version_anio || 'sin año'})? Solo marca oficial si ya la revisaste.`)) return;
    try {
      await api.guardarFuenteMotor(f.id, { estado: 'validada_oficial' });
      cargar(); flash(`"${f.documento}" marcada como validada oficial.`);
    } catch (e) { flash(e.message, true); }
  }

  // Dispara la búsqueda de fuentes. Puede tardar: la IA hace varias
  // búsquedas web antes de responder, por eso el botón queda deshabilitado
  // con su propio texto en vez de un spinner suelto.
  async function buscarActuales() {
    setBuscando(true);
    try {
      const r = await api.buscarFactoresActuales();
      await cargar();
      const n = (r.propuestas || []).length;
      flash(n === 0
        ? 'Sin cambios: los factores vigentes coinciden con lo publicado.'
        : `${n} propuesta${n === 1 ? '' : 's'} para revisar.`);
    } catch (e) { flash(e.message, true); } finally { setBuscando(false); }
  }

  async function resolver(p, aprobar) {
    const verbo = aprobar ? 'Aprobar' : 'Descartar';
    const motivo = window.prompt(`${verbo} la propuesta para ${p.categoria_codigo}. Motivo (queda registrado):`, '');
    if (motivo === null) return;
    try {
      if (aprobar) await api.aprobarPropuestaFactor(p.id, motivo);
      else await api.descartarPropuestaFactor(p.id, motivo);
      await cargar();
      flash(aprobar ? 'Propuesta aprobada: se congeló una versión nueva del motor.' : 'Propuesta descartada.');
    } catch (e) { flash(e.message, true); }
  }

  async function guardar() {
    try {
      await api.guardarCategoriaMotor(edit.codigo, {
        nombre: edit.nombre,
        alcance_ghg: edit.alcance_ghg.trim() || null,
        factor_fisico_kgco2e: edit.unidad_fisica ? (parseFloat(edit.factor_fisico) || 0) : null,
        factor_gasto_kgco2e_clp1000: parseFloat(edit.factor_gasto) || 0,
        palabras_clave: edit.palabras.split(',').map((s) => s.trim()).filter(Boolean),
        fuente: edit.fuente,
        activo: edit.activo,
        nota_version: edit.nota_version,
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
            Cálculo determinista de CO2e a partir de los datos de cada documento: DTE XML (cantidad, unidad, monto),
            PDF con texto e imágenes vía OCR. Solo los documentos no procesables localmente usan el motor externo.
          </p>
        </div>
      </div>

      {stats && (() => {
        const propio = stats.propio || 0;
        const propioTexto = stats.propio_texto || 0;
        const propioOcr = stats.propio_ocr || 0;
        const propioIA = stats.propio_ia || 0;
        const externo = stats.externo || 0;
        const total = stats.total || 0;
        const independientes = propio + propioTexto + propioOcr + propioIA;
        const pct = total > 0 ? (independientes / total) * 100 : 0;
        const filas = [
          ['DTE XML (propio)', propio],
          ['Texto/OCR vía IA (propio)', propioIA],
          ['PDF texto — respaldo reglas (propio)', propioTexto],
          ['Imagen/escaneo — respaldo reglas (propio)', propioOcr],
          ['Motor externo', externo],
        ];
        const ia = stats.analisis_ia || {};
        const rechazados = stats.rechazados_total || 0;
        const etapas = Object.entries(stats.rechazos_por_etapa || {});
        return (
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
            <div className="card card-pad" style={{ maxWidth: 420, flex: '1 1 300px' }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--green-600)' }}>{fmt(pct, 1)}%</div>
              <div className="muted" style={{ fontSize: 13 }}>
                de independencia del motor externo ({independientes} de {total} facturas con cálculo propio)
              </div>
              <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                {filas.map(([etiqueta, n]) => (
                  <div key={etiqueta} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0' }}>
                    <span className="muted">{etiqueta}</span>
                    <b>{n}</b>
                  </div>
                ))}
              </div>
            </div>
            <div className="card card-pad" style={{ maxWidth: 420, flex: '1 1 300px' }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: rechazados > 0 ? '#b45309' : 'var(--green-600)' }}>
                {fmt(stats.tasa_rechazo || 0, 1)}%
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                tasa de rechazo por lectura ({rechazados} documento{rechazados === 1 ? '' : 's'} ilegible{rechazados === 1 ? '' : 's'},{' '}
                {stats.rechazados_30d || 0} en 30 días)
              </div>
              <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                {etapas.length === 0 && <div className="muted" style={{ fontSize: 13 }}>Sin rechazos registrados.</div>}
                {etapas.map(([etapa, n]) => (
                  <div key={etapa} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0' }}>
                    <span className="muted">Etapa alcanzada: {etapa}</span>
                    <b>{n}</b>
                  </div>
                ))}
              </div>
            </div>
            <div className="card card-pad" style={{ maxWidth: 420, flex: '1 1 300px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className={`badge ${stats.analisis_ia_activo ? 'badge-green' : 'badge-gray'}`}>
                  {stats.analisis_ia_activo ? 'Activo' : 'Inactivo'}
                </span>
                <span style={{ fontSize: 14, fontWeight: 700 }}>Análisis con IA</span>
              </div>
              <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                Lee texto/OCR con más flexibilidad que las reglas — solo extrae y clasifica; el cálculo de CO2e
                sigue siendo 100% del motor propio. Si no está configurado o falla, se usa el respaldo de reglas.
              </div>
              <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0' }}>
                  <span className="muted">Llamadas (30 días)</span>
                  <b>{ia.llamadas_30d || 0}</b>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0' }}>
                  <span className="muted">Exitosas</span>
                  <b>{ia.exitosas_30d || 0}</b>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0' }}>
                  <span className="muted">Latencia promedio</span>
                  <b>{ia.latencia_prom_ms != null ? `${ia.latencia_prom_ms} ms` : '—'}</b>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0' }}>
                  <span className="muted">Costo estimado (30 días)</span>
                  <b>${fmt(ia.costo_estimado_clp_30d || 0, 0)} CLP</b>
                </div>
              </div>
            </div>
            <div className="card card-pad" style={{ maxWidth: 420, flex: '1 1 300px' }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--green-600)' }}>
                {stats.metodo_fisico_pct != null ? `${fmt(stats.metodo_fisico_pct, 1)}%` : '—'}
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                de los ítems calculados por método físico (cantidad × factor), no por gasto (monto × factor) —
                el piso metodológico cuando no hay unidad confiable.
              </div>
              <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0' }}>
                  <span className="muted">Método físico</span>
                  <b>{stats.metodo_fisico_pct != null ? `${fmt(stats.metodo_fisico_pct, 1)}%` : '—'}</b>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0' }}>
                  <span className="muted">Por gasto</span>
                  <b>{stats.metodo_gasto_pct != null ? `${fmt(stats.metodo_gasto_pct, 1)}%` : '—'}</b>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Fuentes que cita el motor (motor_categorias.fuente_metodologica_id).
          "Validada oficial" es una firma humana, no algo que el sistema
          verifique solo: por eso el botón pide confirmar antes de marcar. */}
      <div style={{ marginTop: 8, marginBottom: 32 }}>
        <h2 style={{ marginBottom: 4, fontSize: 18 }}>Fuentes metodológicas</h2>
        <p className="muted" style={{ margin: '0 0 12px', fontSize: 13, maxWidth: 640 }}>
          Los factores del motor citan estas fuentes. "Avalada referencial" es el estado inicial;
          "Validada oficial" la marca quien confirmó que tiene la edición vigente del documento.
        </p>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr><th>Organismo</th><th>Documento</th><th>Edición</th><th>Estado</th><th style={{ textAlign: 'right' }}>Categorías</th><th></th></tr>
            </thead>
            <tbody>
              {fuentes.map((f) => (
                <tr key={f.id}>
                  <td>{f.organismo}</td>
                  <td>{f.documento}</td>
                  <td className="muted">{f.version_anio || '—'}</td>
                  <td><span className={`badge ${f.estado === 'validada_oficial' ? 'badge-green' : 'badge-gray'}`}>{f.estado === 'validada_oficial' ? 'Validada oficial' : 'Avalada referencial'}</span></td>
                  <td style={{ textAlign: 'right' }}>{f.n_categorias}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-outline btn-sm" onClick={() => setEditFuente({ id: f.id, url: f.url || '', version_anio: f.version_anio || '', notas: f.notas || '' })}>Editar</button>{' '}
                    {f.estado !== 'validada_oficial' && (
                      <button className="btn btn-primary btn-sm" onClick={() => marcarOficial(f)}>Marcar oficial</button>
                    )}
                  </td>
                </tr>
              ))}
              {fuentes.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 20 }}>Sin fuentes cargadas.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
        {categorias.map((c) => (
          <div className="card card-pad" key={c.codigo}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <b style={{ fontSize: 16 }}>{c.nombre}</b>
              <span className={`badge ${c.activo ? 'badge-green' : 'badge-gray'}`}>{c.activo ? 'Activa' : 'Inactiva'}</span>
            </div>
            {c.alcance_ghg && (
              <div style={{ marginTop: 6 }}>
                <span className="badge badge-gray" style={{ fontSize: 11 }}>{c.alcance_ghg}</span>
              </div>
            )}
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
                codigo: c.codigo, nombre: c.nombre, alcance_ghg: c.alcance_ghg || '', unidad_fisica: c.unidad_fisica,
                factor_fisico: String(c.factor_fisico_kgco2e ?? ''),
                factor_gasto: String(c.factor_gasto_kgco2e_clp1000),
                palabras: (c.palabras_clave || []).join(', '),
                fuente: c.fuente || '', activo: c.activo, nota_version: '',
              })}>Editar</button>
          </div>
        ))}
        {categorias.length === 0 && <p className="muted">Sin categorías cargadas.</p>}
      </div>

      {/* «Actualizar»: la IA busca la versión vigente de las fuentes ya
          declaradas y propone. Nada entra al motor sin aprobación humana. */}
      <div style={{ marginTop: 32 }}>
        <div className="admin-head" style={{ marginBottom: 8 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>Actualización de fuentes</h2>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 13, maxWidth: 640 }}>
              Busca en las publicaciones de los organismos que ya cita la metodología (MMA HuellaChile,
              IPCC, DEFRA, GLEC, GHG Protocol) si algún factor quedó atrás. <b>Solo propone</b>: el
              cálculo lo sigue haciendo el motor determinista, y ningún factor cambia hasta que alguien
              lo aprueba acá con la fuente a la vista.
            </p>
          </div>
          <button className="btn btn-primary" onClick={buscarActuales} disabled={buscando}>
            {buscando ? 'Buscando…' : 'Actualizar'}
          </button>
        </div>

        {propuestas.filter((p) => p.estado === 'pendiente').length === 0 && (
          <p className="muted" style={{ fontSize: 13 }}>Sin propuestas pendientes.</p>
        )}

        {propuestas.filter((p) => p.estado === 'pendiente').map((p) => (
          <div key={p.id} className="card" style={{ padding: 14, marginBottom: 10 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
              <b>{p.categoria_codigo}</b>
              <span className="badge badge-gray" style={{ fontSize: 11 }}>{p.campo}</span>
              <span style={{ fontSize: 14 }}>
                <span className="muted">{p.valor_actual ?? '—'}</span>
                {' → '}
                <b style={{ color: 'var(--green-600)' }}>{p.valor_propuesto}</b>
              </span>
            </div>
            <p style={{ fontSize: 13, margin: '8px 0 6px' }}>{p.justificacion}</p>
            <div style={{ fontSize: 12 }}>
              Fuente:{' '}
              <a href={p.fuente_url} target="_blank" rel="noopener noreferrer">
                {p.fuente_titulo || p.fuente_url}
              </a>
              {p.fuente_anio && <span className="muted"> ({p.fuente_anio})</span>}
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              Propuesta por {p.modelo}. Verifica la fuente antes de aprobar.
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button className="btn btn-primary btn-sm" onClick={() => resolver(p, true)}>Aprobar</button>
              <button className="btn btn-outline btn-sm" onClick={() => resolver(p, false)}>Descartar</button>
            </div>
          </div>
        ))}
      </div>

      {/* Historial de versiones — hace visible la garantía: cada informe cita
          los factores vigentes cuando se calculó, no los de hoy. */}
      {versiones.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <h2 style={{ marginBottom: 4, fontSize: 18 }}>Historial de factores</h2>
          <p className="muted" style={{ margin: '0 0 12px', fontSize: 13 }}>
            Cada edición congela una versión. Los informes ya emitidos siguen citando la
            versión con la que se calcularon: cambiar un factor hoy no altera un informe de ayer.
            Una versión emitida no se edita ni se borra.
          </p>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr><th>Versión</th><th>Fecha</th><th>Motivo</th><th>Quién</th><th style={{ textAlign: 'right' }}>Facturas</th></tr>
              </thead>
              <tbody>
                {versiones.map((v) => (
                  <tr key={v.id}>
                    <td><b>v{v.id}</b>{v.origen === 'semilla' && <span className="badge badge-gray" style={{ marginLeft: 6, fontSize: 11 }}>inicial</span>}</td>
                    <td>{new Date(v.creada_at).toLocaleDateString('es-CL')}</td>
                    <td style={{ maxWidth: 380 }}>{v.nota || '—'}</td>
                    <td className="muted">{v.creada_por_nombre || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{v.n_facturas}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editFuente && (
        <div className="modal-bg" onClick={(e) => e.target.className === 'modal-bg' && setEditFuente(null)}>
          <div className="modal" style={{ maxWidth: 440 }}>
            <h2 style={{ marginTop: 0 }}>Editar fuente</h2>
            <div className="field"><label>Edición / año</label>
              <input value={editFuente.version_anio} onChange={(e) => setEditFuente({ ...editFuente, version_anio: e.target.value })} placeholder="Ej: 2025" /></div>
            <div className="field"><label>URL oficial</label>
              <input value={editFuente.url} onChange={(e) => setEditFuente({ ...editFuente, url: e.target.value })} placeholder="https://..." /></div>
            <div className="field" style={{ marginBottom: 14 }}><label>Notas</label>
              <textarea rows={3} value={editFuente.notas} onChange={(e) => setEditFuente({ ...editFuente, notas: e.target.value })} /></div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={() => setEditFuente(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={guardarFuente}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      {edit && (
        <div className="modal-bg" onClick={(e) => e.target.className === 'modal-bg' && setEdit(null)}>
          <div className="modal" style={{ maxWidth: 480 }}>
            <h2 style={{ marginTop: 0 }}>{edit.nombre}</h2>
            <div className="field"><label>Nombre</label>
              <input value={edit.nombre} onChange={(e) => setEdit({ ...edit, nombre: e.target.value })} /></div>
            <div className="field"><label>Alcance GHG (ej: Alcance 2 — electricidad comprada)</label>
              <input value={edit.alcance_ghg} onChange={(e) => setEdit({ ...edit, alcance_ghg: e.target.value })} placeholder="Sin alcance asignado" /></div>
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
            <div className="field"><label>Motivo del cambio (queda en el historial)</label>
              <input value={edit.nota_version} placeholder="Ej: actualización del factor SEN publicado por el MMA"
                onChange={(e) => setEdit({ ...edit, nota_version: e.target.value })} /></div>
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
