import { config } from '../config.js';
import { query } from '../lib/db.js';
import { verificarYColapsarItems } from './facturaTexto.js';

// ============================================================
// Análisis de documentos con IA (Anthropic Claude) — camino principal
// de lectura de texto/OCR (reemplaza al parser de reglas cuando está
// disponible; el parser de reglas sigue siendo el respaldo).
//
// Regla dura, igual que el resto del motor: la IA SOLO extrae y
// clasifica (folio, RUTs, ítems, tipo de documento). El cálculo de
// CO2e sigue siendo 100% del motor propio determinista
// (motorPropio.calcularFactura) — nunca lo hace la IA, y su salida
// pasa por las MISMAS guardias que el parser de reglas (tope de monto/
// cantidad, descarte de negativos, verificación cruzada Σítems≈total)
// antes de llegar al cálculo.
//
// Si la IA no está configurada, la llamada falla, se agota el plazo, o
// la respuesta no valida contra el esquema esperado, analizarTexto()
// devuelve null — el llamador (lecturaDocumento.js) cae al parser de
// reglas exactamente como si la IA no existiera. Nunca se rechaza un
// documento solo porque la IA no respondió.
// ============================================================

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

// Mapeo del tipo que declara la IA a la etiqueta legible ya usada por el
// resto del motor (misma taxonomía que TIPOS_DTE_NO_CALCULABLES en
// lecturaDocumento.js y NO_CALCULABLE_RE en facturaTexto.js — un
// documento de estos tipos NUNCA se calcula como factura nueva, porque
// modifica/reversa un documento previo o no representa un gasto en sí).
const ETIQUETAS_NO_CALCULABLE = {
  orden_compra: 'Orden de compra',
  cotizacion: 'Cotización',
  presupuesto: 'Presupuesto',
  guia_despacho: 'Guía de despacho',
  nota_credito: 'Nota de crédito',
  nota_debito: 'Nota de débito',
  liquidacion_factura: 'Liquidación de factura',
};
const TIPOS_VALIDOS = new Set(['factura', 'boleta', 'desconocido', ...Object.keys(ETIQUETAS_NO_CALCULABLE)]);

const HERRAMIENTA = {
  name: 'extraer_documento',
  description: 'Extrae los datos estructurados de un documento comercial/tributario chileno a partir de su texto (puede tener ruido de OCR).',
  input_schema: {
    type: 'object',
    required: ['tipo_documento', 'monto_total', 'items'],
    properties: {
      tipo_documento: {
        type: 'string',
        enum: [...TIPOS_VALIDOS],
        description: 'El tipo que EL DOCUMENTO declara ser (no un tipo que solo cita como referencia).',
      },
      folio: { type: ['string', 'null'] },
      rut_emisor: { type: ['string', 'null'] },
      rut_receptor: { type: ['string', 'null'] },
      fecha: { type: ['string', 'null'], description: 'Formato AAAA-MM-DD si se puede determinar, si no null.' },
      monto_total: { type: 'number', description: 'Monto total del documento en CLP. 0 si no se encuentra.' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          required: ['nombre', 'monto'],
          properties: {
            nombre: { type: 'string' },
            cantidad: { type: ['number', 'null'] },
            unidad: { type: ['string', 'null'] },
            monto: { type: 'number' },
          },
        },
      },
    },
  },
};

