import { useEffect, useState } from 'react';
import Icon from '../components/icons.jsx';
import Semaforo from './Semaforo.jsx';
import { apiCorredor } from './api.js';

const NOMBRE_REGIMEN = { eudr: 'EUDR', cbam: 'CBAM', exportacion: 'Exportación' };

// Cómo se nombra y cuánto pesa cada consecuencia. El `orden` no es
// cosmético: decide qué bloque se muestra primero y cuál se lleva la
// tarjeta grande. Una prohibición de entrada gana a un sobrecosto.
const CONSECUENCIA = {
  prohibicion: { orden: 0, clase: 'prohibicion', kicker: 'Prohibición de entrada' },
  sobrecosto: { orden: 1, clase: 'sobrecosto', kicker: 'Sobrecosto' },
  comercial: { orden: 2, clase: 'comercial', kicker: 'Lo pide el comprador' },
};
const pesoDe = (b) => CONSECUENCIA[b?.consecuencia?.tipo]?.orden ?? 3;

// Dónde, dentro de esta misma pantalla, se completa cada requisito que
// falta. Solo los que de verdad se pueden completar acá: prometer un lugar
// que no existe es peor que no decir nada.
const DONDE_SE_COMPLETA = {
  geolocalizacion: 'Predios de origen',
  fecha_produccion: 'Producción',
  libre_deforestacion: 'Producción',
  legalidad: 'Producción',
};

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
      <div className="cor-head">
        <h1>Cargas</h1>
        <p>
          Cada carga se evalúa contra el régimen que le corresponde según su código arancelario, y
          muestra qué evidencia falta antes de que salga.
        </p>
      </div>

      <div className="card card-pad cor-card cor-form">
        <h3 style={{ marginTop: 0 }}>Nueva carga</h3>

        <div className="field">
          <label htmlFor="nc">Código arancelario</label>
          <input id="nc" value={form.codigo_nc} onChange={set('codigo_nc')} placeholder="1201" maxLength={8} />
          <p className="cor-nota">
            Es lo primero por una razón: decide qué régimen le aplica a esta carga y, con eso, qué
            evidencia se le va a exigir. Sin él no se puede saber.
          </p>
        </div>

        <div className="cor-grid">
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
          <div className="cor-sec">
            <div className="cor-tag cor-tag-sobrecosto" style={{ marginBottom: 10 }}>Este código está en el anexo de CBAM</div>
            <div className="cor-grid">
              <div className="field"><label>Instalación de origen</label>
                <input value={form.instalacion} onChange={set('instalacion')} placeholder="Fundición Ejemplo" /></div>
              <div className="field"><label>Emisiones directas (t CO₂e/t)</label>
                <input inputMode="decimal" value={form.emisiones_directas_tco2e_t} onChange={set('emisiones_directas_tco2e_t')} /></div>
              <div className="field"><label>Emisiones indirectas (t CO₂e/t)</label>
                <input inputMode="decimal" value={form.emisiones_indirectas_tco2e_t} onChange={set('emisiones_indirectas_tco2e_t')} />
                <p className="cor-nota">Este dato lo tiene tu proveedor de electricidad, no tu contabilidad.</p>
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

        <button className="btn btn-primary" style={{ width: '100%', marginTop: 16 }}
          onClick={crear} disabled={creando || !form.descripcion || !form.cantidad}>
          {creando ? <span className="spinner" /> : 'Crear carga'}
        </button>
      </div>

      {!cargas ? <div className="muted"><span className="spinner dark" /> Cargando…</div> : (
        <div className="card">
          <div className="table-scroll">
            <table className="data">
              <thead><tr><th>Carga</th><th>Régimen</th><th>Estado</th><th /></tr></thead>
              <tbody>
                {cargas.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <b className="mono">{c.codigo}</b>
                      <div className="muted" style={{ fontSize: 12 }}>{c.descripcion} · {Number(c.cantidad)} {c.unidad} · {c.pais_origen}</div>
                    </td>
                    {/* Chip rectangular, no píldora: el régimen y el semáforo
                        viven en la misma fila y antes eran los dos una
                        píldora gris. */}
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {c.exportacion.regimenes.length
                        ? c.exportacion.regimenes.map((r) => <span key={r} className="cor-regimen">{NOMBRE_REGIMEN[r]}</span>)
                        : <span className="cor-regimen cor-regimen-indef">Sin determinar</span>}
                    </td>
                    <td><Semaforo estado={c.exportacion.semaforo}>{c.exportacion.glosa}</Semaforo></td>
                    <td>
                      <button className="btn btn-outline btn-sm"
                        onClick={() => apiCorredor.carga(c.id).then(setDetalle).catch((e) => flash(e.message, true))}>
                        Ver y completar
                      </button>
                    </td>
                  </tr>
                ))}
                {cargas.length === 0 && (
                  <tr><td colSpan={4} className="muted cor-vacio">Todavía no hay cargas.</td></tr>
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

// ---------- Lo primero que se ve al abrir una carga ----------
//
// Una sola tarjeta, la de la consecuencia más grave que sigue pendiente.
// Prohibición y sobrecosto no se muestran con el mismo peso: "no vas a
// poder vender" y "te va a salir más caro" no se atienden igual, y hasta
// ahora los dos eran la misma caja con distinto color de fondo.
function Consecuencia({ e }) {
  if (e.listo) {
    return (
      <div className="cor-consec cor-consec-listo">
        <div className="cor-consec-kicker"><Icon.CheckCircle size={14} /> Sin pendientes</div>
        <div className="cor-consec-titulo">{e.glosa}</div>
        <p>Descarga el pasaporte: es la evidencia con la que esta carga llega a su destino.</p>
      </div>
    );
  }
  if (e.listo === null) {
    return (
      <div className="cor-consec cor-consec-indef">
        <div className="cor-consec-kicker"><Icon.Info size={14} /> Sin determinar</div>
        <div className="cor-consec-titulo">Falta declarar el código arancelario</div>
        <p>{e.por_que}</p>
      </div>
    );
  }
  const u = e.urgencia;
  if (!u) return null;
  const cfg = CONSECUENCIA[u.consecuencia?.tipo] || CONSECUENCIA.comercial;
  const n = u.faltantes.length;
  return (
    <div className={`cor-consec cor-consec-${cfg.clase}`}>
      <div className="cor-consec-kicker">
        {cfg.clase === 'prohibicion' ? <Icon.Alert size={14} /> : <Icon.Info size={14} />} {cfg.kicker}
      </div>
      <div className="cor-consec-titulo">
        Falta{n === 1 ? '' : 'n'} {n} {n === 1 ? 'dato' : 'datos'} de {NOMBRE_REGIMEN[u.regimen] || 'esta carga'}
      </div>
      <p>{u.consecuencia?.texto}</p>
    </div>
  );
}

function Requisito({ r, severidad }) {
  const donde = !r.cumplido && DONDE_SE_COMPLETA[r.campo];
  return (
    <li>
      <span className={`cor-req-ico cor-req-ico-${severidad}`}>
        {severidad === 'ok' ? <Icon.Check size={13} /> : <Icon.Alert size={13} />}
      </span>
      <div className="cor-req-cuerpo">
        <b>{r.etiqueta}</b>
        <small>{r.como_se_obtiene}</small>
        <div className="cor-req-meta">
          <span>Lo aporta: {r.quien}</span>
          {donde && <span className="cor-req-donde">Se completa abajo, en «{donde}»</span>}
        </div>
      </div>
    </li>
  );
}

// Un régimen y sus requisitos. Lo que FALTA va desplegado; lo que ya está
// se pliega — nadie abre esta pantalla para releer lo que ya entregó.
function Bloque({ b }) {
  const cfg = CONSECUENCIA[b.consecuencia?.tipo];
  const faltan = b.requisitos.filter((r) => !r.cumplido);
  const cumplidos = b.requisitos.filter((r) => r.cumplido);
  const severidad = cfg?.clase === 'prohibicion' ? 'alto' : 'medio';

  return (
    <div className="cor-bloque">
      <div className="cor-bloque-head">
        <h4>{NOMBRE_REGIMEN[b.regimen] || 'Régimen sin determinar'}</h4>
        {b.listo
          ? <span className="cor-tag cor-tag-ok"><Icon.Check size={12} /> Completo</span>
          : cfg && <span className={`cor-tag cor-tag-${cfg.clase}`}>{cfg.kicker}</span>}
        <span className="cor-bloque-cuenta">{b.cumplidos} de {b.total}</span>
      </div>
      {faltan.length > 0 && (
        <ul className="cor-req">
          {faltan.map((r) => <Requisito key={r.campo} r={r} severidad={severidad} />)}
        </ul>
      )}
      {cumplidos.length > 0 && (
        <details className="cor-plegable">
          <summary>
            {cumplidos.length === 1 ? 'Ver el dato que ya está' : `Ver los ${cumplidos.length} datos que ya están`}
          </summary>
          <ul className="cor-req">
            {cumplidos.map((r) => <Requisito key={r.campo} r={r} severidad="ok" />)}
          </ul>
        </details>
      )}
    </div>
  );
}

// Qué falta, quién lo aporta y qué pasa si no llega — y desde acá se
// completa. Antes solo mostraba: los predios y la producción se leían pero
// no había forma de cargarlos, así que el EUDR no se podía cumplir desde el
// producto por más que la pantalla dijera qué faltaba.
//
// Lo urgente se ordena por CONSECUENCIA y no por cantidad: una prohibición
// de entrada (EUDR) pesa más que un sobrecosto (CBAM). Ese orden ahora es
// literal — los bloques se ordenan así en pantalla.
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
  const bloques = [...e.bloques].sort((a, b) => (a.listo === b.listo ? pesoDe(a) - pesoDe(b) : (a.listo ? 1 : -1)));

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
      <div className="modal cor-modal">
        <div className="cor-modal-head">
          <div>
            <h2 className="mono">{d.carga.codigo}</h2>
            <p className="cor-nota" style={{ marginTop: 4 }}>{e.por_que}</p>
          </div>
          <Semaforo estado={e.semaforo}>{e.glosa}</Semaforo>
        </div>

        <Consecuencia e={e} />

        <h3 className="cor-sec-h"><Icon.List size={17} /> Qué exige esta carga</h3>
        <p className="cor-sec-sub">
          Primero el régimen que castiga más fuerte. Cada dato dice quién lo aporta.
        </p>
        {bloques.map((b) => <Bloque key={b.regimen || 'sin'} b={b} />)}

        {/* ---------- Predios de origen ---------- */}
        <div className="cor-sec">
          <h3 className="cor-sec-h"><Icon.Leaf size={17} /> Predios de origen</h3>
          <p className="cor-sec-sub">
            Dónde se produjo la carga. Es el requisito del EUDR que no se resuelve con papeles.
          </p>

          {d.parcelas.length === 0
            ? <p className="cor-nota" style={{ marginTop: 0 }}>Ninguno enlazado todavía.</p>
            : (
              <div className="table-scroll">
                <table className="data">
                  <tbody>
                    {d.parcelas.map((p) => (
                      <tr key={p.id}>
                        <td><b style={{ fontSize: 13.5 }}>{p.nombre}</b>
                          <div className="muted" style={{ fontSize: 12 }}>{p.pais}{p.region ? ` · ${p.region}` : ''} · nivel {p.nivel_confianza} {p.nombre_nivel}</div></td>
                        <td className="num" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{Number(p.aporte_pct)}%</td>
                        <td><button className="btn btn-outline btn-sm" onClick={() => soltar(p.id)}>Soltar</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

          {porEnlazar.length > 0 && (
            <div className="cor-fila" style={{ marginTop: 12 }}>
              <div className="field cor-fila-crece">
                <label>Enlazar un predio</label>
                <select value={elegida} onChange={(ev) => setElegida(ev.target.value)}>
                  <option value="">Elige un predio…</option>
                  {porEnlazar.map((p) => <option key={p.id} value={p.id}>{p.nombre} — nivel {p.nivel_confianza}</option>)}
                </select>
              </div>
              <div className="field" style={{ width: 110 }}>
                <label>Aporte %</label>
                <input inputMode="decimal" value={aporte} onChange={(ev) => setAporte(ev.target.value)} />
              </div>
              <button className="btn btn-primary btn-sm" onClick={enlazar} disabled={ocupado || !elegida}>Enlazar</button>
            </div>
          )}
          {porEnlazar.length === 0 && d.parcelas.length === 0 && (
            <div className="cor-aviso cor-aviso-neutro">
              <Icon.Info size={16} />
              <div>
                Todavía no tienes predios registrados. Ve a la pestaña <b>Predios</b> e importa el
                archivo del catastro.
              </div>
            </div>
          )}
        </div>

        <Tramo d={d} flash={flash} onCambio={onCambio} />

        <Produccion d={d} flash={flash} onCambio={onCambio} />

        <div className="cor-modal-pie">
          <button className="btn btn-outline"
            onClick={() => apiCorredor.pasaporte(d.carga.id, d.carga.codigo).catch((err) => flash(err.message, true))}>
            <Icon.Download size={16} /> Descargar pasaporte (PDF)
          </button>
          <button className="btn btn-outline" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

// ---------- El tramo y sus documentos ----------
//
// El tramo se define con dos puntos del catálogo, que son lugares fijos y
// públicos. De ahí salen los cruces de frontera, y de los cruces, qué
// documentos pide ESTE viaje: antes la lista era una sola para toda carga
// y por lo tanto no le decía nada a nadie.
//
// Lo que esta pantalla NO hace, y no va a hacer: mostrar dónde va la
// carga. La carga cruza cuatro países y un rastro en vivo es el mapa que
// necesita quien la quiera interceptar. Acá se dice por dónde VA A PASAR,
// que es algo que el exportador ya sabe antes de salir.
// El nombre legible del tipo de documento lo manda el backend
// (services/corredorTramo.js): un segundo mapa acá se separaría del de
// allá, y el PDF y la pantalla terminarían llamándole distinto al mismo
// papel. Para un documento ya sellado se busca su etiqueta en la lista de
// exigencias; si el tramo cambió y ya no figura, se muestra el slug legible.
const etiquetaDeSubido = (slug, documental) =>
  (documental?.items || []).find((i) => i.tipo_documento === slug)?.etiqueta
  || String(slug || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

function Tramo({ d, flash, onCambio }) {
  const [puntos, setPuntos] = useState([]);
  const [origen, setOrigen] = useState(d.tramo?.punto_origen || '');
  const [destino, setDestino] = useState(d.tramo?.punto_destino || '');
  const [ocupado, setOcupado] = useState(false);
  const [subiendo, setSubiendo] = useState(null);

  useEffect(() => { apiCorredor.puntos().then((r) => setPuntos(r.puntos)).catch(() => {}); }, []);

  const doc = d.documental;

  async function guardar() {
    setOcupado(true);
    try {
      await apiCorredor.definirTramo(d.carga.id, { punto_origen: origen, punto_destino: destino });
      onCambio();
    } catch (err) { flash(err.message, true); } finally { setOcupado(false); }
  }

  async function sellar(tipo, archivo) {
    if (!archivo) return;
    setSubiendo(tipo);
    try {
      await apiCorredor.sellarDocumento(d.carga.id, { tipo_documento: tipo, archivo });
      flash('Documento sellado. Se guardó su sello digital, no el archivo.');
      onCambio();
    } catch (err) { flash(err.message, true); } finally { setSubiendo(null); }
  }

  return (
    <div className="cor-sec">
      <h3 className="cor-sec-h"><Icon.Truck size={17} /> Tramo y documentos</h3>
      <p className="cor-sec-sub">
        Son los puntos por donde va a pasar, no dónde está: sicr3p no registra la posición de ningún
        vehículo. De los cruces de frontera sale qué papeles pide este viaje.
      </p>

      <div className="cor-fila">
        <div className="field cor-fila-crece">
          <label>Sale de</label>
          <select value={origen} onChange={(ev) => setOrigen(ev.target.value)}>
            <option value="">Elige un punto…</option>
            {puntos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>
        <div className="field cor-fila-crece">
          <label>Llega a</label>
          <select value={destino} onChange={(ev) => setDestino(ev.target.value)}>
            <option value="">Elige un punto…</option>
            {puntos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>
        <button className="btn btn-primary btn-sm" onClick={guardar} disabled={ocupado || !origen || !destino}>
          {d.tramo ? 'Actualizar tramo' : 'Definir tramo'}
        </button>
      </div>

      {d.tramo?.cruces?.length > 0 && (
        <p style={{ fontSize: 13, margin: '12px 0 0' }}>
          Cruza {d.tramo.cruces.length} {d.tramo.cruces.length === 1 ? 'frontera' : 'fronteras'}:{' '}
          {d.tramo.cruces.map((c) => `${c.pais_desde}→${c.pais_hasta}`).join(', ')}.
        </p>
      )}

      <div className={`cor-aviso ${doc.semaforo === 'verde' ? 'cor-aviso-ok'
        : doc.semaforo === 'rojo' ? 'cor-aviso-alto'
          : doc.semaforo === 'amarillo' ? 'cor-aviso-atencion' : 'cor-aviso-neutro'}`}>
        {doc.semaforo === 'verde' ? <Icon.CheckCircle size={16} />
          : doc.semaforo === 'gris' ? <Icon.Info size={16} /> : <Icon.Alert size={16} />}
        <div>{doc.glosa}</div>
      </div>

      {doc.items.length > 0 && (
        <ul className="cor-req cor-caja">
          {doc.items.map((i) => (
            <li key={i.tipo_documento}>
              {/* Un documento opcional que falta NO es un pendiente: gris. */}
              <span className={`cor-req-ico ${i.cumplido ? 'cor-req-ico-ok' : (i.obligatorio ? 'cor-req-ico-alto' : 'cor-req-ico-neutro')}`}>
                {i.cumplido ? <Icon.Check size={13} /> : i.obligatorio ? <Icon.Alert size={13} /> : <Icon.Info size={13} />}
              </span>
              <div className="cor-req-cuerpo">
                <b>{i.etiqueta}</b>
                <small>{i.nota}</small>
                <div className="cor-req-meta">
                  <span>Lo pide: {i.por.join(', ')}</span>
                  {!i.obligatorio && <span>Opcional</span>}
                </div>
              </div>
              {!i.cumplido && (
                <label className="btn btn-outline btn-sm cor-file" style={{ marginLeft: 'auto', flex: 'none' }}>
                  {subiendo === i.tipo_documento ? 'Sellando…' : 'Sellar'}
                  <input type="file" disabled={subiendo === i.tipo_documento}
                    aria-label={`Sellar ${i.etiqueta}`}
                    onChange={(ev) => sellar(i.tipo_documento, ev.target.files?.[0])} />
                </label>
              )}
            </li>
          ))}
        </ul>
      )}

      {d.documentos?.length > 0 && (
        <>
          <p className="cor-nota" style={{ margin: '14px 0 4px' }}>
            De cada documento se guarda su sello digital (SHA-256) y queda encadenado. El archivo se
            queda contigo: sicr3p no conserva una copia.
          </p>
          <div className="table-scroll">
            <table className="data">
              <tbody>
                {d.documentos.map((x) => (
                  <tr key={x.id}>
                    <td><b style={{ fontSize: 13 }}>{etiquetaDeSubido(x.tipo_documento, d.documental)}</b>
                      <div className="muted" style={{ fontSize: 12 }}>{x.archivo_original}</div></td>
                    <td className="muted mono" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>
                      #{x.eslabon} · {String(x.sha256 || '').slice(0, 12)}…
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
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
    <div className="cor-sec">
      <h3 className="cor-sec-h"><Icon.Calendar size={17} /> Producción</h3>
      <p className="cor-sec-sub">
        Cuándo se produjo y bajo qué condiciones. El EUDR contrasta estas fechas con su fecha de corte.
      </p>

      <div className="cor-grid" style={{ marginBottom: 14 }}>
        <div className="field"><label>Producción desde</label>
          <input type="date" value={f.desde} onChange={set('desde')} /></div>
        <div className="field"><label>hasta</label>
          <input type="date" value={f.hasta} onChange={set('hasta')} /></div>
      </div>

      <label className="cor-check">
        <input type="checkbox" checked={f.libre_deforestacion_declarado}
          onChange={(ev) => setF((x) => ({ ...x, libre_deforestacion_declarado: ev.target.checked }))} />
        <span>Libre de deforestación posterior al 31-12-2020</span>
      </label>

      {f.libre_deforestacion_declarado && (
        <div className="cor-sub">
          <p className="cor-nota" style={{ margin: '0 0 8px' }}>
            sicr3p no analiza imágenes satelitales. Registra la determinación que hizo otro: por eso
            hay que decir quién la emitió y contra qué línea base.
          </p>
          <div className="cor-grid">
            <div className="field"><label>Quién la emitió</label>
              <input value={f.determinacion_emisor} onChange={set('determinacion_emisor')} placeholder="Consultora Ejemplo" /></div>
            <div className="field"><label>Línea base</label>
              <input value={f.determinacion_linea_base} onChange={set('determinacion_linea_base')} placeholder="MapBiomas 2020" /></div>
            <div className="field"><label>Fecha</label>
              <input type="date" value={f.determinacion_at || ''} onChange={set('determinacion_at')} /></div>
          </div>
        </div>
      )}

      <label className="cor-check">
        <input type="checkbox" checked={f.legalidad_declarada}
          onChange={(ev) => setF((x) => ({ ...x, legalidad_declarada: ev.target.checked }))} />
        <span>Producción conforme a la legislación del país (tenencia de la tierra, ambiental, laboral, tributaria)</span>
      </label>

      <button className="btn btn-primary btn-sm" style={{ marginTop: 4 }} onClick={guardar} disabled={guardando || faltaEmisor}>
        {guardando ? <span className="spinner" /> : 'Guardar producción'}
      </button>
      {faltaEmisor && (
        <p className="cor-nota">Falta decir quién hizo la determinación de deforestación.</p>
      )}
    </div>
  );
}
