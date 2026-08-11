#!/usr/bin/env node
// ============================================================
// Servidor MCP de sicr3p — transporte stdio, solo lectura.
//
// Expone la API que la plataforma YA sirve (routes/public.js y
// routes/mandante.js) como herramientas para agentes. No abre ningún
// camino nuevo: cada herramienta llama al mismo endpoint HTTP que usaría
// un navegador o una integración, con las mismas reglas de acceso — lo
// público sin credencial, lo del mandante solo con su X-Api-Key. Por lo
// mismo, acá no hay lógica de negocio: si un dato no sale por la API,
// tampoco sale por acá.
//
// Configuración por variables de entorno:
//   SICR3P_API_URL  base de la API (default https://sicr3p.cl)
//   SICR3P_API_KEY  clave X-Api-Key del mandante (solo para las
//                   herramientas sicr3p_mandante_*; el resto no la usa)
// ============================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE = (process.env.SICR3P_API_URL || 'https://sicr3p.cl').replace(/\/+$/, '');
const API_KEY = process.env.SICR3P_API_KEY || '';

// Llama a la API y devuelve el resultado en el formato que MCP espera.
// Los errores se devuelven como texto accionable (isError), nunca como
// excepción: un agente puede corregir "falta la API key", no un stack.
async function llamar(ruta, { conApiKey = false, query = {} } = {}) {
  if (conApiKey && !API_KEY) {
    return error(
      'Esta herramienta requiere la clave de mandante. Configura la variable de entorno ' +
      'SICR3P_API_KEY con la X-Api-Key emitida desde el panel de administración de sicr3p ' +
      '(Accesos → Mandantes).'
    );
  }
  const url = new URL(`${BASE}/api${ruta}`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  let res;
  try {
    res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        ...(conApiKey ? { 'X-Api-Key': API_KEY } : {}),
      },
    });
  } catch (e) {
    return error(
      `No se pudo conectar con ${BASE}: ${e.message}. Revisa SICR3P_API_URL ` +
      '(¿la instancia está en línea? ¿la URL incluye https://?).'
    );
  }
  const texto = await res.text();
  let cuerpo;
  try { cuerpo = JSON.parse(texto); } catch { cuerpo = { respuesta: texto.slice(0, 2000) }; }

  if (!res.ok) {
    const detalle = cuerpo?.error || `HTTP ${res.status}`;
    if (res.status === 401) {
      return error(`La API rechazó la credencial (${detalle}). Verifica que SICR3P_API_KEY sea la clave vigente del mandante.`);
    }
    if (res.status === 404) {
      return error(`No encontrado (${detalle}). Verifica el identificador: los códigos de lote son tipo LM-AAAA-NNNNNN, los seriales de constancia tipo CAP-XXXXXX.`);
    }
    return error(`La API respondió ${res.status}: ${detalle}`);
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(cuerpo, null, 2) }],
    structuredContent: cuerpo,
  };
}

const error = (msg) => ({ content: [{ type: 'text', text: msg }], isError: true });

const soloLectura = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

const server = new McpServer({ name: 'sicr3p', version: '1.0.0' });

// ============ Herramientas públicas (sin credencial) ============

server.registerTool('sicr3p_estado_cadena', {
  title: 'Estado de la cadena de integridad',
  description:
    'Estado público de la cadena de hash global de sicr3p: cantidad de eslabones, último hash y si la ' +
    'verificación completa está intacta. Es el mismo dato del explorador público /cadena.',
  inputSchema: {},
  annotations: soloLectura,
}, () => llamar('/publico/cadena'));

server.registerTool('sicr3p_verificar_documento', {
  title: 'Verificar un documento procesado',
  description:
    'Verificación pública de un documento (factura) procesado por sicr3p, por su id (UUID del QR de la ' +
    'etiqueta): CO2e calculado, categoría, posición en la cadena de hash y si el eslabón está intacto.',
  inputSchema: { id: z.string().describe('UUID del documento, tal como viene en la URL /verificar/{id} del QR') },
  annotations: soloLectura,
}, ({ id }) => llamar(`/verificar/${encodeURIComponent(id)}`));

server.registerTool('sicr3p_pasaporte_lote', {
  title: 'Pasaporte público de un lote',
  description:
    'Pasaporte de Trazabilidad Documental de un lote del Corredor Bioceánico, por su código ' +
    '(ej. LM-2026-000318): cadena de custodia con sus eslabones, semáforo documental, estado y anclaje. ' +
    'Los eslabones marcados privados aparecen reservados — igual que en la página pública /lote/{codigo}.',
  inputSchema: { codigo: z.string().describe('Código del lote, ej. LM-2026-000318') },
  annotations: soloLectura,
}, ({ codigo }) => llamar(`/lote/${encodeURIComponent(codigo)}`));

