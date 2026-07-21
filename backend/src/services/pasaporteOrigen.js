import crypto from 'crypto';
import { GENESIS, hashCadena } from './cadenaHash.js';
import { rutValido } from './dte.js';

// ============================================================
// Pasaporte de Origen — lógica pura del módulo de trazabilidad
// minera multi-eslabón (estilo Minespider, migración 021).
//
// Todo es determinista y sin BD: la ruta (routes/origen.js) hace el
// I/O; aquí viven el hash por lote, las validaciones server-side, la
// divulgación selectiva, el balance de masas y el resumen normativo
// (OECD DDG / CBAM / DPP). sicr3p registra y estructura declaraciones
// verificables — NUNCA certifica ni audita (regla de honestidad).
// ============================================================

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const NORM = (rut) => String(rut || '').replace(/[^0-9kK]/g, '').toLowerCase();
// rutValido (dte.js) exige el formato cuerpo-DV: se reconstruye desde el normalizado.
const rutNormalizadoValido = (rutNorm) =>
  rutNorm.length >= 2 && rutValido(`${rutNorm.slice(0, -1)}-${rutNorm.slice(-1)}`);

// ---------- Roles de la cadena de custodia ----------
export const ROLES = ['mina', 'planta', 'refineria', 'transporte', 'comerciante', 'exportador', 'comprador'];
// Orden esperado aguas abajo; 'transporte' es comodín intercalable (0).
export const ORDEN_ROL = {
  mina: 1, planta: 2, refineria: 3, comerciante: 4, exportador: 5, comprador: 6, transporte: 0,
};

// Advierte (nunca bloquea) si la secuencia de roles retrocede — una
// refinería antes que la planta puede ser legítimo pero merece revisión.
export function validarSecuenciaRoles(eslabones) {
  const advertencias = [];
  let max = 0;
  for (const e of eslabones || []) {
    const orden = ORDEN_ROL[e.rol] ?? 0;
    if (orden === 0) continue; // transporte se intercala donde sea
    if (orden < max) {
      advertencias.push(`El eslabón #${e.eslabon} (${e.rol}) va después de un rol más avanzado en la cadena.`);
    }
    max = Math.max(max, orden);
  }
  return advertencias;
}

// ---------- Hash canónico del eslabón ----------
// Mismo estilo que hashDocumento (cadenaHash.js): orden fijo, números
// con toFixed(4). El nonce dentro del preimage hace segura la
// divulgación selectiva: el hash de un eslabón oculto no se puede
// confirmar por diccionario sin el nonce.
export function hashEslabonLote({ lote_codigo, eslabon, rol, rut_empresa, pais, fecha, cantidad, co2e_aportado, factura_numero, nonce }) {
  const canonico = [
    lote_codigo || '', String(eslabon || 0), rol || '', NORM(rut_empresa),
    pais || '', fecha || '',
    Number(cantidad || 0).toFixed(4), Number(co2e_aportado || 0).toFixed(4),
    factura_numero || '', nonce || '',
  ].join('|');
  return sha256(canonico);
}

export function generarNonce() {
  return crypto.randomBytes(16).toString('hex');
}

