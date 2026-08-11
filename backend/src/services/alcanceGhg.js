import { citaFuente } from './pdf.js';
import { esAtribuible } from './categoriaPresentacion.js';

// ============================================================
// Parseo de motor_categorias.alcance_ghg ("Alcance N · Cat. M — desc")
// hacia forma estructurada, SOLO al leer — NO se persiste: el campo es
// texto libre editable desde el panel (PUT /admin/motor-propio/categorias/:codigo)
// sin validar el patrón, así que una columna derivada persistida podría
// desincronizarse sin que nada la vuelva a derivar. Tolerante: texto que
// no calza con el patrón no revienta el export, solo queda sin clasificar.
// ============================================================

const PATRON = /^Alcance\s+([123])(?:\s*·\s*Cat\.\s*(\d{1,2}))?\s*—\s*(.+)$/;

export function parsearAlcanceGHG(texto) {
  const s = String(texto ?? '').trim();
  const m = PATRON.exec(s);
  if (!m) return { alcance: null, categoria: null, descripcion: s || null };
  return { alcance: Number(m[1]), categoria: m[2] ? Number(m[2]) : null, descripcion: m[3].trim() };
}

// Nombres canónicos de las 15 categorías de Alcance 3, GHG Protocol —
// Corporate Value Chain (Scope 3) Standard (WRI/WBCSD, 2011). Fijo por
// definición del estándar, no editable desde el panel. Debe coincidir
// con la fuente registrada en fuentes_metodologicas por la migración 036
// (verificado en test/fuenteScope3.test.js).
export const CATEGORIAS_ALCANCE3_GHG_PROTOCOL = {
  1: 'Bienes y servicios adquiridos',
  2: 'Bienes de capital',
  3: 'Actividades relacionadas con combustibles y energía (no incluidas en Alcance 1 o 2)',
  4: 'Transporte y distribución — aguas arriba',
  5: 'Residuos generados en las operaciones',
  6: 'Viajes de negocios',
  7: 'Desplazamiento de empleados',
  8: 'Activos arrendados — aguas arriba',
  9: 'Transporte y distribución — aguas abajo',
  10: 'Procesamiento de productos vendidos',
  11: 'Uso de productos vendidos',
  12: 'Fin de vida de productos vendidos',
  13: 'Activos arrendados — aguas abajo',
  14: 'Franquicias',
  15: 'Inversiones',
};

export const CITA_CATEGORIAS_ALCANCE3 = citaFuente({
  organismo: 'WRI/WBCSD — GHG Protocol',
  documento: 'Corporate Value Chain (Scope 3) Accounting and Reporting Standard',
  version_anio: '2011',
});

const r4 = (n) => Math.round(n * 10000) / 10000;