server.registerTool('sicr3p_mensajes_lote', {
  title: 'Instrucciones de la torre para un lote',
  description: 'Mensajes/instrucciones operativas públicas de la Torre de Control para un lote (por código).',
  inputSchema: { codigo: z.string().describe('Código del lote, ej. LM-2026-000318') },
  annotations: soloLectura,
}, ({ codigo }) => llamar(`/lote/${encodeURIComponent(codigo)}/mensajes`));

server.registerTool('sicr3p_pasaporte_producto', {
  title: 'Pasaporte digital de producto',
  description: 'Pasaporte Digital de Producto de una sesión procesada, por su id (UUID): emisiones incorporadas, REP y trazabilidad consolidada.',
  inputSchema: { id: z.string().describe('UUID de la sesión/pasaporte') },
  annotations: soloLectura,
}, ({ id }) => llamar(`/pasaporte/${encodeURIComponent(id)}`));

server.registerTool('sicr3p_cursos_instituto', {
  title: 'Catálogo del Instituto sicr3p',
  description: 'Catálogo público de cursos del Instituto sicr3p (solo cursos publicables: slug, título y descripción).',
  inputSchema: {},
  annotations: soloLectura,
}, () => llamar('/capacitacion/cursos'));

server.registerTool('sicr3p_verificar_constancia', {
  title: 'Verificar una constancia de curso',
  description:
    'Verificación pública de una constancia de capacitación por su serial (ej. CAP-3F0A9B): nombre, curso, ' +
    'puntaje y fecha. Las constancias no son certificaciones acreditadas; esta herramienta solo confirma ' +
    'que el serial existe y sus datos.',
  inputSchema: { serial: z.string().describe('Serial de la constancia, ej. CAP-3F0A9B') },
  annotations: soloLectura,
}, ({ serial }) => llamar(`/capacitacion/constancias/${encodeURIComponent(serial)}`));

// ============ Herramientas de mandante (X-Api-Key) ============

server.registerTool('sicr3p_mandante_proveedores', {
  title: 'Proveedores del mandante',
  description:
    'Lista de proveedores visibles para el mandante autenticado (requiere SICR3P_API_KEY): RUT, documentos ' +
    'procesados y CO2e total de cada uno.',
  inputSchema: {},
  annotations: soloLectura,
}, () => llamar('/mandante/proveedores', { conApiKey: true }));

server.registerTool('sicr3p_mandante_proveedor_resumen', {
  title: 'Resumen de un proveedor',
  description: 'Resumen de un proveedor específico del mandante (requiere SICR3P_API_KEY): actividad, CO2e y estado.',
  inputSchema: { rut: z.string().describe('RUT del proveedor, ej. 76.123.456-7') },
  annotations: soloLectura,
}, ({ rut }) => llamar(`/mandante/proveedor/${encodeURIComponent(rut)}/resumen`, { conApiKey: true }));

server.registerTool('sicr3p_mandante_alcance3', {
  title: 'Export Alcance 3 (Scope 3) del mandante',
  description:
    'Emisiones de la cadena del mandante clasificadas en las categorías del GHG Protocol (Alcance 3), con la ' +
    'fuente metodológica de cada factor. Requiere SICR3P_API_KEY. Mismo dato del export CSV del panel; los ' +
    'resultados son estimaciones metodológicas, no una verificación de tercera parte acreditada.',
  inputSchema: { anio: z.number().int().optional().describe('Filtrar por año calendario, ej. 2026 (opcional)') },
  annotations: soloLectura,
}, ({ anio }) => llamar('/mandante/export/alcance3', { conApiKey: true, query: { anio } }));

server.registerTool('sicr3p_mandante_cbam', {
  title: 'Export CBAM del mandante',
  description:
    'Lotes exportables con sus emisiones incorporadas (directas/indirectas por tonelada), aplicabilidad CBAM y ' +
    'faltantes, para preparar el reporte del importador europeo. Requiere SICR3P_API_KEY. sicr3p no presenta ' +
    'la declaración CBAM: entrega el dato trazable que la alimenta.',
  inputSchema: {},
  annotations: soloLectura,
}, () => llamar('/mandante/export/cbam', { conApiKey: true }));

const transporte = new StdioServerTransport();
await server.connect(transporte);
