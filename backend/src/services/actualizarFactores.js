import { config } from '../config.js';
import { query } from '../lib/db.js';

// ============================================================
// «Actualizar»: buscar la versión vigente de las fuentes metodológicas.
//
// REGLA DURA, la misma de analisisIA.js: la IA busca y PROPONE; nunca
// escribe un factor. Lo que devuelve entra en `propuestas_factores` como
// pendiente, y solo una persona puede aprobarla — y aprobarla es lo que
// congela una versión nueva del motor (migración 051). Un factor de
// emisión que llegó a producción porque un modelo lo leyó en una página
// es justamente lo que no se puede defender ante un auditor.
//
// Se usa la herramienta de servidor `web_search`: corre del lado de
// Anthropic, así que no hay scraper que mantener ni sitios que se caigan,
// y devuelve las citas con URL — que es lo que hay que guardar para poder
// verificar la propuesta después.
//
// Se llama con fetch directo y no con el SDK por consistencia: la
// integración que ya existe (analisisIA.js) es así y el backend no tiene
// el paquete `anthropic` instalado. Mismo endpoint, mismos encabezados,
// mismo manejo de plazo y de error.
// ============================================================

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

// Modelo deliberadamente distinto al de la extracción de documentos
// (sonnet por defecto): esto es un botón manual, unas pocas llamadas al
// año, y acá conviene la lectura más cuidadosa.
export const MODELO = process.env.ACTUALIZAR_FACTORES_MODELO || 'claude-opus-5';
const TIMEOUT_MS = parseInt(process.env.ACTUALIZAR_FACTORES_TIMEOUT_MS || '120000', 10);

const CAMPOS = new Set(['factor_fisico_kgco2e', 'factor_gasto_kgco2e_clp1000', 'fuente_version_anio']);

const HERRAMIENTA = {
  name: 'reportar_hallazgos',
  description: 'Reporta los factores de emisión y versiones de documento encontrados en fuentes oficiales.',
  input_schema: {
    type: 'object',
    required: ['hallazgos'],
    properties: {
      hallazgos: {
        type: 'array',
        description: 'Un elemento por cada valor que difiere del vigente. Vacío si todo está al día.',
        items: {
          type: 'object',
          required: ['categoria_codigo', 'campo', 'valor_propuesto', 'fuente_url', 'justificacion'],
          properties: {
            categoria_codigo: { type: 'string', description: 'El código exacto de la categoría entregada en el listado.' },
            campo: { type: 'string', enum: [...CAMPOS] },
            valor_propuesto: { type: 'string', description: 'El valor nuevo. Para factores, número con punto decimal.' },
            fuente_url: { type: 'string', description: 'URL exacta del documento oficial donde se leyó el valor.' },
            fuente_titulo: { type: ['string', 'null'] },
            fuente_anio: { type: ['string', 'null'] },
            justificacion: { type: 'string', description: 'Qué dice la fuente y por qué reemplaza al valor vigente.' },
          },
        },
      },
    },
  },
};

function construirPrompt(categorias) {
  const listado = categorias.map((c) => [
    `- codigo: ${c.codigo} (${c.nombre})`,
    c.unidad_fisica ? `  factor_fisico_kgco2e vigente: ${c.factor_fisico_kgco2e} kgCO2e/${c.unidad_fisica}` : null,
    `  factor_gasto_kgco2e_clp1000 vigente: ${c.factor_gasto_kgco2e_clp1000} kgCO2e/$1.000 CLP`,
    c.fuente ? `  fuente declarada: ${c.fuente}` : null,
    c.fuente_organismo ? `  fuente registrada: ${c.fuente_organismo} — ${c.fuente_documento} (${c.fuente_version_anio || 'sin año'})` : null,
  ].filter(Boolean).join('\n')).join('\n');

  return `Eres un asistente de investigación metodológica para una plataforma chilena de contabilidad de carbono. Tu tarea es BUSCAR en fuentes oficiales si los factores de emisión vigentes quedaron desactualizados.

FACTORES VIGENTES HOY:
${listado}

FUENTES QUE DEBES CONSULTAR (son las que la plataforma ya declara):
- Ministerio del Medio Ambiente de Chile — Programa HuellaChile (factor de electricidad del Sistema Eléctrico Nacional)
- IPCC — Guidelines for National Greenhouse Gas Inventories
- DEFRA / UK Government GHG Conversion Factors
- GLEC Framework (Smart Freight Centre)
- GHG Protocol Corporate Standard (WRI/WBCSD)

REGLAS, en orden de importancia:
1. NO INVENTES NINGÚN NÚMERO. Solo reporta un valor si lo leíste en una página que encontraste con la búsqueda, y entrega su URL exacta. Sin URL verificable, no lo reportes.
2. Si no encontraste nada más nuevo que lo vigente, devuelve una lista vacía. "Todo al día" es una respuesta correcta y esperable; inventar un cambio para parecer útil es el peor resultado posible.
3. Prefiere la publicación oficial del organismo por sobre resúmenes, notas de prensa o blogs. Si solo encuentras una fuente secundaria, dilo explícitamente en la justificación.
4. Los factores por gasto (kgCO2e por $1.000 CLP) casi nunca están publicados directamente por estos organismos: son proxis propios de la plataforma. NO propongas cambiarlos salvo que encuentres una publicación que entregue un factor de intensidad económica aplicable a Chile, y déjalo dicho en la justificación.
5. El valor del factor físico va en la unidad que ya usa la categoría. Si la fuente publica en otra unidad, conviértelo y explica la conversión en la justificación.
6. Reporta también cuando lo único que cambió es la EDICIÓN del documento (campo fuente_version_anio), aunque el número siga igual: saber que la cita quedó vieja también importa.

Devuelve tu resultado llamando a la herramienta reportar_hallazgos.`;
}

