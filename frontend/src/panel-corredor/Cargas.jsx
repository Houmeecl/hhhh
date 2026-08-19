import { useEffect, useState } from 'react';
import { apiCorredor } from './api.js';

const SEMAFORO = { verde: 'badge-green', amarillo: 'badge-amber', rojo: 'badge-red', gris: 'badge-gray' };
const NOMBRE_REGIMEN = { eudr: 'EUDR', cbam: 'CBAM', exportacion: 'Exportación' };
const VACIO = {
  codigo_nc: '', descripcion: '', cantidad: '', unidad: 't', pais_origen: 'BR', region_origen: '',
  instalacion: '', emisiones_directas_tco2e_t: '', emisiones_indirectas_tco2e_t: '', metodo_emisiones: '',
};

// Alta de cargas. La pregunta que va PRIMERO es el código arancelario:
// no es un campo más, es el que decide qué régimen aplica y por lo tanto
// qué se pregunta después. Preguntarlo primero es la única forma de no
// pedirle las coordenadas de sus predios a un exportador de cátodos.
export default function Cargas() {
  const [cargas, setCargas] = useState(null);
  const [form, setForm] = useState(VACIO);
  const [creando, setCreando] = useState(false);
  const [detalle, setDetalle] = useState(null);
  const [toast, setToast] = useState(null);
  const flash = (msg, err = false) => { setToast({ msg, err }); setTimeout(() => setToast(null), 4500); };

  const cargar = () => apiCorredor.cargas().then((r) => setCargas(r.cargas)).catch((e) => flash(e.message, true));
  useEffect(() => { cargar(); }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function crear() {
    setCreando(true);
    try {
      const r = await apiCorredor.crearCarga({
        codigo_nc: form.codigo_nc || null,
        descripcion: form.descripcion,
        cantidad: Number(form.cantidad),
        unidad: form.unidad,
        pais_origen: form.pais_origen.toUpperCase(),
        region_origen: form.region_origen || null,
        instalacion: form.instalacion || null,
        emisiones_directas_tco2e_t: form.emisiones_directas_tco2e_t === '' ? null : Number(form.emisiones_directas_tco2e_t),
        emisiones_indirectas_tco2e_t: form.emisiones_indirectas_tco2e_t === '' ? null : Number(form.emisiones_indirectas_tco2e_t),
        metodo_emisiones: form.metodo_emisiones || null,
      });
      setForm(VACIO);
      flash(`Carga ${r.carga.codigo} creada. ${r.exportacion.glosa}`);
      cargar();
    } catch (e) { flash(e.message, true); } finally { setCreando(false); }
  }

  // Lo que el formulario pregunta depende del código: sin él no se sabe,
  // y con él se sabe exactamente qué exige el régimen.
  const nc = form.codigo_nc.replace(/\D/g, '');
  const pareceCbam = nc && ['2523', '2716', '2804', '2808', '2814', '3102', '3105', '72', '73', '76'].some((c) => nc.startsWith(c));

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Cargas</h1>

      <div className="card card-pad" style={{ maxWidth: 660, marginBottom: 22 }}>
        <h3 style={{ marginTop: 0 }}>Nueva carga</h3>

        <div className="field">
          <label>Código arancelario</label>
          <input value={form.codigo_nc} onChange={set('codigo_nc')} placeholder="1201" maxLength={8} />
          <div className="muted" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.5 }}>
            Es lo primero por una razón: decide qué régimen le aplica a esta carga y, con eso, qué
            evidencia se le va a exigir. Sin él no se puede saber.
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          <div className="field"><label>Descripción</label>
            <input value={form.descripcion} onChange={set('descripcion')} placeholder="Soya a granel" /></div>
          <div className="field"><label>Cantidad</label>
            <input inputMode="decimal" value={form.cantidad} onChange={set('cantidad')} placeholder="500" /></div>
          <div className="field"><label>Unidad</label>
            <select value={form.unidad} onChange={set('unidad')}><option value="t">t</option><option value="kg">kg</option></select></div>
          <div className="field"><label>País de origen (ISO-2)</label>
            <input value={form.pais_origen} maxLength={2} onChange={(e) => setForm((f) => ({ ...f, pais_origen: e.target.value.toUpperCase() }))} /></div>
          <div className="field"><label>Región de origen</label>
            <input value={form.region_origen} onChange={set('region_origen')} placeholder="Mato Grosso" /></div>
        </div>

        {/* Los cinco de CBAM solo se piden si el código cae en su anexo.
            Mostrarlos siempre haría que un exportador de soya buscara
            emisiones incorporadas que su régimen no le pide. */}
        {pareceCbam && (
          <div style={{ borderTop: '1px dashed var(--line)', paddingTop: 14, marginTop: 4 }}>
            <div className="badge badge-amber" style={{ marginBottom: 10 }}>Este código está en el anexo de CBAM</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
              <div className="field"><label>Instalación de origen</label>
                <input value={form.instalacion} onChange={set('instalacion')} placeholder="Fundición Ejemplo" /></div>
              <div className="field"><label>Emisiones directas (t CO₂e/t)</label>
                <input inputMode="decimal" value={form.emisiones_directas_tco2e_t} onChange={set('emisiones_directas_tco2e_t')} /></div>
              <div className="field"><label>Emisiones indirectas (t CO₂e/t)</label>
                <input inputMode="decimal" value={form.emisiones_indirectas_tco2e_t} onChange={set('emisiones_indirectas_tco2e_t')} />
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Este dato lo tiene tu proveedor de electricidad, no tu contabilidad.</div>
              </div>
              <div className="field"><label>Método</label>
                <select value={form.metodo_emisiones} onChange={set('metodo_emisiones')}>
                  <option value="">—</option>
                  <option value="valores_reales">Valores reales</option>
                  <option value="valores_defecto">Valores por defecto</option>
                  <option value="mixto">Mixto</option>
                </select></div>
            </div>
          </div>
        )}

        <button className="btn btn-primary" style={{ width: '100%', marginTop: 8 }}
          onClick={crear} disabled={creando || !form.descripcion || !form.cantidad}>
          {creando ? <span className="spinner" /> : 'Crear carga'}
        </button>
      </div>

      {!cargas ? <div className="muted"><span className="spinner" /> Cargando…</div> : (
        <div className="card">
          <div className="table-scroll">
            <table className="data">
              <thead><tr><th>Carga</th><th>Régimen</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                {cargas.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <b style={{ fontFamily: 'monospace' }}>{c.codigo}</b>
                      <div className="muted" style={{ fontSize: 12 }}>{c.descripcion} · {Number(c.cantidad)} {c.unidad} · {c.pais_origen}</div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {c.exportacion.regimenes.length
                        ? c.exportacion.regimenes.map((r) => <span key={r} className="badge badge-gray" style={{ marginRight: 4 }}>{NOMBRE_REGIMEN[r]}</span>)
                        : <span className="badge badge-gray">Sin determinar</span>}
                    </td>
                    <td>
                      <span className={`badge ${SEMAFORO[c.exportacion.semaforo]}`}>{c.exportacion.glosa}</span>
                    </td>
                    <td>
                      <button className="btn btn-outline btn-sm"
                        onClick={() => apiCorredor.carga(c.id).then(setDetalle).catch((e) => flash(e.message, true))}>
                        Ver y completar
                      </button>
                    </td>
                  </tr>
                ))}
                {cargas.length === 0 && (
                  <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: 28 }}>
                    Todavía no hay cargas.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {detalle && (
        <Detalle
          d={detalle}
          flash={flash}
          onCambio={() => apiCorredor.carga(detalle.carga.id).then((r) => { setDetalle(r); cargar(); })}
          onClose={() => setDetalle(null)}
        />
      )}
      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}
    </div>
  );
}