function construirPrompt(texto) {
  return `Eres un extractor de datos ESTRICTO para documentos comerciales/tributarios chilenos (facturas, boletas, órdenes de compra, guías de despacho, notas de crédito/débito, cotizaciones). El texto viene de la capa de texto de un PDF o de OCR (puede tener ruido: caracteres mal leídos, saltos de línea irregulares).

REGLAS:
1. NUNCA inventes un dato que no esté en el texto. Si no encuentras un campo, usa null (o 0 para monto_total, o [] para items).
2. "tipo_documento" es el tipo que EL DOCUMENTO declara ser de sí mismo (normalmente en las primeras líneas, ej. "FACTURA ELECTRONICA N° 4521"). Si el documento SOLO menciona otro documento como referencia (ej. una factura que dice "Su Orden de Compra: OC-445"), NO uses ese tipo — usa el tipo que el documento declara ser él mismo. Si de verdad no puedes determinarlo, usa "desconocido".
3. Los ítems son las líneas de detalle con una glosa/descripción y un monto — no incluyas líneas de totales, IVA, RUT, folio, ni descuentos como ítems separados.
4. "cantidad" y "unidad" solo si el texto los declara explícitamente para ese ítem (ej. "500 kWh"); si no, usa null — no asumas cantidad=1 salvo que sea razonable inferirlo del contexto de una sola línea.

Texto del documento:
"""
${String(texto || '').slice(0, 6000)}
"""`;
}

// Valida la respuesta de la IA contra el esquema esperado. Si algo no
// calza, devuelve null — no se actúa sobre una respuesta que no se
// puede confiar; el llamador cae al parser de reglas.
export function validarRespuestaIA(input) {
  if (!input || typeof input !== 'object') return null;
  if (!TIPOS_VALIDOS.has(input.tipo_documento)) return null;
  const montoTotal = Number(input.monto_total);
  if (!Number.isFinite(montoTotal) || montoTotal < 0) return null;
  if (!Array.isArray(input.items)) return null;
  const items = [];
  for (const it of input.items) {
    if (!it || typeof it.nombre !== 'string' || !it.nombre.trim()) continue;
    const monto = Number(it.monto);
    if (!Number.isFinite(monto)) continue;
    const cantidad = it.cantidad == null ? null : Number(it.cantidad);
    items.push({
      nombre: it.nombre.trim().slice(0, 200),
      descripcion: null,
      cantidad: Number.isFinite(cantidad) ? cantidad : 1,
      // Las unidades que reporta la IA NUNCA habilitan el método físico
      // (mismo principio que el parser de reglas): el origen sigue
      // siendo 'texto', así que motorPropio ignora la unidad igual.
      unidad: typeof it.unidad === 'string' ? it.unidad : null,
      monto,
    });
  }
  return {
    tipo_documento: input.tipo_documento,
    folio: typeof input.folio === 'string' ? input.folio : null,
    rut_emisor: typeof input.rut_emisor === 'string' ? input.rut_emisor : null,
    rut_receptor: typeof input.rut_receptor === 'string' ? input.rut_receptor : null,
    fecha: typeof input.fecha === 'string' ? input.fecha : null,
    monto_total: montoTotal,
    items,
  };
}

// ============================================================
// Tope de gasto diario
//
// POST /api/sesiones es público y sin login, y cada archivo puede gatillar
// hasta tres llamadas a la IA (capa de texto + dos pasadas de OCR). El
// costo ya se estimaba y se guardaba en analisis_ia_uso sin que nadie lo
// usara para frenar nada: esto lo usa.
//
// Cómo se cuenta:
//  · La verdad está en la BD (suma del día), pero leerla en cada llamada
//    sería una consulta por documento — se lee cada TTL_LECTURA_MS y entre
//    medio se acumula en memoria lo que se va gastando.
//  · El acumulado en memoria se anota ANTES de intentar el INSERT, no
//    después: si la BD se cae, la bitácora deja de escribirse pero el
//    proceso sigue contando lo que gasta. Sin eso, una BD caída sería
//    justo el momento en que el tope desaparece.
//  · Cada proceso lleva su propia cuenta (pm2 con varias instancias =
//    varios acumuladores), y la relectura periódica de la BD los vuelve a
//    juntar. El tope es un freno de gasto, no una cuota exacta al peso.
// ============================================================
const TTL_LECTURA_MS = 60 * 1000;
const gasto = { dia: null, clp: 0, leidoEn: 0, avisado: false };

// Día calendario en Chile: el presupuesto es diario para quien lo paga, y
// quien lo mira es el admin en Santiago. Con UTC el corte caería a las 20:00
// o 21:00 hora local según el horario de verano — un tope "diario" que se
// reinicia a media tarde no es el que nadie configuró.
const DIA_CL = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit',
});
function diaChile() {
  return DIA_CL.format(new Date());
}