// ---------- Validación server-side de un eslabón nuevo ----------
export function validarEslabon(input, lote, eslabonesPrevios = []) {
  const errores = [];
  const advertencias = [];
  const e = input || {};

  if (!lote) errores.push('Lote inexistente.');
  else if (lote.estado !== 'abierto') errores.push('El lote está cerrado: no se pueden agregar eslabones.');

  if (!ROLES.includes(e.rol)) errores.push(`Rol inválido. Debe ser uno de: ${ROLES.join(', ')}.`);

  const pais = String(e.pais || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(pais)) errores.push('País debe ser código ISO-2 (ej: CL, AR).');

  // RUT: obligatorio solo para actores chilenos; extranjeros usan
  // datos.tax_id_extranjero. Módulo 11 SOLO si el país es CL.
  const rut = NORM(e.rut_empresa);
  if (pais === 'CL') {
    if (!rut) errores.push('Actor chileno requiere RUT.');
    else if (!rutNormalizadoValido(rut)) errores.push('RUT inválido (dígito verificador).');
  } else if (rut && !rutNormalizadoValido(rut)) {
    advertencias.push('El RUT informado no valida módulo 11 (actor no chileno: se acepta como identificador).');
  }

  const fecha = e.fecha ? new Date(e.fecha) : null;
  if (!fecha || Number.isNaN(fecha.getTime())) errores.push('Fecha inválida.');
  else if (fecha.getTime() > Date.now() + 24 * 3600 * 1000) errores.push('La fecha no puede ser futura.');

  if (e.cantidad != null) {
    const c = Number(e.cantidad);
    if (!Number.isFinite(c) || c <= 0) errores.push('Cantidad debe ser un número mayor que 0.');
    else if (lote && c > Number(lote.cantidad) * 1.0001) {
      errores.push(`La cantidad del eslabón (${c}) no puede superar la del lote (${lote.cantidad}).`);
    }
  }

  const co2e = Number(e.co2e_aportado ?? 0);
  if (!Number.isFinite(co2e) || co2e < 0) errores.push('co2e_aportado debe ser un número ≥ 0.');

  if (!['publico', 'cadena', 'privado'].includes(e.visibilidad || 'publico')) {
    errores.push('Visibilidad inválida (publico | cadena | privado).');
  }

  advertencias.push(...validarSecuenciaRoles([...(eslabonesPrevios || []), { ...e, eslabon: (eslabonesPrevios?.length || 0) + 1 }]));

  return { ok: errores.length === 0, errores, advertencias, rut_normalizado: rut || null, pais };
}

// ---------- Balance de masas ----------
// Compara la cantidad declarada por cada eslabón contra la anterior.
// La merma legítima existe (concentrado → cátodo); por eso ADVIERTE y
// nunca bloquea. Tolerancia constante afinable por material a futuro.
export const TOLERANCIA_MERMA_PCT = 5;

export function balanceMasas(lote, eslabones) {
  const conCantidad = (eslabones || []).filter((e) => e.cantidad != null);
  const cantidadLote = Number(lote?.cantidad || 0);
  if (!conCantidad.length) {
    return { cantidad_lote: cantidadLote, ultima_cantidad: null, merma_pct: 0, alerta: false };
  }
  const ultima = Number(conCantidad[conCantidad.length - 1].cantidad);
  const base = Number(conCantidad[0].cantidad) || cantidadLote;
  const merma = base > 0 ? ((base - ultima) / base) * 100 : 0;
  return {
    cantidad_lote: cantidadLote,
    ultima_cantidad: ultima,
    merma_pct: Math.round(merma * 100) / 100,
    alerta: merma > TOLERANCIA_MERMA_PCT,
  };
}

// ---------- Divulgación selectiva ----------
// Niveles: publico < cadena < privado. Los campos de INTEGRIDAD
// (eslabon, rol, pais, fecha, hashes) se exponen SIEMPRE — la cadena
// debe ser verificable por cualquiera. El contenido comercial (rut,
// nombre, cantidad, co2e, datos, factura) respeta la visibilidad del
// eslabón. El nonce NO sale jamás, a ningún nivel.
const NIVEL = { publico: 1, cadena: 2, privado: 3 };

export function filtrarPorVisibilidad(eslabones, nivelLector = 'publico') {
  const nl = NIVEL[nivelLector] || 1;
  return (eslabones || []).map((e) => {
    const base = {
      eslabon: e.eslabon,
      rol: e.rol,
      pais: e.pais,
      fecha: e.fecha,
      hash_documento: e.hash_documento,
      hash_anterior: e.hash_anterior,
      hash_cadena: e.hash_cadena,
      visibilidad: e.visibilidad,
      divulgado: (NIVEL[e.visibilidad] || 1) <= nl,
    };
    if (!base.divulgado) return base;
    return {
      ...base,
      rut_empresa: e.rut_empresa ?? null,
      nombre_empresa: e.nombre_empresa ?? null,
      cantidad: e.cantidad ?? null,
      co2e_aportado: e.co2e_aportado ?? null,
      factura_id: e.factura_id ?? null,
      datos: e.datos ?? {},
    };
  });
}