// Agrupa los documentos de un período por alcance GHG (1/2/3), para el
// panel de la empresa. Entrada: filas con { categoria, categoria_nombre,
// alcance_ghg, co2e } — `alcance_ghg` viene del snapshot congelado de la
// versión del motor con que se calculó (motor_categorias_version), no del
// catálogo vivo: así un informe viejo no cambia de alcance porque alguien
// editó una categoría después.
//
// UN DOCUMENTO SOLO ENTRA A UN ALCANCE SI SU CATEGORÍA SALIÓ DE LA GLOSA REAL
// DE SUS ÍTEMS (`categoria_origen = 'xml'`). Es la regla central de esta
// función y la razón de que exista la columna (ver migración 076):
//
//   · 'razon_social' — los adaptadores que solo traen el RCV fabrican un ítem
//     sintético cuyo nombre es la razón social de la contraparte, y las
//     palabras clave del motor incluyen marcas ('copec', 'enel'). Atribuir
//     Alcance 1 — emisiones DIRECTAS de la propia operación — porque el
//     proveedor se llama COPEC es inventar el dato: el RCV no dice si la
//     empresa quemó ese combustible o compró un servicio que lo incluía, y
//     esa es exactamente la diferencia entre Alcance 1 y Alcance 3.
//   · 'sin_coincidencia' — ninguna palabra clave calzó y el motor usó su
//     catch-all ('servicios', que mapea a Alcance 3 · Cat. 1). Sirve para
//     calcular; presentarlo como atribución sería mostrar un default del
//     motor como si fuera una conclusión.
//
// El CO2e de todos ellos SIGUE contando en el total del período: omitirlo
// dejaría tres alcances que no suman — un informe que no cuadra. Van a
// `sin_clasificar`, separados por CAUSA, porque la salida del usuario es
// distinta en cada caso y ofrecerle la equivocada es peor que no ofrecer nada:
//   · `descarga_antigua`     → tiene categoría pero no consta de dónde salió
//     (descargado antes de la columna `categoria_origen`, migración 076).
//     Volver a descargar el período es lo único que lo puede clasificar.
//   · `inferido_por_nombre`  → 'razon_social'. Se arregla con el detalle real
//     del documento, no volviendo a bajar el RCV.
//   · `sin_coincidencia`     → el catch-all del motor. Se arregla agregando la
//     palabra clave que falta al catálogo (panel del motor).
//   · `motor_sin_categoria`  → el motor corrió y no dejó categoría (nota de
//     crédito, todos los ítems descartados). No hay nada que reintentar.
//   · `alcance_no_legible`   → la categoría no resuelve a un alcance: su
//     `alcance_ghg` (texto libre editable) no calza el patrón, o el código ya
//     no está en el catálogo. Lo arregla un admin en el panel del motor.
//   · `procedencia_no_registrada` → la fila declara explícitamente (marcador
//     'sin_procedencia' de filasDesdeFacturas) que su origen es NULL en el
//     vocabulario de `facturas`: no consta de dónde salió la categoría, que
//     NO es lo mismo que "descargada antes de la clasificación" — el flujo
//     público no descarga nada.
//
// La atribuibilidad se decide con esAtribuible() (categoriaPresentacion.js):
// cubre los DOS vocabularios — 'xml' del flujo SII y 'glosa'/'operador' del
// flujo público de facturas — así que esta función sirve para ambos.
export function agregarPorAlcance(filas = []) {
  const porAlcance = new Map(); // 1|2|3 → { tco2e, n_documentos, categorias: Map }
  const sinClasificar = {
    tco2e: 0, n_documentos: 0,
    descarga_antigua: 0, inferido_por_nombre: 0, sin_coincidencia: 0,
    motor_sin_categoria: 0, alcance_no_legible: 0, procedencia_no_registrada: 0,
  };
  // Se acumula CRUDO y se redondea una sola vez al final, igual que
  // `total_co2e_tref`. Redondear en cada suma haría que los baldes se
  // despeguen del total en cuanto un co2e traiga más de 4 decimales
  // (dte_proveedor.co2e es NUMERIC sin precisión fija), y ese invariante
  // —alcances + sin clasificar = total— es en lo que se apoya todo el informe.
  const sumar = (obj, co2e) => { obj.tco2e += co2e; obj.n_documentos += 1; };

  for (const f of filas) {
    if (f.co2e == null) continue; // documento sin cálculo: no aporta al total, no es "sin clasificar"
    const co2e = Number(f.co2e || 0);
    const { alcance, categoria: catGhg } = parsearAlcanceGHG(f.alcance_ghg);
    // `descarga_antigua` se decide por la AUSENCIA de `categoria_origen` en una
    // fila que sí tiene categoría — eso solo puede pasar si se descargó antes
    // de que existiera la columna, y es el único caso que volver a descargar
    // arregla. Antes se decidía por `motor_version_id == null`, que también es
    // cierto en un despliegue sin versiones del motor (versionVigente()
    // devuelve null): ahí un documento recién bajado se rotulaba "descargado
    // antes de esta clasificación" y encendía un botón que no lo cambiaba.
    const motivo = !f.categoria
      ? 'motor_sin_categoria'
      : f.categoria_origen === 'razon_social' ? 'inferido_por_nombre'
        : f.categoria_origen === 'sin_coincidencia' ? 'sin_coincidencia'
          : f.categoria_origen === 'sin_procedencia' ? 'procedencia_no_registrada'
            : !esAtribuible(f.categoria_origen) ? 'descarga_antigua'
              : alcance === null ? 'alcance_no_legible'
                : null;
    if (motivo) {
      sumar(sinClasificar, co2e);
      sinClasificar[motivo] += 1;
      continue;
    }
    if (!porAlcance.has(alcance)) porAlcance.set(alcance, { tco2e: 0, n_documentos: 0, categorias: new Map() });
    const a = porAlcance.get(alcance);
    sumar(a, co2e);
    if (!a.categorias.has(f.categoria)) {
      a.categorias.set(f.categoria, {
        codigo: f.categoria,
        nombre: f.categoria_nombre || f.categoria,
        categoria_ghg: catGhg,
        categoria_ghg_nombre: catGhg ? (CATEGORIAS_ALCANCE3_GHG_PROTOCOL[catGhg] || null) : null,
        tco2e: 0,
        n_documentos: 0,
        // Para el export entregable: cuántos documentos de esta categoría
        // se calcularon por unidades físicas (el resto fue por gasto) y
        // la(s) cita(s) de la fuente del factor — del snapshot congelado
        // de la versión con que se calculó cada documento, cuando las
        // filas la traen. Un Set: dos versiones del motor pueden citar
        // fuentes distintas para la misma categoría y ninguna se pierde.
        n_fisico: 0,
        fuentes: new Set(),
      });
    }
    const cat = a.categorias.get(f.categoria);
    sumar(cat, co2e);
    if (f.metodo === 'fisico') cat.n_fisico += 1;
    const cita = citaFuente({ organismo: f.fuente_organismo, documento: f.fuente_documento, version_anio: f.fuente_version_anio });
    if (cita) cat.fuentes.add(cita);
  }

  return {
    alcances: [...porAlcance.entries()]
      .sort(([a], [b]) => a - b)
      .map(([alcance, v]) => ({
        alcance,
        tco2e: r4(v.tco2e),
        n_documentos: v.n_documentos,
        categorias: [...v.categorias.values()]
          .sort((x, y) => y.tco2e - x.tco2e)
          .map(({ fuentes, ...c }) => ({ ...c, tco2e: r4(c.tco2e), fuente_factor: [...fuentes].join('; ') || null })),
      })),
    sin_clasificar: { ...sinClasificar, tco2e: r4(sinClasificar.tco2e) },
  };
}