function reiniciarSiCambioElDia() {
  const hoy = diaChile();
  if (gasto.dia !== hoy) {
    gasto.dia = hoy;
    gasto.clp = 0;
    gasto.leidoEn = 0;
    gasto.avisado = false;
  }
}

function anotarGasto(clp) {
  reiniciarSiCambioElDia();
  gasto.clp += clp;
}

// true = no se llama a la IA en este documento. Nunca lanza: un fallo al
// medir el gasto no puede dejar sin lectura a un documento legítimo.
async function presupuestoAgotado() {
  const tope = config.analisisIA.presupuestoDiarioClp;
  if (!Number.isFinite(tope) || tope <= 0) return true;
  reiniciarSiCambioElDia();
  const ahora = Date.now();
  if (ahora - gasto.leidoEn > TTL_LECTURA_MS) {
    gasto.leidoEn = ahora; // se marca aunque falle: no se reintenta por documento
    try {
      const { rows } = await query(
        `SELECT COALESCE(SUM(costo_estimado_clp), 0)::float8 AS clp
           FROM analisis_ia_uso
          WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'America/Santiago') AT TIME ZONE 'America/Santiago'`
      );
      // La suma de la BD reemplaza al acumulado: incluye lo gastado por los
      // demás procesos, y lo propio ya está adentro (se insertó al vuelo).
      // Puede quedar corta por las filas de los últimos milisegundos; el
      // margen es de una llamada, no de un presupuesto.
      gasto.clp = Number(rows[0]?.clp || 0);
    } catch (e) {
      // 42P01 = migración 033 sin correr: no hay bitácora que sumar, se
      // sigue con lo que este proceso lleva contado en memoria.
      if (e.code !== '42P01') console.warn('[analisisIA] no se pudo leer el gasto del día:', e.message);
    }
  }
  return gasto.clp >= tope;
}

// Deja constancia en la bitácora UNA vez por día y por proceso: el admin ve
// en el panel por qué las lecturas de hoy salieron del parser de reglas, sin
// que cada documento saltado escriba su propia fila.
async function avisarPresupuestoAgotado() {
  if (gasto.avisado) return;
  gasto.avisado = true;
  console.warn(
    `[analisisIA] presupuesto diario agotado (${round2(gasto.clp)} de ${config.analisisIA.presupuestoDiarioClp} CLP estimados): ` +
    'los documentos de hoy se leen con el parser de reglas.'
  );
  await logUso({ exito: false, motivoError: 'presupuesto_diario_agotado', latenciaMs: 0 });
}