// Máscara pública de RUT: 76.123.456-0 → 76.***.**6-0 (se reconoce a
// quién SÍ divulgó sin regalar el identificador completo a scrapers).
export function enmascararRut(rut) {
  const limpio = NORM(rut);
  if (limpio.length < 4) return null;
  const dv = limpio.slice(-1);
  const cuerpo = limpio.slice(0, -1);
  return `${cuerpo.slice(0, 2)}.***.**${cuerpo.slice(-1)}-${dv}`;
}

// ---------- Catálogo normativo ----------
// OECD DDG (5 pasos) + Anexo II + campos DPP. Los textos legibles van
// en el frontend (i18n); aquí solo los códigos y su agrupación.
export const CATALOGO_DECLARACIONES = [
  { codigo: 'oecd_p1', grupo: 'oecd_pasos' },  // sistema de gestión y política de cadena
  { codigo: 'oecd_p2', grupo: 'oecd_pasos' },  // identificación/evaluación de riesgos (CAHRA)
  { codigo: 'oecd_p3', grupo: 'oecd_pasos' },  // estrategia de respuesta a riesgos
  { codigo: 'oecd_p4', grupo: 'oecd_pasos' },  // auditoría independiente (se registra, no se realiza)
  { codigo: 'oecd_p5', grupo: 'oecd_pasos' },  // informe público anual
  { codigo: 'oecd_a2_conflicto', grupo: 'oecd_anexo2' },  // sin apoyo a grupos armados no estatales
  { codigo: 'oecd_a2_ddhh', grupo: 'oecd_anexo2' },       // sin abusos graves de DD.HH.
  { codigo: 'oecd_a2_corrupcion', grupo: 'oecd_anexo2' }, // sin soborno / lavado
  { codigo: 'oecd_a2_tributos', grupo: 'oecd_anexo2' },   // pago de impuestos y regalías (línea EITI)
  { codigo: 'dpp_identificador', grupo: 'dpp' },
  { codigo: 'dpp_composicion', grupo: 'dpp' },
  { codigo: 'dpp_actores', grupo: 'dpp' },
];
const CODIGOS_VALIDOS = new Set(CATALOGO_DECLARACIONES.map((d) => d.codigo));
export function codigoDeclaracionValido(codigo) {
  return CODIGOS_VALIDOS.has(codigo);
}

// ---------- CBAM ----------
// Capítulos/códigos NC del Anexo I vigente del Reglamento (UE) 2023/956:
// cemento (2523), electricidad (2716), hidrógeno (2804), fertilizantes
// (2808/2814/3102/3105), hierro y acero (72/73), aluminio (76).
// El COBRE no está — cbamAplicable lo dice honestamente y el flag se
// actualiza solo editando esta lista si la UE amplía el anexo.
export const CAPITULOS_NC_CBAM = ['2523', '2716', '2804', '2808', '2814', '3102', '3105', '72', '73', '76'];

export function validarNc(nc) {
  return /^\d{4}(\d{2})?(\d{2})?$/.test(String(nc || ''));
}

export function cbamAplicable(codigoNc) {
  const nc = String(codigoNc || '');
  if (!validarNc(nc)) return false;
  return CAPITULOS_NC_CBAM.some((cap) => nc.startsWith(cap));
}

// ---------- Emisiones incorporadas: declarado vs trazado ----------
// Suma server-side del co2e de los eslabones (t CO2e) dividida por las
// toneladas del lote, contrastada con lo que el titular declaró por
// tonelada. Divergencia > 20% ⇒ advertencia "declarado vs trazado".
export const TOLERANCIA_DIVERGENCIA_PCT = 20;

