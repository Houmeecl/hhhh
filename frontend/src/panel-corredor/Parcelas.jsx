import { useEffect, useRef, useState } from 'react';
import Icon from '../components/icons.jsx';
import Semaforo from './Semaforo.jsx';
import { apiCorredor } from './api.js';
import { leerArchivoDePredio, areaHa } from './geo.js';

// Los cuatro niveles de confianza del predio, traducidos al mismo semáforo
// de tres lecturas del resto del producto. El nivel 1 —"Declarado"— es
// gris y no rojo a propósito: no está mal, es que todavía no hay nada
// contra qué contrastarlo. Con .badge-sem el gris además lleva punto
// hueco, así que se distingue del verde sin depender del color.
const ESTADO_NIVEL = { 1: 'gris', 2: 'amarillo', 3: 'verde', 4: 'verde' };
const ORIGEN = { archivo: 'Archivo del catastro', registro: 'Registro público', mapa: 'Dibujado en el mapa' };

const VACIO = { nombre: '', pais: 'BR', region: '', area_ha: '', lat: '', lng: '', origen_coordenada: 'archivo' };

// Alta de predios. La vía principal es IMPORTAR el archivo del catastro,
// no dibujar ni salir a tomar coordenadas: ver docs/CORREDOR-PLAN.md §4.0.
export default function Parcelas() {
  const [datos, setDatos] = useState(null);
  const [form, setForm] = useState(VACIO);
  const [poligono, setPoligono] = useState(null);
  const [avisoArchivo, setAvisoArchivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [toast, setToast] = useState(null);
  const archivoRef = useRef(null);
  const flash = (msg, err = false) => { setToast({ msg, err }); setTimeout(() => setToast(null), 4500); };

  const cargar = () => apiCorredor.parcelas().then(setDatos).catch((e) => flash(e.message, true));
  useEffect(() => { cargar(); }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function tomarArchivo(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const lector = new FileReader();
    lector.onload = () => {
      const r = leerArchivoDePredio(file.name, String(lector.result));
      if (!r.ok) { setPoligono(null); setAvisoArchivo(''); flash(r.error, true); return; }
      setPoligono(r.poligono);
      setAvisoArchivo(r.aviso || '');
      // Si todavía no declaró superficie, se propone la del archivo. Si ya
      // la escribió, NO se pisa: la diferencia entre lo que declaró y lo
      // que dice el polígono es justamente el dato que hay que ver.
      setForm((f) => ({ ...f, origen_coordenada: 'archivo', area_ha: f.area_ha || String(areaHa(r.poligono) ?? '') }));
    };
    lector.readAsText(file);
  }

  const areaArchivo = poligono ? areaHa(poligono) : null;
  const areaDeclarada = Number(form.area_ha);
  const difPct = areaArchivo && areaDeclarada > 0
    ? Math.round(Math.abs(areaArchivo - areaDeclarada) / areaDeclarada * 10000) / 100
    : null;
  const umbral = datos?.umbral_poligono_ha ?? 4;
  const exigePoligono = areaDeclarada > umbral;

  async function guardar() {
    setGuardando(true);
    try {
      const { parcela } = await apiCorredor.crearParcela({
        nombre: form.nombre, pais: form.pais.toUpperCase(), region: form.region || null,
        area_ha: form.area_ha === '' ? null : Number(form.area_ha),
        lat: form.lat === '' ? null : Number(form.lat),
        lng: form.lng === '' ? null : Number(form.lng),
        poligono, origen_coordenada: form.origen_coordenada,
      });
      setForm(VACIO); setPoligono(null); setAvisoArchivo('');
      if (archivoRef.current) archivoRef.current.value = '';
      flash(`Parcela registrada en nivel ${parcela.nivel_confianza} — ${parcela.nombre_nivel}.`);
      cargar();
    } catch (e) { flash(e.message, true); } finally { setGuardando(false); }
  }

  return (
    <div>
      <div className="cor-head">
        <h1>Predios</h1>
        <p>
          El EUDR exige la geolocalización de cada predio donde se produjo la carga. La vía recomendada
          es importar el archivo del catastro: el polígono ya existe, ya lo declaró su dueño ante una
          autoridad, y es más preciso que cualquier medición en terreno.
        </p>
      </div>

      <div className="card card-pad cor-card cor-form">
        <h3 style={{ marginTop: 0 }}>Nuevo predio</h3>

        <div className="field">
          <label htmlFor="catastro">Archivo del catastro (GeoJSON o KML)</label>
          <input id="catastro" ref={archivoRef} type="file" accept=".geojson,.json,.kml,application/geo+json" onChange={tomarArchivo} />
          {poligono && (
            <div className="cor-aviso cor-aviso-ok">
              <Icon.CheckCircle size={16} />
              <div>Polígono cargado — {areaArchivo} ha según el archivo.</div>
            </div>
          )}
          {avisoArchivo && (
            <div className="cor-aviso cor-aviso-atencion">
              <Icon.Alert size={16} />
              <div>{avisoArchivo}</div>
            </div>
          )}
        </div>

        <div className="cor-grid">
          <div className="field"><label>Nombre del predio</label>
            <input value={form.nombre} onChange={set('nombre')} placeholder="Fazenda Santa Clara" /></div>
          <div className="field"><label>País (ISO-2)</label>
            <input value={form.pais} maxLength={2} onChange={(e) => setForm((f) => ({ ...f, pais: e.target.value.toUpperCase() }))} /></div>
          <div className="field"><label>Región</label>
            <input value={form.region} onChange={set('region')} placeholder="Mato Grosso" /></div>
          <div className="field"><label>Superficie declarada (ha)</label>
            <input inputMode="decimal" value={form.area_ha} onChange={set('area_ha')} placeholder="102.4" /></div>
        </div>

        {/* El desacuerdo se muestra ANTES de guardar: verlo acá es lo que
            permite corregir un archivo equivocado en vez de descubrirlo
            después. Lo que NO se hace es pisar ninguna de las dos cifras. */}
        {difPct !== null && difPct > (datos?.tolerancia_area_pct ?? 5) && (
          <div className="cor-aviso cor-aviso-atencion">
            <Icon.Alert size={16} />
            <div>
              El archivo da <b>{areaArchivo} ha</b> y declaraste <b>{areaDeclarada} ha</b> ({difPct}% de diferencia).
              Se va a registrar el desacuerdo: no se corrige ninguna de las dos, y el predio queda en nivel 2
              en vez de 3.
            </div>
          </div>
        )}

        {!poligono && (
          <div className="cor-grid" style={{ marginTop: 14 }}>
            <div className="field"><label>Latitud</label>
              <input inputMode="decimal" value={form.lat} onChange={set('lat')} placeholder="-12.5" /></div>
            <div className="field"><label>Longitud</label>
              <input inputMode="decimal" value={form.lng} onChange={set('lng')} placeholder="-55.7" /></div>
          </div>
        )}

        {exigePoligono && !poligono && (
          <div className="cor-aviso cor-aviso-alto">
            <Icon.Alert size={16} />
            <div>
              Sobre {umbral} ha el EUDR exige el polígono del predio: un punto no alcanza. Importa el
              archivo del catastro.
            </div>
          </div>
        )}

        <button className="btn btn-primary" style={{ width: '100%', marginTop: 16 }}
          onClick={guardar}
          disabled={guardando || !form.nombre || (!poligono && (form.lat === '' || form.lng === ''))}>
          {guardando ? <span className="spinner" /> : 'Registrar predio'}
        </button>
      </div>

      {!datos ? <div className="muted"><span className="spinner dark" /> Cargando…</div> : (
        <div className="card">
          <div className="table-scroll">
            <table className="data">
              <thead><tr><th>Predio</th><th>Ubicación</th><th>Superficie</th><th>Confianza</th></tr></thead>
              <tbody>
                {datos.parcelas.map((p) => (
                  <tr key={p.id}>
                    <td><b>{p.nombre}</b><div className="muted" style={{ fontSize: 12 }}>{p.pais}{p.region ? ` · ${p.region}` : ''}</div></td>
                    <td style={{ fontSize: 13 }}>
                      {p.poligono ? 'Polígono' : 'Punto'}
                      <div className="muted" style={{ fontSize: 12 }}>{ORIGEN[p.origen_coordenada] || ORIGEN.mapa}</div>
                    </td>
                    <td style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                      {p.area_ha ? `${Number(p.area_ha)} ha` : <span className="muted">sin declarar</span>}
                      {p.area?.calculada_ha != null && (
                        <div className="muted" style={{ fontSize: 12 }}>{p.area.calculada_ha} ha del polígono</div>
                      )}
                    </td>
                    <td>
                      <Semaforo estado={ESTADO_NIVEL[p.nivel_confianza] || 'gris'}>
                        {p.nivel_confianza} · {p.nombre_nivel}
                      </Semaforo>
                      {p.desacuerdo_area && (
                        <div className="muted" style={{ fontSize: 12, marginTop: 4, maxWidth: 280 }}>{p.desacuerdo_area}</div>
                      )}
                    </td>
                  </tr>
                ))}
                {datos.parcelas.length === 0 && (
                  <tr><td colSpan={4} className="muted cor-vacio">
                    Todavía no hay predios. Registra el primero arriba.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}
    </div>
  );
}