// Adaptador del flujo público de facturas hacia agregarPorAlcance: traduce
// el vocabulario de `facturas` (categoria = NOMBRE, categoria_codigo aparte,
// origen 'glosa'/'operador'/'sin_coincidencia'/NULL) a la forma que consume
// la agregación. El alcance se resuelve contra el catálogo que le pasa el
// llamador (generateReport ya lo trae congelado por versión del motor
// cuando existe — metodologiaDeVersiones), por código con respaldo por
// nombre, igual que la nota que esta tabla reemplaza.
export function filasDesdeFacturas(facturas = [], alcancesGhg = []) {
  const porCodigo = new Map(alcancesGhg.map((a) => [a.codigo, a.alcance_ghg]));
  const porNombre = new Map(alcancesGhg.map((a) => [a.nombre, a.alcance_ghg]));
  return facturas.map((f) => ({
    categoria: f.categoria_codigo || f.categoria || null,
    categoria_nombre: f.categoria || null,
    alcance_ghg: porCodigo.get(f.categoria_codigo) || porNombre.get(f.categoria) || null,
    co2e: f.total_co2e == null ? null : Number(f.total_co2e),
    // NULL con categoría presente significa "procedencia no registrada"
    // (documentos anteriores a la migración 077 o del motor externo) — se
    // marca explícito para que la agregación no lo rotule con la causa del
    // flujo SII ("descargado antes de la clasificación"), que acá es falsa.
    categoria_origen: (f.categoria_origen == null && f.categoria) ? 'sin_procedencia' : f.categoria_origen,
  }));
}

// Agrega filas crudas (rut_proveedor, alcance_ghg, total_co2e, organismo,
// documento, version_anio) por (proveedor, categoría Alcance 3). Se hace
// en JS porque la clave de agrupación es el número YA PARSEADO del texto
// libre (evita duplicar el regex en SQL) y porque permite juntar, sin
// perder información, más de una descripción textual del motor bajo el
// mismo número de categoría Scope 3 (ej. Cat. 1 sale tanto de
// 'materiales' como de 'agua_potable').
export function agregarAlcance3(rows) {
  const grupos = new Map();
  for (const r of rows) {
    const { alcance, categoria, descripcion } = parsearAlcanceGHG(r.alcance_ghg);
    if (alcance !== 3) continue; // defensivo — la query ya filtra 'Alcance 3%'
    const clave = `${r.rut_proveedor}::${categoria ?? 'sin_categoria'}`;
    if (!grupos.has(clave)) {
      grupos.set(clave, {
        rut_proveedor: r.rut_proveedor,
        categoria_numero: categoria,
        categoria_nombre: categoria ? (CATEGORIAS_ALCANCE3_GHG_PROTOCOL[categoria] || null) : null,
        descripciones: new Set(),
        n_documentos: 0,
        total_tco2e: 0,
        fuente_factor: citaFuente({ organismo: r.organismo, documento: r.documento, version_anio: r.version_anio }),
      });
    }
    const g = grupos.get(clave);
    if (descripcion) g.descripciones.add(descripcion);
    g.n_documentos += 1;
    g.total_tco2e = Math.round((g.total_tco2e + Number(r.total_co2e || 0)) * 10000) / 10000;
  }
  return [...grupos.values()]
    .map(({ descripciones, ...g }) => ({ ...g, descripcion_motor: [...descripciones].join('; ') }))
    .sort((a, b) => a.rut_proveedor.localeCompare(b.rut_proveedor) || (a.categoria_numero ?? 99) - (b.categoria_numero ?? 99));
}