export function emisionesIncorporadasPorTonelada(lote, eslabones) {
  const toneladas = lote?.unidad === 'kg' ? Number(lote.cantidad) / 1000 : Number(lote?.cantidad || 0);
  const trazadoTotal = (eslabones || []).reduce((s, e) => s + Number(e.co2e_aportado || 0), 0);
  const trazado_t = toneladas > 0 ? Math.round((trazadoTotal / toneladas) * 1e6) / 1e6 : null;
  const declarado_t = (lote?.emisiones_directas_tco2e_t != null || lote?.emisiones_indirectas_tco2e_t != null)
    ? Math.round((Number(lote.emisiones_directas_tco2e_t || 0) + Number(lote.emisiones_indirectas_tco2e_t || 0)) * 1e6) / 1e6
    : null;
  let divergencia_pct = null;
  let advertencia = false;
  if (trazado_t != null && declarado_t != null && declarado_t > 0) {
    divergencia_pct = Math.round(Math.abs(trazado_t - declarado_t) / declarado_t * 10000) / 100;
    advertencia = divergencia_pct > TOLERANCIA_DIVERGENCIA_PCT;
  }
  return { trazado_t, declarado_t, divergencia_pct, advertencia };
}

// ---------- Resumen normativo del lote ----------
export function resumenNormativo(lote, declaraciones = []) {
  const porCodigo = new Map(declaraciones.map((d) => [d.codigo, d]));
  const cubierto = (c) => {
    const d = porCodigo.get(c);
    return d && (d.estado === 'declarado' || d.estado === 'con_evidencia');
  };
  const conEvidencia = (c) => porCodigo.get(c)?.estado === 'con_evidencia';

  const pasos = ['oecd_p1', 'oecd_p2', 'oecd_p3', 'oecd_p4', 'oecd_p5'];
  const anexo2 = ['oecd_a2_conflicto', 'oecd_a2_ddhh', 'oecd_a2_corrupcion', 'oecd_a2_tributos'];

  const faltantesCbam = [];
  if (!validarNc(lote?.codigo_nc)) faltantesCbam.push('codigo_nc');
  if (lote?.emisiones_directas_tco2e_t == null) faltantesCbam.push('emisiones_directas');
  if (lote?.emisiones_indirectas_tco2e_t == null) faltantesCbam.push('emisiones_indirectas');
  if (!lote?.metodo_emisiones) faltantesCbam.push('metodo');
  if (!lote?.faena_origen) faltantesCbam.push('instalacion');

  const faltantesDpp = [];
  if (!lote?.codigo) faltantesDpp.push('identificador');
  if (!lote?.composicion || !Object.keys(lote.composicion).length) faltantesDpp.push('composicion');
  if ((lote?.n_eslabones ?? 0) === 0) faltantesDpp.push('actores');

  return {
    oecd: {
      pasos_cubiertos: pasos.filter(cubierto).length,
      pasos_total: pasos.length,
      pasos_con_evidencia: pasos.filter(conEvidencia).length,
      anexo2_cubiertas: anexo2.filter(cubierto).length,
      anexo2_total: anexo2.length,
    },
    cbam: {
      aplicable: cbamAplicable(lote?.codigo_nc),
      listo: faltantesCbam.length === 0,
      faltantes: faltantesCbam,
    },
    dpp: {
      listo: faltantesDpp.length === 0,
      faltantes: faltantesDpp,
    },
  };
}

// ---------- Código de lote ----------
export function generarCodigoLote(anio, correlativo) {
  return `LM-${anio}-${String(correlativo).padStart(6, '0')}`;
}

// ---------- Tarjeta de Viaje (NFC/RFID que acompaña a la carga) ----------
// Serial corto imprimible/grabable en el NDEF de la tarjeta: TV-XXXX.
// Mismo espíritu que generarSerial() de posTerminal.js (AV-XXXX).
export function generarSerialTarjeta() {
  return `TV-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

export function serialTarjetaValido(s) {
  return /^TV-[0-9A-F]{4}$/.test(String(s || ''));
}

// ---------- Anclaje del lote en la cadena GLOBAL ----------
// Al cerrar un lote, su hash final se sella como eslabón de la cadena
// global (junto a las facturas). Preimage canónico con prefijo literal
// para que jamás colisione con el de un documento.
export function hashAnclajeLote({ codigo, ultimo_hash, n_eslabones }) {
  const canonico = ['anclaje-lote', codigo || '', ultimo_hash || '', String(n_eslabones || 0)].join('|');
  return sha256(canonico);
}

// Re-export de las primitivas de cadena que la ruta necesita junto a
// este servicio (una sola importación en routes/origen.js).
export { GENESIS, hashCadena };
