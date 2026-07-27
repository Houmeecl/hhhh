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

// ---------- Tipos de pasaporte (migración 023) ----------
// 'mineral'    → cadena minera (lo original de 021).
// 'producto'   → productos de comercios de ciudad (mostrador sicr3p) —
//                cualquier rubro, jamás amarrado a minería.
// 'documental' → Corredor Bioceánico: trazabilidad de carga/documentos
//                por tramos (vinculable a documentos_corredor).
export const TIPOS = ['mineral', 'producto', 'documental'];

export const CATALOGO_MATERIALES = {
  mineral: ['cobre_catodo', 'concentrado_cobre', 'litio_carbonato', 'oro', 'otro'],
  producto: ['alimentos', 'bebidas', 'textil', 'embalajes', 'manufactura', 'quimicos', 'otro'],
  documental: ['carga_general', 'carga_refrigerada', 'granel', 'contenedor', 'documentos'],
};

export function materialValido(tipo, material) {
  return (CATALOGO_MATERIALES[tipo] || []).includes(material);
}

// ---------- Roles de la cadena de custodia (por tipo) ----------
export const ROLES_POR_TIPO = {
  mineral: ['mina', 'planta', 'refineria', 'transporte', 'comerciante', 'exportador', 'comprador'],
  producto: ['productor', 'proveedor', 'transporte', 'comercio', 'punto_aduana_verde', 'comprador'],
  documental: ['origen', 'transporte', 'deposito', 'frontera', 'puerto', 'destino'],
};
// Compatibilidad: superset de todos los roles (usado por el catálogo).
export const ROLES = [...new Set(Object.values(ROLES_POR_TIPO).flat())];

// Orden esperado aguas abajo por tipo; orden 0 = comodín intercalable.
export const ORDEN_ROL_POR_TIPO = {
  mineral: { mina: 1, planta: 2, refineria: 3, comerciante: 4, exportador: 5, comprador: 6, transporte: 0 },
  producto: { productor: 1, proveedor: 2, comercio: 3, punto_aduana_verde: 4, comprador: 5, transporte: 0 },
  documental: { origen: 1, deposito: 0, frontera: 0, puerto: 0, destino: 2, transporte: 0 },
};
// Compatibilidad con llamadas antiguas (tipo mineral).
export const ORDEN_ROL = ORDEN_ROL_POR_TIPO.mineral;

