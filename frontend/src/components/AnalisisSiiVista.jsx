import { fmt, fmtInt, fmtFecha } from '../api.js';
import { formatearRut } from '../lib/rut.js';

// Vista del análisis de compras/ventas del SII de una empresa: resumen,
// estimación referencial de emisiones, concentración por contraparte y
// detalle de documentos. Compartida por el panel del proveedor
// (panel-proveedor/AnalisisSii.jsx) y la sección admin "SII" (admin/Sii.jsx).
const CLP = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CL')}`;

// `esPropio`: quién está mirando. El panel de la empresa ve su propio período
// (tuteo, imperativo); el admin mira la empresa de otro desde /admin → SII,
// donde decirle "vuelve a descargar" no corresponde.
export default function AnalisisSiiVista({ a, esPropio = true }) {
  const c = a.resumen.compra, v = a.resumen.venta;
  const em = a.emisiones;
  return (
    <div>
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <div className="stat"><div className="n">{fmtInt(c.n)}</div><div className="l">Documentos de compra</div></div>
        <div className="stat"><div className="n">{CLP(c.total)}</div><div className="l">Total comprado</div></div>
        <div className="stat"><div className="n">{fmtInt(v.n)}</div><div className="l">Documentos de venta</div></div>
        <div className="stat"><div className="n green">{CLP(v.total)}</div><div className="l">Total vendido</div></div>
      </div>

      {em && (
        <div className="card" style={{ marginBottom: 16, borderLeft: '3px solid #14b8a6' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{fmt(em.total_co2e_tref, 2)} tCO₂e</div>
              <div className="muted" style={{ fontSize: 13 }}>
                Emisiones de tus compras — calculadas sobre {fmtInt(em.documentos_calculados)} de {fmtInt(em.documentos_totales)} documentos del SII
                {em.metodo_fisico > 0 && ` · ${fmtInt(em.metodo_fisico)} por unidades físicas, ${fmtInt(em.metodo_gasto)} por gasto`}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span className="badge badge-green">Contabilidad de carbono</span>
              {/* El backend marca `referencial: true` desde que existe este
                  cálculo y la vista nunca lo decía: sola, la insignia verde se
                  leía como un aval. */}
              {em.referencial && <span className="badge badge-amber">Estimación referencial</span>}
            </div>
          </div>
          <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 8 }}>
            Calculada con nuestro motor sobre lo que trae cada documento tributario: el detalle de sus ítems cuando el
            SII lo entrega, y el monto del documento cuando solo llega el registro del RCV. Se aplican unidades físicas
            si el documento las incluye y factores por gasto en el resto.
            Es una estimación referencial: los factores son de referencia y no constituyen una verificación de tercera parte.
            {em.motor_versiones?.length > 0 && ` Motor de cálculo v${em.motor_versiones.join(', v')}.`}
            {em.documentos_sin_version > 0 && ` ${fmtInt(em.documentos_sin_version)} documento${em.documentos_sin_version === 1 ? '' : 's'} sin versión de motor registrada.`}
          </p>
        </div>
      )}

      <PorAlcanceTabla
        porAlcance={em?.por_alcance}
        total={em?.total_co2e_tref}
        puedeReintentar={a.proveedor_sii?.puede_traer_detalle === true}
        esPropio={esPropio}
      />

      <div className={a.por_tipo?.compra?.length && a.por_tipo?.venta?.length ? 'two-col-grid' : undefined}>
        <PorTipoTabla titulo="Compras por tipo de documento" filas={a.por_tipo?.compra} />
        <PorTipoTabla titulo="Ventas por tipo de documento" filas={a.por_tipo?.venta} />
      </div>

      <div className={a.concentracion.compra?.length && a.concentracion.venta?.length ? 'two-col-grid' : undefined}>
        <ContraparteTabla titulo="Principales proveedores (compras)" filas={a.concentracion.compra} />
        <ContraparteTabla titulo="Principales clientes (ventas)" filas={a.concentracion.venta} />
      </div>

      <details style={{ marginTop: 8 }}>
        <summary style={{ cursor: 'pointer', fontSize: 14 }}>Ver el detalle de los {fmtInt(a.documentos.length)} documentos</summary>
        <div className="card" style={{ marginTop: 10 }}>
          <div className="table-scroll">
            <table className="data">
              <thead><tr><th>Tipo</th><th>Folio</th><th>Fecha</th><th>Contraparte</th><th style={{ textAlign: 'right' }}>Neto</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>tCO₂e</th></tr></thead>
              <tbody>
                {a.documentos.map((d, i) => (
                  <tr key={i}>
                    <td>{d.tipo === 'compra' ? 'Compra' : 'Venta'}</td>
                    <td style={{ fontFamily: 'monospace' }}>{d.folio}</td>
                    <td>{d.fecha ? fmtFecha(d.fecha) : '—'}</td>
                    <td>
                      {d.razon_social || (d.rut_contraparte ? formatearRut(d.rut_contraparte) : '—')}
                      {d.conciliado && d.monto_coincide && (
                        <span title="Confirmado: también aparece en el RCV que esta empresa descargó de su propio SII" style={{ marginLeft: 6, color: '#16a34a' }}>✓</span>
                      )}
                      {d.conciliado && !d.monto_coincide && (
                        <span title="El folio coincide con el RCV de esta empresa, pero el monto declarado difiere — revisar" style={{ marginLeft: 6, color: '#d97706' }}>⚠</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>{CLP(d.neto)}</td>
                    <td style={{ textAlign: 'right' }}>{CLP(d.total)}</td>
                    {/* El método es el indicador de calidad del dato: "físico"
                        salió de unidades reales del documento, "gasto" de una
                        proporción sobre el monto. La nota metodológica ya lo
                        promete en agregado; acá se puede ver documento a documento. */}
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {d.co2e != null ? fmt(d.co2e, 4) : '—'}
                      {d.metodo && (
                        <span className="muted" style={{ fontSize: 11, marginLeft: 6, color: d.metodo === 'fisico' ? '#16a34a' : undefined }}>
                          {d.metodo === 'fisico' ? 'físico' : 'gasto'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {a.documentos.length === 0 && (
                  <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 24 }}>Sin documentos en este período.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </details>
    </div>
  );
}

// Desglose por alcance GHG (1/2/3). El alcance sale de la categoría con que
// el motor clasificó cada documento, resuelta contra la versión del motor con
// la que se calculó — no contra el catálogo de hoy.
//
// "Sin clasificar" se muestra SIEMPRE que exista y NO es un residuo menor:
// solo entra a un alcance el documento cuya categoría salió de la glosa real
// de sus ítems. Los que se clasificaron por el nombre del proveedor o con el
// catch-all del motor quedan acá a propósito (ver services/alcanceGhg.js).
// Su CO2e está dentro del total, así que esconderlos dejaría tres alcances
// que no suman — un informe que no cuadra. Cada motivo trae su propia salida.
const DESC_ALCANCE = {
  1: 'Emisiones directas de la propia operación',
  2: 'Electricidad comprada',
  3: 'Cadena de valor (proveedores, residuos, viajes)',
};

// Motivo → qué le pasó al documento y qué puede hacer quien lo lee. El orden
// es el de utilidad para la empresa: primero lo que ella misma puede resolver.
//
// `descarga_antigua` es el único motivo con una salida accionable, y solo si
// el proveedor de datos del SII activo PUEDE traer el detalle: si no puede,
// volver a descargar da el mismo resultado y el imperativo sería mentira.
// Esta vista además la usa el admin mirando la empresa de OTRO, donde
// "vuelve a descargar" tampoco corresponde — por eso el texto se elige.
function motivosSinAlcance({ puedeReintentar, esPropio }) {
  const antigua = !puedeReintentar
    ? 'se descargaron antes de esta clasificación — el registro del SII de este servicio no trae el detalle de los ítems, así que volver a descargarlos no los clasifica'
    : esPropio
      ? 'se descargaron antes de esta clasificación — vuelve a descargar el período para clasificarlos'
      : 'se descargaron antes de esta clasificación — se clasifican volviendo a descargar el período';
  return [
    ['inferido_por_nombre', 'se clasificaron por el nombre del proveedor, no por el detalle del documento — el RCV no trae ese detalle, así que no se les atribuye alcance'],
    ['descarga_antigua', antigua],
    ['sin_coincidencia', 'no coinciden con ninguna categoría del motor'],
    ['motor_sin_categoria', 'el motor no les dejó categoría (por ejemplo, notas de crédito)'],
    ['alcance_no_legible', 'su categoría no resuelve a un alcance GHG (texto no legible, o categoría fuera del catálogo actual) — avísanos para corregirlo'],
  ];
}

function PorAlcanceTabla({ porAlcance, total, puedeReintentar, esPropio }) {
  const MOTIVOS_SIN_ALCANCE = motivosSinAlcance({ puedeReintentar, esPropio });
  if (!porAlcance) return null; // backend anterior a esta versión
  const { alcances = [], sin_clasificar: sin } = porAlcance;
  if (!alcances.length && !sin?.n_documentos) return null;
  const pct = (n) => (total > 0 ? `${fmt((n / total) * 100, 1)}%` : '—');

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h3 style={{ marginTop: 0, fontSize: 15 }}>Emisiones por alcance (GHG Protocol)</h3>
      <div className="table-scroll">
        <table className="data">
          <thead><tr><th>Alcance</th><th>Qué incluye</th><th style={{ textAlign: 'right' }}>Docs</th><th style={{ textAlign: 'right' }}>tCO₂e</th><th style={{ textAlign: 'right' }}>%</th></tr></thead>
          <tbody>
            {alcances.map((a) => (
              <tr key={a.alcance}>
                <td style={{ fontWeight: 600 }}>Alcance {a.alcance}</td>
                <td>
                  {DESC_ALCANCE[a.alcance]}
                  <div className="muted" style={{ fontSize: 12 }}>
                    {a.categorias.map((c) => `${c.nombre}${c.categoria_ghg ? ` (Cat. ${c.categoria_ghg})` : ''}`).join(' · ')}
                  </div>
                </td>
                <td style={{ textAlign: 'right' }}>{fmtInt(a.n_documentos)}</td>
                <td style={{ textAlign: 'right' }}>{fmt(a.tco2e, 2)}</td>
                <td style={{ textAlign: 'right' }}>{pct(a.tco2e)}</td>
              </tr>
            ))}
            {sin?.n_documentos > 0 && (
              <tr>
                <td style={{ fontWeight: 600 }}>Sin alcance atribuido</td>
                <td className="muted">
                  Su CO₂e está incluido en el total del período.
                  {MOTIVOS_SIN_ALCANCE.filter(([clave]) => sin[clave] > 0).map(([clave, texto]) => (
                    <div key={clave}>{fmtInt(sin[clave])} {texto}.</div>
                  ))}
                </td>
                <td style={{ textAlign: 'right' }}>{fmtInt(sin.n_documentos)}</td>
                <td style={{ textAlign: 'right' }}>{fmt(sin.tco2e, 2)}</td>
                <td style={{ textAlign: 'right' }}>{pct(sin.tco2e)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {/* Solo cuando la causa dominante es realmente la falta de detalle. Si
          todo quedó fuera por notas de crédito o por un alcance ilegible en el
          catálogo, esta explicación sería falsa y la salida que sugiere, inútil.
          El texto NO ofrece "subir los documentos con su detalle": esa carga no
          existe en este panel, y aunque existiera iría a otra tabla que no
          alimenta esta pantalla. */}
      {alcances.length === 0 && sin?.inferido_por_nombre > 0 && (
        <p className="muted" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
          Ningún documento de este período trae el detalle de sus ítems, así que no hay alcances que atribuir:
          el registro del SII entrega el monto de cada documento, no lo que se compró. El CO₂e del período sigue
          siendo válido —se calcula por gasto— pero no se puede repartir en alcances 1/2/3 sin inventar de dónde
          viene cada peso.
          {puedeReintentar
            ? ' Los documentos cuyo emisor publique el XML en el SII sí se clasifican solos en la próxima descarga.'
            : ' El servicio de datos del SII configurado en este despliegue no entrega ese detalle para ningún documento.'}
        </p>
      )}
      <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 8 }}>
        Solo se atribuye alcance al documento cuya categoría salió del detalle de sus propios ítems, y se usa
        la categoría principal (la de mayor CO₂e del documento). Categorías de Alcance 3 según GHG Protocol —
        Corporate Value Chain (Scope 3) Standard, WRI/WBCSD 2011.
      </p>
    </div>
  );
}

// Desglose por tipo de documento: separa facturas, notas de crédito/débito,
// guías de despacho y boletas (resumen agregado del período) para no leer
// todo como facturación.
function PorTipoTabla({ titulo, filas }) {
  if (!filas || filas.length === 0) return null;
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h3 style={{ marginTop: 0, fontSize: 15 }}>{titulo}</h3>
      <div className="table-scroll">
        <table className="data">
          <thead><tr><th>Tipo</th><th style={{ textAlign: 'right' }}>Docs</th><th style={{ textAlign: 'right' }}>Neto</th><th style={{ textAlign: 'right' }}>IVA</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={i}>
                <td>{f.nombre} <span className="muted" style={{ fontFamily: 'monospace', fontSize: 12 }}>({f.tipo_dte})</span></td>
                <td style={{ textAlign: 'right' }}>{f.resumen ? <span className="muted">resumen</span> : fmtInt(f.n)}</td>
                <td style={{ textAlign: 'right' }}>{CLP(f.neto)}</td>
                <td style={{ textAlign: 'right' }}>{CLP(f.iva)}</td>
                <td style={{ textAlign: 'right' }}>{CLP(f.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
        Las notas de crédito y guías de despacho se muestran por separado; las boletas electrónicas
        llegan del SII como resumen agregado del período, sin detalle por documento.
      </p>
    </div>
  );
}

// Tabla de concentración por contraparte, marcando las que ya están en
// sicr3p (cruce por RUT) y, cuando la contraparte también conectó su
// propio SII, cuántos de los documentos quedaron confirmados: coinciden
// en el RCV que ELLA misma descargó (dos fuentes SII independientes de
// acuerdo). Nunca expone datos de esos terceros más allá de eso.
function ContraparteTabla({ titulo, filas }) {
  if (!filas || filas.length === 0) return null;
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h3 style={{ marginTop: 0, fontSize: 15 }}>{titulo}</h3>
      <div className="table-scroll">
        <table className="data">
          <thead><tr><th>Contraparte</th><th>RUT</th><th style={{ textAlign: 'right' }}>Docs</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>%</th><th></th></tr></thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={i}>
                <td>{f.razon_social || '—'}</td>
                <td style={{ fontFamily: 'monospace' }}>{f.rut ? formatearRut(f.rut) : '—'}</td>
                <td style={{ textAlign: 'right' }}>{fmtInt(f.n)}</td>
                <td style={{ textAlign: 'right' }}>{CLP(f.total)}</td>
                <td style={{ textAlign: 'right' }}>{f.participacion}%</td>
                <td>
                  {f.conciliados > 0 ? (
                    <span className="badge badge-green" title="Estos documentos también aparecen en el RCV que esta empresa descargó de su propio SII">
                      Confirmado ({fmtInt(f.conciliados)}/{fmtInt(f.n)})
                    </span>
                  ) : f.en_sicr3p ? (
                    <span className="badge badge-amber" title="El RUT coincide con una empresa de sicr3p, pero aún no se confirma contra su propio RCV">en sicr3p</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