// Valida y normaliza lo que devolvió el modelo. Nada entra a la base sin
// pasar por acá: un hallazgo sin URL, con un campo desconocido, con una
// categoría que no existe o con un "número" que no es número, se descarta
// en silencio en vez de contaminar la bandeja de propuestas.
// PURA y exportada para test.
export function validarHallazgos(entrada, codigosValidos) {
  const lista = Array.isArray(entrada?.hallazgos) ? entrada.hallazgos : [];
  const validos = [];
  const descartados = [];
  const vistos = new Set();

  for (const h of lista) {
    const motivo = (m) => { descartados.push({ hallazgo: h, motivo: m }); };
    if (!h || typeof h !== 'object') { motivo('no es un objeto'); continue; }

    const codigo = String(h.categoria_codigo || '').trim();
    if (!codigosValidos.has(codigo)) { motivo(`categoría desconocida: ${codigo || '(vacía)'}`); continue; }

    const campo = String(h.campo || '').trim();
    if (!CAMPOS.has(campo)) { motivo(`campo no admitido: ${campo || '(vacío)'}`); continue; }

    // Sin URL no se puede verificar, y lo que no se puede verificar no se
    // aprueba: se descarta acá en vez de dejarlo esperando en la bandeja.
    const url = String(h.fuente_url || '').trim();
    if (!/^https?:\/\/\S+$/i.test(url)) { motivo('sin URL verificable'); continue; }

    const valor = String(h.valor_propuesto ?? '').trim();
    if (!valor) { motivo('valor propuesto vacío'); continue; }
    if (campo !== 'fuente_version_anio') {
      const n = Number(valor.replace(',', '.'));
      if (!Number.isFinite(n) || n <= 0) { motivo(`el valor no es un número positivo: ${valor}`); continue; }
    }

    // Una propuesta por (categoría, campo): el índice parcial de la
    // migración lo exige, y así el modelo no llena la bandeja de variantes.
    const clave = `${codigo}|${campo}`;
    if (vistos.has(clave)) { motivo('duplicada'); continue; }
    vistos.add(clave);

    validos.push({
      categoria_codigo: codigo,
      campo,
      valor_propuesto: campo === 'fuente_version_anio' ? valor : String(Number(valor.replace(',', '.'))),
      fuente_url: url,
      fuente_titulo: typeof h.fuente_titulo === 'string' ? h.fuente_titulo.slice(0, 300) : null,
      fuente_anio: typeof h.fuente_anio === 'string' ? h.fuente_anio.slice(0, 20) : null,
      justificacion: String(h.justificacion || '').slice(0, 2000),
    });
  }
  return { validos, descartados };
}

// Descarta los hallazgos que no cambian nada: proponer 0,2421 cuando ya
// dice 0,2421 solo genera ruido en la bandeja. PURA y exportada para test.
export function soloCambios(hallazgos, categorias) {
  const porCodigo = new Map(categorias.map((c) => [c.codigo, c]));
  return hallazgos.filter((h) => {
    const cat = porCodigo.get(h.categoria_codigo);
    if (!cat) return false;
    const actual = h.campo === 'fuente_version_anio'
      ? String(cat.fuente_version_anio ?? '').trim()
      : String(cat[h.campo] ?? '').trim();
    if (h.campo === 'fuente_version_anio') return actual !== h.valor_propuesto;
    return Number(actual) !== Number(h.valor_propuesto);
  });
}

// Valor vigente de un campo, en texto, para guardarlo junto a la propuesta
// y poder comparar en la pantalla. PURA.
export function valorActualDe(categoria, campo) {
  if (!categoria) return null;
  const v = campo === 'fuente_version_anio' ? categoria.fuente_version_anio : categoria[campo];
  return v == null ? null : String(v);
}

