import { useEffect, useState } from 'react';
import { api, fmt } from '../api.js';
import { Icon } from '../components/icons.jsx';

// Motor propio de cálculo — independiente del motor externo.
// Cubre DTE XML (datos reales), PDF con texto extraíble y también imágenes vía OCR;
// solo los documentos que no se pueden procesar localmente van al motor externo.
export default function MotorPropio() {
  const [categorias, setCategorias] = useState([]);
  const [stats, setStats] = useState(null);
  const [pendientes, setPendientes] = useState([]);
  const [edit, setEdit] = useState(null);
  const [rev, setRev] = useState(null); // documento de la cola en corrección
  const [toast, setToast] = useState(null);
  const flash = (msg, err = false) => { setToast({ msg, err }); setTimeout(() => setToast(null), 3500); };

  const cargar = () => Promise.all([api.motorCategorias(), api.motorEstadisticas(), api.motorRevision()])
    .then(([c, s, r]) => { setCategorias(c.categorias); setStats(s); setPendientes(r.pendientes || []); })
    .catch((e) => flash(e.message, true));
  useEffect(() => { cargar(); }, []);

  const itemRevVacio = () => ({ nombre: '', cantidad: '', unidad: '', monto: '' });

  async function confirmarRevision() {
    try {
      const items = rev.items
        .filter((it) => it.nombre.trim() || it.monto)
        .map((it) => ({
          nombre: it.nombre.trim(),
          cantidad: it.cantidad === '' ? null : parseFloat(String(it.cantidad).replace(',', '.')),
          unidad: it.unidad.trim() || null,
          monto: parseFloat(String(it.monto).replace(/\./g, '').replace(',', '.')) || 0,
        }));
      const r = await api.confirmarRevisionMotor(rev.id, {
        folio: rev.folio.trim() || null,
        rut_emisor: rev.rut_emisor.trim() || null,
        rut_receptor: rev.rut_receptor.trim() || null,
        items,
      });
      setRev(null); cargar();
      flash(`Documento confirmado: ${fmt(r.factura.total_co2e, 4)} t CO2e, ya encadenado.`);
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
        const propioRevisado = stats.propio_revisado || 0;
        const enRevision = stats.revision || 0;
        const externo = stats.externo || 0;
        const total = stats.total || 0;
        const independientes = propio + propioTexto + propioOcr + propioRevisado;
        const pct = total > 0 ? (independientes / total) * 100 : 0;
        const filas = [
          ['DTE XML (propio)', propio],
          ['PDF texto (propio)', propioTexto],
          ['Imagen/escaneo OCR (propio)', propioOcr],
          ['Revisión confirmada (propio)', propioRevisado],
          ['En cola de revisión', enRevision],
          ['Motor externo', externo],
        ];
        return (
          <div className="card card-pad" style={{ marginBottom: 18, maxWidth: 420 }}>
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
        );
      })()}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
        {pendientes.length > 0 && (
          <div className="card card-pad" style={{ gridColumn: '1 / -1', borderLeft: '4px solid #d97706' }}>
            <b style={{ fontSize: 15 }}>Cola de revisión — {pendientes.length} documento{pendientes.length === 1 ? '' : 's'}</b>
            <p className="muted" style={{ fontSize: 13, margin: '4px 0 10px' }}>
              Documentos sin datos extraíbles que quedaron esperando corrección humana
              (con el motor externo apagado, nada sale a terceros). Al confirmar, el motor
              propio calcula con tus datos y el documento recién ahí se encadena.
            </p>
            {pendientes.map((p) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '6px 0', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <b style={{ fontSize: 13 }}>{p.archivo_original}</b>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Sesión {p.sesion_id} · {p.rut_sesion || 'sin RUT'} · {new Date(p.created_at).toLocaleString('es-CL')}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-outline btn-sm" onClick={() => api.abrirArchivoRevision(p.id).catch((e) => flash(e.message, true))}>Ver archivo</button>
                  <button className="btn btn-primary btn-sm" onClick={() => setRev({
                    id: p.id, archivo: p.archivo_original, texto: p.texto_extraido || '',
                    folio: '', rut_emisor: p.rut_emisor || '', rut_receptor: p.rut_receptor || '',
                    items: [itemRevVacio()],
                  })}>Corregir y confirmar</button>
                </div>
              </div>
            ))}
          </div>
        )}
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
      {rev && (
        <div className="modal-bg" onClick={(e) => e.target.className === 'modal-bg' && setRev(null)}>
          <div className="modal" style={{ maxWidth: 640 }}>
            <h2 style={{ marginTop: 0, fontSize: 18 }}>Revisión: {rev.archivo}</h2>
            <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
              Ingresa lo que dice el documento. El CO2e lo calcula el motor propio con
              estos datos — el total no se tipea nunca a mano.
            </p>
            {rev.texto && (
              <details style={{ marginBottom: 10 }}>
                <summary style={{ cursor: 'pointer', fontSize: 13 }}>Texto que alcanzó a leer el motor</summary>
                <pre style={{ fontSize: 11, maxHeight: 140, overflow: 'auto', background: 'var(--bg)', padding: 8, borderRadius: 6, whiteSpace: 'pre-wrap' }}>{rev.texto}</pre>
              </details>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
              <div className="field"><label>Folio</label>
                <input value={rev.folio} onChange={(e) => setRev({ ...rev, folio: e.target.value })} placeholder="4521" /></div>
              <div className="field"><label>RUT emisor</label>
                <input value={rev.rut_emisor} onChange={(e) => setRev({ ...rev, rut_emisor: e.target.value })} placeholder="76.123.456-0" /></div>
              <div className="field"><label>RUT receptor</label>
                <input value={rev.rut_receptor} onChange={(e) => setRev({ ...rev, rut_receptor: e.target.value })} placeholder="11.111.111-1" /></div>
            </div>
            <label style={{ fontSize: 13, fontWeight: 600 }}>Ítems del documento</label>
            {rev.items.map((it, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 70px 70px 1fr 32px', gap: 6, marginTop: 6, alignItems: 'center' }}>
                <input placeholder="Descripción (ej: diésel grado B)" value={it.nombre}
                  onChange={(e) => setRev({ ...rev, items: rev.items.map((x, j) => j === i ? { ...x, nombre: e.target.value } : x) })} />
                <input placeholder="Cant." value={it.cantidad}
                  onChange={(e) => setRev({ ...rev, items: rev.items.map((x, j) => j === i ? { ...x, cantidad: e.target.value.replace(/[^\d.,]/g, '') } : x) })} />
                <input placeholder="Unidad" value={it.unidad}
                  onChange={(e) => setRev({ ...rev, items: rev.items.map((x, j) => j === i ? { ...x, unidad: e.target.value } : x) })} />
                <input placeholder="Monto CLP" value={it.monto}
                  onChange={(e) => setRev({ ...rev, items: rev.items.map((x, j) => j === i ? { ...x, monto: e.target.value.replace(/[^\d.,]/g, '') } : x) })} />
                <button className="btn btn-outline btn-sm" aria-label="Quitar ítem" disabled={rev.items.length === 1}
                  onClick={() => setRev({ ...rev, items: rev.items.filter((_, j) => j !== i) })}>×</button>
              </div>
            ))}
            <button className="btn btn-outline btn-sm" style={{ marginTop: 8 }}
              onClick={() => setRev({ ...rev, items: [...rev.items, itemRevVacio()] })}>+ Agregar ítem</button>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14 }}>
              <button className="btn btn-outline" onClick={() => setRev(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={confirmarRevision}>Calcular, encadenar y confirmar</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}
    </div>
  );
}
