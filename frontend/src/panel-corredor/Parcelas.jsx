import { useEffect, useRef, useState } from 'react';
import { apiCorredor } from './api.js';
import { leerArchivoDePredio, areaHa } from './geo.js';

const COLOR_NIVEL = { 1: 'badge-gray', 2: 'badge-amber', 3: 'badge-green', 4: 'badge-green' };
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
      <h1 style={{ marginTop: 0 }}>Predios</h1>
      <p className="muted" style={{ fontSize: 14, maxWidth: 680, marginTop: 0 }}>
        El EUDR exige la geolocalización de cada predio donde se produjo la carga. La vía recomendada
        es importar el archivo del catastro: el polígono ya existe, ya lo declaró su dueño ante una
        autoridad, y es más preciso que cualquier medición en terreno.
      </p>

      <div className="card card-pad" style={{ maxWidth: 640, marginBottom: 22 }}>
        <h3 style={{ marginTop: 0 }}>Nuevo predio</h3>

        <div className="field">
          <label>Archivo del catastro (GeoJSON o KML)</label>
          <input ref={archivoRef} type="file" accept=".geojson,.json,.kml,application/geo+json" onChange={tomarArchivo} />
          {poligono && (
            <div className="badge badge-green" style={{ display: 'block', padding: 10, marginTop: 8, fontSize: 13 }}>
              Polígono cargado — {areaArchivo} ha según el archivo.
            </div>
          )}
          {avisoArchivo && (
            <div className="badge badge-amber" style={{ display: 'block', padding: 10, marginTop: 8, fontSize: 13 }}>
              {avisoArchivo}
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
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
          <div className="badge badge-amber" style={{ display: 'block', padding: 11, marginTop: 4, fontSize: 13, lineHeight: 1.5 }}>
            El archivo da <b>{areaArchivo} ha</b> y declaraste <b>{areaDeclarada} ha</b> ({difPct}% de diferencia).
            Se va a registrar el desacuerdo: no se corrige ninguna de las dos, y el predio queda en nivel 2
            en vez de 3.
          </div>
        )}

        {!poligono && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            <div className="field"><label>Latitud</label>
              <input inputMode="decimal" value={form.lat} onChange={set('lat')} placeholder="-12.5" /></div>
            <div className="field"><label>Longitud</label>
              <input inputMode="decimal" value={form.lng} onChange={set('lng')} placeholder="-55.7" /></div>
          </div>
        )}

        {exigePoligono && !poligono && (
          <div className="badge badge-red" style={{ display: 'block', padding: 11, marginBottom: 12, fontSize: 13, lineHeight: 1.5 }}>
            Sobre {umbral} ha el EUDR exige el polígono del predio: un punto no alcanza. Importa el
            archivo del catastro.
          </div>
        )}

        <button className="btn btn-primary" style={{ width: '100%' }}
          onClick={guardar}
          disabled={guardando || !form.nombre || (!poligono && (form.lat === '' || form.lng === ''))}>
          {guardando ? <span className="spinner" /> : 'Registrar predio'}
        </button>
      </div>

      {!datos ? <div className="muted"><span className="spinner" /> Cargando…</div> : (
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
                      <div className="muted" style={{ fontSize: 12 }}>
                        {p.origen_coordenada === 'archivo' ? 'Archivo del catastro'
                          : p.origen_coordenada === 'registro' ? 'Registro público' : 'Dibujado en el mapa'}
                      </div>
                    </td>
                    <td style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                      {p.area_ha ? `${Number(p.area_ha)} ha` : <span className="muted">sin declarar</span>}
                      {p.area?.calculada_ha != null && (
                        <div className="muted" style={{ fontSize: 12 }}>{p.area.calculada_ha} ha del polígono</div>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${COLOR_NIVEL[p.nivel_confianza] || 'badge-gray'}`}>
                        {p.nivel_confianza} · {p.nombre_nivel}
                      </span>
                      {p.desacuerdo_area && (
                        <div className="muted" style={{ fontSize: 12, marginTop: 4, maxWidth: 280 }}>{p.desacuerdo_area}</div>
                      )}
                    </td>
                  </tr>
                ))}
                {datos.parcelas.length === 0 && (
                  <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: 28 }}>
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