// Registro de uso (éxito o no) para el panel de transparencia del admin
// — igual patrón que simpleApi.js, tolerante a la tabla ausente (42P01,
// ej. antes de correr la migración 033).
async function logUso({ exito, motivoError, tokensEntrada, tokensSalida, latenciaMs }) {
  const costo = exito
    ? round2((tokensEntrada / 1000) * config.analisisIA.costoInputClp1k + (tokensSalida / 1000) * config.analisisIA.costoOutputClp1k)
    : null;
  if (costo) anotarGasto(costo);
  try {
    await query(
      `INSERT INTO analisis_ia_uso (modelo, exito, motivo_error, tokens_entrada, tokens_salida, costo_estimado_clp, latencia_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [config.analisisIA.modelo, exito, motivoError || null, tokensEntrada || null, tokensSalida || null, costo, latenciaMs]
    );
  } catch (e) {
    if (e.code !== '42P01') console.warn('[analisisIA] no se pudo registrar uso:', e.message);
  }
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Llamada real a la API de Anthropic (Messages API, tool_choice forzado
// para obtener JSON estructurado válido contra el esquema en vez de
// prosa que haya que parsear a mano).
async function llamarClaude(texto) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.analisisIA.timeoutMs);
  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'x-api-key': config.analisisIA.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.analisisIA.modelo,
        max_tokens: 1024,
        tools: [HERRAMIENTA],
        tool_choice: { type: 'tool', name: HERRAMIENTA.name },
        messages: [{ role: 'user', content: construirPrompt(texto) }],
      }),
    });
    if (!res.ok) {
      // El cuerpo trae el motivo real (clave inválida, sin crédito, modelo
      // desconocido, etc.) — capturarlo es lo que permite diagnosticar
      // desde el panel de admin en vez de solo ver "Anthropic API 400".
      const cuerpo = await res.json().catch(() => null);
      const detalle = cuerpo?.error?.message || cuerpo?.error?.type;
      throw new Error(`Anthropic API ${res.status}${detalle ? `: ${detalle}` : ''}`);
    }
    const data = await res.json();
    const bloque = (data.content || []).find((b) => b.type === 'tool_use');
    if (!bloque) throw new Error('Sin bloque tool_use en la respuesta');
    return { input: bloque.input, usage: data.usage || {} };
  } finally {
    clearTimeout(timeout);
  }
}

// Expuesto para los tests (y para un eventual panel que quiera mostrar el
// gasto del día sin volver a consultar): `reiniciar()` borra el acumulado en
// memoria, que es lo único que hace falta para aislar un caso de otro.
export const presupuestoIA = {
  agotado: presupuestoAgotado,
  anotarGasto,
  gastoEnMemoria: () => round2(gasto.clp),
  reiniciar() {
    gasto.dia = null;
    gasto.clp = 0;
    gasto.leidoEn = 0;
    gasto.avisado = false;
  },
};

export const analisisIA = {
  get enabled() {
    return config.analisisIA.enabled;
  },

  // Analiza el texto extraído de un documento (PDF/OCR). Devuelve:
  //  - null                                    si no disponible/falla/inválido
  //  - { tipo_no_calculable, senal_suficiente, folio, rut_emisor,
  //      rut_receptor, fecha, monto_total, items, verificaciones }
  async analizarTexto(texto) {
    if (!config.analisisIA.enabled) return null;
    if (!texto || !String(texto).trim()) return null;
    // Tope de gasto del día: se devuelve null igual que cuando la IA no
    // está configurada, así que lecturaDocumento.js cae al parser de
    // reglas sin enterarse. El documento se lee igual; lo que se pierde
    // es la lectura flexible, no el cálculo.
    if (await presupuestoAgotado()) {
      await avisarPresupuestoAgotado();
      return null;
    }
    const t0 = Date.now();
    let resultado;
    try {
      resultado = await llamarClaude(texto);
    } catch (e) {
      await logUso({ exito: false, motivoError: e.message, latenciaMs: Date.now() - t0 });
      return null;
    }
    const validado = validarRespuestaIA(resultado.input);
    if (!validado) {
      await logUso({ exito: false, motivoError: 'esquema_invalido', latenciaMs: Date.now() - t0 });
      return null;
    }
    await logUso({
      exito: true,
      tokensEntrada: resultado.usage.input_tokens,
      tokensSalida: resultado.usage.output_tokens,
      latenciaMs: Date.now() - t0,
    });

    if (ETIQUETAS_NO_CALCULABLE[validado.tipo_documento]) {
      return { tipo_no_calculable: ETIQUETAS_NO_CALCULABLE[validado.tipo_documento] };
    }
    if (validado.tipo_documento === 'desconocido') {
      // Confianza insuficiente de la propia IA: ni se rechaza ni se
      // calcula con esta lectura — el llamador cae al parser de reglas.
      return null;
    }
    // 'factura' | 'boleta': misma protección anti-alucinación que el
    // parser de reglas (colapso si Σítems no cuadra con el total).
    const { items, verificaciones } = verificarYColapsarItems(validado.items, validado.monto_total);
    return {
      tipo_no_calculable: null,
      folio: validado.folio,
      rut_emisor: validado.rut_emisor,
      rut_receptor: validado.rut_receptor,
      fecha: validado.fecha,
      monto_total: validado.monto_total,
      items,
      senal_suficiente: validado.monto_total > 0,
      verificaciones,
    };
  },
};