// Qué falta, quién lo aporta y qué pasa si no llega — y desde acá se
// completa. Antes solo mostraba: los predios y la producción se leían pero
// no había forma de cargarlos, así que el EUDR no se podía cumplir desde el
// producto por más que la pantalla dijera qué faltaba.
//
// Lo urgente se ordena por CONSECUENCIA y no por cantidad: una prohibición
// de entrada (EUDR) pesa más que un sobrecosto (CBAM).
function Detalle({ d, flash, onCambio, onClose }) {
  const e = d.exportacion;
  const [disponibles, setDisponibles] = useState([]);
  const [elegida, setElegida] = useState('');
  const [aporte, setAporte] = useState('100');
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    apiCorredor.parcelas().then((r) => setDisponibles(r.parcelas)).catch(() => {});
  }, []);

  const yaEnlazadas = new Set(d.parcelas.map((p) => p.id));
  const porEnlazar = disponibles.filter((p) => !yaEnlazadas.has(p.id));

  async function enlazar() {
    setOcupado(true);
    try {
      await apiCorredor.enlazarParcela(d.carga.id, { parcela_id: elegida, aporte_pct: Number(aporte) });
      setElegida('');
      onCambio();
    } catch (err) { flash(err.message, true); } finally { setOcupado(false); }
  }

  async function soltar(parcelaId) {
    try { await apiCorredor.soltarParcela(d.carga.id, parcelaId); onCambio(); }
    catch (err) { flash(err.message, true); }
  }

  return (
    <div className="modal-bg" onClick={(ev) => ev.target.className === 'modal-bg' && onClose()}>
      <div className="modal" style={{ maxWidth: 640, maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ marginTop: 0, fontFamily: 'monospace' }}>{d.carga.codigo}</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>{e.por_que}</p>

        {e.urgencia && (
          <div className={`badge ${e.urgencia.consecuencia.tipo === 'prohibicion' ? 'badge-red' : 'badge-amber'}`}
            style={{ display: 'block', padding: 12, margin: '10px 0', fontSize: 13, lineHeight: 1.5 }}>
            {e.urgencia.consecuencia.texto}
          </div>
        )}
        {e.listo && (
          <div className="badge badge-green" style={{ display: 'block', padding: 12, margin: '10px 0', fontSize: 13 }}>
            {e.glosa}
          </div>
        )}

        {e.bloques.map((b) => (
          <div key={b.regimen || 'sin'} style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 15, margin: '0 0 8px' }}>
              {NOMBRE_REGIMEN[b.regimen] || 'Falta declarar el código'} — {b.cumplidos} de {b.total}
            </h3>
            <div className="table-scroll">
              <table className="data">
                <tbody>
                  {b.requisitos.map((r) => (
                    <tr key={r.campo}>
                      <td style={{ width: 26 }}>
                        <span className={`badge ${r.cumplido ? 'badge-green' : 'badge-red'}`} style={{ padding: '2px 7px' }}>
                          {r.cumplido ? '·' : '!'}
                        </span>
                      </td>
                      <td>
                        <b style={{ fontSize: 13.5 }}>{r.etiqueta}</b>
                        <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{r.como_se_obtiene}</div>
                      </td>
                      <td className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{r.quien}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        {/* ---------- Predios de origen ---------- */}
        <h3 style={{ fontSize: 15, margin: '18px 0 8px' }}>Predios de origen</h3>
        {d.parcelas.length === 0
          ? <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>Ninguno enlazado todavía.</p>
          : (
            <div className="table-scroll">
              <table className="data">
                <tbody>
                  {d.parcelas.map((p) => (
                    <tr key={p.id}>
                      <td><b style={{ fontSize: 13.5 }}>{p.nombre}</b>
                        <div className="muted" style={{ fontSize: 12 }}>{p.pais}{p.region ? ` · ${p.region}` : ''} · nivel {p.nivel_confianza} {p.nombre_nivel}</div></td>
                      <td style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{Number(p.aporte_pct)}%</td>
                      <td><button className="btn btn-outline btn-sm" onClick={() => soltar(p.id)}>Soltar</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

        {porEnlazar.length > 0 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 10, flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: '1 1 200px', marginBottom: 0 }}>
              <label>Enlazar un predio</label>
              <select value={elegida} onChange={(ev) => setElegida(ev.target.value)}>
                <option value="">Elige un predio…</option>
                {porEnlazar.map((p) => <option key={p.id} value={p.id}>{p.nombre} — nivel {p.nivel_confianza}</option>)}
              </select>
            </div>
            <div className="field" style={{ width: 110, marginBottom: 0 }}>
              <label>Aporte %</label>
              <input inputMode="decimal" value={aporte} onChange={(ev) => setAporte(ev.target.value)} />
            </div>
            <button className="btn btn-primary btn-sm" onClick={enlazar} disabled={ocupado || !elegida}>Enlazar</button>
          </div>
        )}
        {porEnlazar.length === 0 && d.parcelas.length === 0 && (
          <p className="muted" style={{ fontSize: 13 }}>
            Todavía no tienes predios registrados. Ve a la pestaña <b>Predios</b> e importa el archivo del catastro.
          </p>
        )}

        <Produccion d={d} flash={flash} onCambio={onCambio} />

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
          <button className="btn btn-outline" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

// Los otros requisitos del EUDR. sicr3p NO determina si un predio fue
// deforestado: eso exige análisis de imágenes satelitales. Se registra la
// determinación que hizo un tercero, y por eso el emisor es obligatorio
// cuando se marca la casilla — un "sí" suelto sería la declaración sin
// respaldo que este producto existe para evitar.
function Produccion({ d, flash, onCambio }) {
  const p = d.produccion;
  const [f, setF] = useState({
    desde: p?.desde || '', hasta: p?.hasta || '',
    libre_deforestacion_declarado: p?.libre_deforestacion_declarado === true,
    legalidad_declarada: p?.legalidad_declarada === true,
    determinacion_emisor: p?.determinacion_emisor || '',
    determinacion_linea_base: p?.determinacion_linea_base || '',
    determinacion_at: p?.determinacion_at || '',
  });
  const [guardando, setGuardando] = useState(false);
  const set = (k) => (ev) => setF((x) => ({ ...x, [k]: ev.target.value }));

  async function guardar() {
    setGuardando(true);
    try {
      await apiCorredor.guardarProduccion(d.carga.id, {
        ...f,
        determinacion_at: f.determinacion_at || null,
        desde: f.desde || null, hasta: f.hasta || null,
      });
      flash('Datos de producción guardados.');
      onCambio();
    } catch (err) { flash(err.message, true); } finally { setGuardando(false); }
  }

  const faltaEmisor = f.libre_deforestacion_declarado && !f.determinacion_emisor.trim();

  return (
    <>
      <h3 style={{ fontSize: 15, margin: '18px 0 8px' }}>Producción</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        <div className="field"><label>Producción desde</label>
          <input type="date" value={f.desde} onChange={set('desde')} /></div>
        <div className="field"><label>hasta</label>
          <input type="date" value={f.hasta} onChange={set('hasta')} /></div>
      </div>

      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13.5, marginBottom: 10, cursor: 'pointer' }}>
        <input type="checkbox" checked={f.libre_deforestacion_declarado} style={{ marginTop: 3 }}
          onChange={(ev) => setF((x) => ({ ...x, libre_deforestacion_declarado: ev.target.checked }))} />
        <span>Libre de deforestación posterior al 31-12-2020</span>
      </label>

      {f.libre_deforestacion_declarado && (
        <div style={{ borderLeft: '3px solid var(--corredor-accent, #28A745)', paddingLeft: 12, marginBottom: 12 }}>
          <p className="muted" style={{ fontSize: 12.5, margin: '0 0 8px', lineHeight: 1.5 }}>
            sicr3p no analiza imágenes satelitales. Registra la determinación que hizo otro: por eso
            hay que decir quién la emitió y contra qué línea base.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
            <div className="field"><label>Quién la emitió</label>
              <input value={f.determinacion_emisor} onChange={set('determinacion_emisor')} placeholder="Consultora Ejemplo" /></div>
            <div className="field"><label>Línea base</label>
              <input value={f.determinacion_linea_base} onChange={set('determinacion_linea_base')} placeholder="MapBiomas 2020" /></div>
            <div className="field"><label>Fecha</label>
              <input type="date" value={f.determinacion_at || ''} onChange={set('determinacion_at')} /></div>
          </div>
        </div>
      )}

      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13.5, marginBottom: 12, cursor: 'pointer' }}>
        <input type="checkbox" checked={f.legalidad_declarada} style={{ marginTop: 3 }}
          onChange={(ev) => setF((x) => ({ ...x, legalidad_declarada: ev.target.checked }))} />
        <span>Producción conforme a la legislación del país (tenencia de la tierra, ambiental, laboral, tributaria)</span>
      </label>

      <button className="btn btn-primary btn-sm" onClick={guardar} disabled={guardando || faltaEmisor}>
        {guardando ? <span className="spinner" /> : 'Guardar producción'}
      </button>
      {faltaEmisor && (
        <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
          Falta decir quién hizo la determinación de deforestación.
        </div>
      )}
    </>
  );
}