// Advierte (nunca bloquea) si la secuencia de roles retrocede — una
// refinería antes que la planta puede ser legítimo pero merece revisión.
export function validarSecuenciaRoles(eslabones, tipo = 'mineral') {
  const orden = ORDEN_ROL_POR_TIPO[tipo] || ORDEN_ROL_POR_TIPO.mineral;
  const advertencias = [];
  let max = 0;
  for (const e of eslabones || []) {
    const o = orden[e.rol] ?? 0;
    if (o === 0) continue; // comodines se intercalan donde sea
    if (o < max) {
      advertencias.push(`El eslabón #${e.eslabon} (${e.rol}) va después de un rol más avanzado en la cadena.`);
    }
    max = Math.max(max, o);
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

  const tipo = lote?.tipo || 'mineral';
  const rolesPermitidos = ROLES_POR_TIPO[tipo] || ROLES_POR_TIPO.mineral;
  if (!rolesPermitidos.includes(e.rol)) {
    errores.push(`Rol inválido para un pasaporte ${tipo}. Debe ser uno de: ${rolesPermitidos.join(', ')}.`);
  }

  const pais = String(e.pais || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(pais)) errores.push('País debe ser código ISO-2 (ej: CL, AR).');

  // RUT: obligatorio para actores chilenos, SALVO el rol 'transporte':
  // esos pasos los registra el portador de la tarjeta de viaje y su
  // identidad la da la clave de la tarjeta (queda en datos.tarjeta_serial),
  // no un RUT que el chofer no tiene por qué portar. Si el RUT viene,
  // se valida módulo 11 igual. Extranjeros usan datos.tax_id_extranjero.
  const rut = NORM(e.rut_empresa);
  if (pais === 'CL') {
    if (!rut && e.rol !== 'transporte') errores.push('Actor chileno requiere RUT.');
    else if (rut && !rutNormalizadoValido(rut)) errores.push('RUT inválido (dígito verificador).');
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

  advertencias.push(...validarSecuenciaRoles(
    [...(eslabonesPrevios || []), { ...e, eslabon: (eslabonesPrevios?.length || 0) + 1 }],
    tipo
  ));

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
    // Honestidad: la due diligence OECD de MINERALES solo aplica a lotes
    // minerales — un lote de alimentos o una carga documental no la
    // declara. Para otros tipos va null y el frontend/PDF la omiten.
    oecd: (lote?.tipo || 'mineral') !== 'mineral' ? null : {
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

// ---------- Export CBAM para mandantes (mandante.js) ----------
// Aplana un lote YA anotado con su `cbam` (ver resumenNormativo) a la fila
// plana que consume el CSV del export — mapeo puro, testeable sin BD, mismo
// espíritu que agregarAlcance3() en alcanceGhg.js.
export function filaCbamCsv(loteConCbam) {
  return {
    codigo: loteConCbam.codigo,
    pais_origen: loteConCbam.pais_origen,
    material: loteConCbam.material,
    codigo_nc: loteConCbam.codigo_nc ?? '',
    cbam_aplicable: loteConCbam.cbam.aplicable ? 'si' : 'no',
    metodo_emisiones: loteConCbam.metodo_emisiones ?? '',
    emisiones_directas_tco2e_t: loteConCbam.emisiones_directas_tco2e_t ?? '',
    emisiones_indirectas_tco2e_t: loteConCbam.emisiones_indirectas_tco2e_t ?? '',
    cbam_listo: loteConCbam.cbam.listo ? 'si' : 'no',
    cbam_faltantes: loteConCbam.cbam.faltantes.join(';'),
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

// ---------- Credencial de Firma del Proveedor (atestación, migración 038) ----------
// NO es firma electrónica con validez legal (Ley N° 19.799) — es una
// atestación sellada por hash. La identidad (rut_empresa/nombre_empresa)
// la fija el EMISOR de la credencial al crearla; el firmante nunca la
// declara. Mismo espíritu de serial corto que generarSerialTarjeta.
export function generarSerialCredencialProveedor() {
  return `FP-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

export function serialCredencialProveedorValido(s) {
  return /^FP-[0-9A-F]{4}$/.test(String(s || ''));
}

// Identidad que el ADMIN fija al emitir la credencial — se valida acá,
// no al firmar (para no descubrir un RUT inválido recién en ese momento).
// Reusa las mismas reglas de validarEslabon (RUT chileno módulo 11).
export function validarIdentidadProveedor({ rut_empresa, nombre_empresa } = {}) {
  const errores = [];
  const rut = NORM(rut_empresa);
  if (!rut) errores.push('rut_empresa es obligatorio.');
  else if (!rutNormalizadoValido(rut)) errores.push('RUT inválido (dígito verificador).');
  if (!String(nombre_empresa || '').trim()) errores.push('nombre_empresa es obligatorio.');
  return { ok: errores.length === 0, errores, rut_normalizado: rut || null };
}

// Emitir la credencial solo tiene sentido si el tipo del lote incluye el
// rol 'proveedor' en su cadena de custodia (hoy solo 'producto') — se
// valida ANTES de crear la credencial, no se delega en validarEslabon
// (que recién correría al firmar, mucho después de emitida la clave).
export function loteAdmiteProveedor(lote) {
  return (ROLES_POR_TIPO[lote?.tipo] || []).includes('proveedor');
}

// ---------- Anclaje del lote en la cadena GLOBAL ----------
// Al cerrar un lote, su hash final se sella como eslabón de la cadena
// global (junto a las facturas). Preimage canónico con prefijo literal
// para que jamás colisione con el de un documento.
export function hashAnclajeLote({ codigo, ultimo_hash, n_eslabones }) {
  const canonico = ['anclaje-lote', codigo || '', ultimo_hash || '', String(n_eslabones || 0)].join('|');
  return sha256(canonico);
}

// ---------- Torre de control (migraciones 024/025) ----------
// Instrucciones operativas de la torre al portador: dirigirse al puerto
// seco (interior), al puerto (terminal marítimo) o a una ZONA DE
// ESTACIONAMIENTO designada (ej. "Zona E-3, La Negra"). NO son
// eslabones: no entran en la cadena de hash del lote.
export const DESTINOS_TORRE = ['puerto_seco', 'puerto', 'estacionamiento'];

export function destinoTorreValido(d) {
  return DESTINOS_TORRE.includes(d);
}

// Valida el mensaje completo de la torre: destino del catálogo y, si es
// estacionamiento, zona obligatoria (¿a cuál mando al chofer si no?).
// Devuelve la zona/nota ya saneadas para insertar.
export function validarMensajeTorre({ destino, zona, nota } = {}) {
  if (!destinoTorreValido(destino)) {
    return { ok: false, error: `Destino inválido. Uno de: ${DESTINOS_TORRE.join(', ')}.` };
  }
  const zonaLimpia = String(zona || '').trim().slice(0, 60) || null;
  if (destino === 'estacionamiento' && !zonaLimpia) {
    return { ok: false, error: 'Para estacionamiento debes indicar la zona (ej: "Zona E-3, La Negra").' };
  }
  return {
    ok: true,
    destino,
    zona: destino === 'estacionamiento' ? zonaLimpia : null,
    nota: String(nota || '').trim().slice(0, 200) || null,
  };
}

// Sanea el identificador de punto de control declarado por el portador
// (catálogo del corredor en el frontend): slug [a-z0-9-] de hasta 40.
// Devuelve null si no queda nada utilizable.
export function sanearPuntoId(v) {
  const s = String(v || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
  return s || null;
}

// Re-export de las primitivas de cadena que la ruta necesita junto a
// este servicio (una sola importación en routes/origen.js).
export { GENESIS, hashCadena };