export const actualizarFactores = {
  get enabled() {
    return Boolean(config.analisisIA.apiKey);
  },

  // Corre la búsqueda y deja las propuestas pendientes. Devuelve
  // { ok, propuestas, descartados, error } — nunca lanza por una falla de
  // la API: el panel muestra el motivo y el motor sigue igual que antes.
  async buscar({ usuarioId = null } = {}) {
    if (!this.enabled) {
      return { ok: false, error: 'La integración con la IA no está configurada en este servidor.', propuestas: [], descartados: [] };
    }
    const inicio = Date.now();
    const { rows: categorias } = await query(
      `SELECT mc.codigo, mc.nombre, mc.unidad_fisica, mc.factor_fisico_kgco2e,
              mc.factor_gasto_kgco2e_clp1000, mc.fuente,
              f.organismo AS fuente_organismo, f.documento AS fuente_documento, f.version_anio AS fuente_version_anio
         FROM motor_categorias mc
         LEFT JOIN fuentes_metodologicas f ON f.id = mc.fuente_metodologica_id
        WHERE mc.activo = true
        ORDER BY mc.codigo`
    );
    if (!categorias.length) {
      return { ok: false, error: 'El motor no tiene categorías activas.', propuestas: [], descartados: [] };
    }

    let respuesta;
    try {
      respuesta = await llamarClaude(construirPrompt(categorias));
    } catch (e) {
      await registrarCorrida({ usuarioId, exito: false, motivoError: e.message, nPropuestas: 0, latenciaMs: Date.now() - inicio });
      return { ok: false, error: e.message, propuestas: [], descartados: [] };
    }

    const codigos = new Set(categorias.map((c) => c.codigo));
    const { validos, descartados } = validarHallazgos(respuesta.input, codigos);
    const cambios = soloCambios(validos, categorias);

    const guardadas = [];
    for (const h of cambios) {
      const cat = categorias.find((c) => c.codigo === h.categoria_codigo);
      // Reemplaza la pendiente anterior de la misma (categoría, campo) en vez
      // de acumular duplicados que después nadie revisa.
      const { rows } = await query(
        `INSERT INTO propuestas_factores
           (categoria_codigo, campo, valor_actual, valor_propuesto, fuente_url,
            fuente_titulo, fuente_anio, justificacion, modelo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (categoria_codigo, campo) WHERE estado = 'pendiente'
         DO UPDATE SET valor_actual = EXCLUDED.valor_actual,
                       valor_propuesto = EXCLUDED.valor_propuesto,
                       fuente_url = EXCLUDED.fuente_url,
                       fuente_titulo = EXCLUDED.fuente_titulo,
                       fuente_anio = EXCLUDED.fuente_anio,
                       justificacion = EXCLUDED.justificacion,
                       modelo = EXCLUDED.modelo,
                       created_at = now()
         RETURNING *`,
        [h.categoria_codigo, h.campo, valorActualDe(cat, h.campo), h.valor_propuesto,
         h.fuente_url, h.fuente_titulo, h.fuente_anio, h.justificacion, MODELO]
      );
      guardadas.push(rows[0]);
    }

    await registrarCorrida({
      usuarioId, exito: true, nPropuestas: guardadas.length,
      tokensEntrada: respuesta.usage?.input_tokens, tokensSalida: respuesta.usage?.output_tokens,
      latenciaMs: Date.now() - inicio,
    });
    return { ok: true, propuestas: guardadas, descartados };
  },
};

// Llamada real a la API de Anthropic. Mismo patrón que analisisIA.js:
// herramienta forzada para obtener JSON válido contra el esquema en vez de
// prosa que haya que parsear, y plazo con AbortController. La diferencia es
// `web_search`, una herramienta de SERVIDOR: la corre Anthropic, así que la
// respuesta puede traer varias vueltas de búsqueda antes del bloque final.
async function llamarClaude(prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
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
        model: MODELO,
        max_tokens: 8000,
        tools: [
          { type: 'web_search_20260209', name: 'web_search', max_uses: 12 },
          HERRAMIENTA,
        ],
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) {
      const cuerpo = await res.json().catch(() => null);
      const detalle = cuerpo?.error?.message || cuerpo?.error?.type;
      throw new Error(`Anthropic API ${res.status}${detalle ? `: ${detalle}` : ''}`);
    }
    const data = await res.json();
    const bloque = (data.content || []).find((b) => b.type === 'tool_use' && b.name === HERRAMIENTA.name);
    // Sin bloque de herramienta no hay nada que validar. Se trata como
    // "no encontró nada" y no como error: el modelo puede haber concluido
    // legítimamente que todo está al día.
    return { input: bloque?.input || { hallazgos: [] }, usage: data.usage || {} };
  } finally {
    clearTimeout(timeout);
  }
}

// Bitácora de la corrida — tolerante a la tabla ausente, igual que
// analisisIA.logUso (42P01 = migración sin correr).
async function registrarCorrida({ usuarioId, exito, motivoError, nPropuestas, tokensEntrada, tokensSalida, latenciaMs }) {
  try {
    await query(
      `INSERT INTO actualizaciones_factores
         (disparada_por, exito, motivo_error, n_propuestas, modelo, tokens_entrada, tokens_salida, latencia_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [usuarioId, exito, motivoError || null, nPropuestas || 0, MODELO,
       tokensEntrada || null, tokensSalida || null, latenciaMs]
    );
  } catch (e) {
    if (e.code !== '42P01') console.warn('[actualizarFactores] no se pudo registrar la corrida:', e.message);
  }
}
