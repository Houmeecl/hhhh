// ============================================================
// Réplica de leads a Notion (opcional) — el usuario pidió que los leads
// lleguen también a su workspace de Notion, además del panel.
//
// Contrato FAIL-SAFE, sin excepciones hacia afuera: la captación del
// lead NUNCA depende de un tercero. Si NOTION_TOKEN/NOTION_DATABASE_ID
// no están configurados, esto es un no-op; si Notion falla o demora, se
// loggea y ya — la fila en Postgres es la fuente de verdad y quedó
// escrita antes de llamar acá. Se llama SIEMPRE después de responderle
// al cliente (fire-and-forget en public.js).
//
// Sin SDK: una sola llamada REST (POST /v1/pages) con fetch nativo.
// El esquema esperado de la base está documentado en .env.example.
// ============================================================

import { config } from '../config.js';
import { ORIGEN_LABEL } from './interesados.js';

const rt = (s) => [{ text: { content: String(s).slice(0, 1900) } }];
const T = (n) => Number(n || 0).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const CLP = (n) => Number(n || 0).toLocaleString('es-CL', { maximumFractionDigits: 0 });

// PURA (testeable sin red): mapea un lead a propiedades de Notion. Solo
// se incluyen las propiedades con dato — una propiedad ausente no rompe
// contra una base con esquema parcial (una con nombre desconocido sí:
// Notion responde 400, y el fail-safe lo deja en el log).
export function formatearPropiedadesNotion({ tipo, datos }) {
  const d = datos || {};
  const nombre = d.nombre || d.contacto_nombre || null;
  const empresa = d.empresa || d.nombre_empresa || null;
  const email = d.email || d.contacto_email || '';
  const props = {
    Nombre: { title: rt(empresa || nombre || email || 'Lead sin nombre') },
    Email: { email: email || null },
    Origen: {
      select: {
        name: tipo === 'inscripcion' ? 'Inscripción' : (ORIGEN_LABEL[d.origen] || 'Sitio web'),
      },
    },
  };
  if (empresa && (nombre || email)) props.Contacto = { rich_text: rt(nombre || email) };
  if (d.telefono || d.contacto_telefono) props['Teléfono'] = { rich_text: rt(d.telefono || d.contacto_telefono) };
  if (d.mensaje) props.Mensaje = { rich_text: rt(d.mensaje) };
  if (d.estimacion?.total_t != null) {
    props['Estimación'] = {
      rich_text: rt(`≈ ${T(d.estimacion.total_t)} t CO2e${d.estimacion.compensacion_clp != null ? ` · $ ${CLP(d.estimacion.compensacion_clp)} CLP/mes` : ''}`),
    };
  }
  return props;
}

// `cfg`/`fetcher` inyectables (patrón elegirTransporte de mailer.js y
// consultarRut de baseapi.js): testeable sin red ni entorno.
export async function enviarLeadANotion({ tipo, datos }, { cfg = config, fetcher = fetch } = {}) {
  if (!cfg.notion.enabled) return { skipped: true };
  try {
    const res = await fetcher('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.notion.token}`,
        'Notion-Version': cfg.notion.version,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        parent: { database_id: cfg.notion.databaseId },
        properties: formatearPropiedadesNotion({ tipo, datos }),
      }),
      signal: AbortSignal.timeout(cfg.notion.timeoutMs),
    });
    if (!res.ok) {
      // Nunca el cuerpo completo al log (puede traer eco de datos), solo
      // el status y el principio del mensaje para diagnosticar el 400 de
      // esquema o el 401 de token.
      const detalle = (await res.text().catch(() => '')).slice(0, 300);
      throw new Error(`Notion ${res.status}: ${detalle}`);
    }
    return { ok: true };
  } catch (err) {
    console.error('[notionLeads] no se pudo sincronizar (el lead quedó igual en la base de datos):', err.message);
    return { ok: false, error: err.message };
  }
}
