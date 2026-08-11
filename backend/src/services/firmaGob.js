import crypto from 'crypto';
import { config } from '../config.js';

// ============================================================
// Cliente de la API de Firma Electrónica Avanzada del Estado
// (FirmaGob / SEGPRES), según "Integración API Firma v2", 13-04-2020.
//
// ┌─ LEER ANTES DE USAR ────────────────────────────────────────┐
// │ Este servicio NO sirve para firmar los contratos de sicr3p  │
// │ con sus clientes privados.                                  │
// │                                                             │
// │ El propio documento lo define: la API existe "para que      │
// │ aplicaciones desarrolladas por LAS INSTITUCIONES puedan     │
// │ realizar procesos de firma [...] utilizando las firmas      │
// │ electrónicas avanzadas DE AUTORIDADES O FUNCIONARIOS        │
// │ custodiadas en el Repositorio Centralizado de Firmas".      │
// │                                                             │
// │ La Autoridad de Registro (RA) habilita cada aplicación      │
// │ contra un trío fijo: entidad (institución pública),         │
// │ propósito y RUN del titular de la firma. Los certificados   │
// │ viven en el "Banco" del Estado y jamás se exponen.          │
// │                                                             │
// │ Es decir: quien firma es un funcionario público, con su     │
// │ FEA, a nombre de su institución. sicr3p SpA no puede        │
// │ firmar con esto sus propios contratos comerciales.          │
// │                                                             │
// │ Dónde SÍ aplica: documentos que deba firmar una institución │
// │ pública con la que sicr3p trabaje (municipio, autoridad     │
// │ portuaria, SEREMI), desde la aplicación registrada de esa   │
// │ institución.                                                │
// │                                                             │
// │ Para firmar contratos sicr3p↔cliente con validez legal      │
// │ (Ley 19.799) el camino es un prestador acreditado de        │
// │ servicios de certificación, no esta API.                    │
// └─────────────────────────────────────────────────────────────┘
//
// Apagado por defecto (FIRMAGOB_HABILITADO=false). Las funciones de
// construcción son puras y se testean sin red; `firmarDocumentos` es la
// única que sale a internet.
// ============================================================

// Del documento, sección "Firmar Documento" y "Ambiente de TEST".
export const AMBIENTES = {
  test: 'https://api.firma.test.digital.gob.cl/firma/v2/files/tickets',
  produccion: 'https://api.firma.digital.gob.cl/firma/v2/files/tickets',
};

// "Solicitud excede el tamaño máximo que son 5 MB" (error 400 del doc).
// Se mide sobre el JSON completo, no sobre el archivo: el base64 infla ~33%.
export const MAX_SOLICITUD_BYTES = 5 * 1024 * 1024;

export const TIPOS_PERMITIDOS = ['application/pdf', 'application/xml', 'application/json'];

// El token no puede expirar a más de 30 minutos del momento actual.
export const MAX_EXPIRACION_MIN = 30;

const b64url = (b) => Buffer.from(b).toString('base64url');
const sha256Hex = (b) => crypto.createHash('sha256').update(b).digest('hex');

// El doc pide `expiration` "en hora chilena, formato ISODate
// (YYYY-MM-DDTHH:MM:SS)". Se calcula con la zona America/Santiago en vez
// de restar 4 horas fijas: Chile cambia de huso dos veces al año y un
// offset hardcodeado deja de firmar durante medio año.
export function horaChilena(fecha = new Date()) {
  const partes = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Santiago',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).format(fecha);
  // 'sv-SE' entrega "YYYY-MM-DD HH:MM:SS"; el doc quiere la T de ISO.
  return partes.replace(' ', 'T');
}

// El RUN va "sin puntos, guión ni tampoco el dígito verificador".
export function runParaToken(rut) {
  const limpio = String(rut || '').replace(/[^0-9kK]/g, '');
  if (limpio.length < 2) throw new Error('RUT inválido para el token de firma');
  return limpio.slice(0, -1); // quita el DV
}

// JWT HS256 firmado con la clave simétrica que entrega el registro de la
// aplicación en la RA. El doc lo llama "encriptado", pero lo que describe
// —HS256 con secreto compartido— es un JWS firmado, no cifrado: el payload
// viaja en base64url legible. No poner ahí nada que no pueda verse.
export function construirToken({ run, entity, purpose, secreto, minutos = 10, ahora = new Date() }) {
  if (!secreto) throw new Error('Falta el secreto de la aplicación (FIRMAGOB_SECRETO)');
  if (!entity) throw new Error('Falta `entity` (institución titular de la firma)');
  if (!purpose) throw new Error('Falta `purpose` (propósito del certificado)');
  if (minutos > MAX_EXPIRACION_MIN) {
    throw new Error(`La expiración no puede superar los ${MAX_EXPIRACION_MIN} minutos`);
  }
  const payload = {
    run: runParaToken(run),
    entity,
    purpose,
    expiration: horaChilena(new Date(ahora.getTime() + minutos * 60 * 1000)),
  };
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const firma = crypto.createHmac('sha256', secreto).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${firma}`;
}

// Un elemento del array `files`. El checksum es SHA256 del archivo ORIGINAL
// (la respuesta lo devuelve como `checksum_original` para poder aparear
// pedido y respuesta cuando se mandan varios).
export function archivoParaFirma({ buffer, descripcion, contentType = 'application/pdf', layout }) {
  if (!Buffer.isBuffer(buffer)) throw new Error('El documento debe ser un Buffer');
  if (!TIPOS_PERMITIDOS.includes(contentType)) throw new Error(`Tipo de documento no permitido: ${contentType}`);
  const item = {
    'content-type': contentType,
    content: buffer.toString('base64'),
    description: String(descripcion || '').slice(0, 200),
    checksum: sha256Hex(buffer),
  };
  if (layout) item.layout = layout;
  return item;
}

// XML `AgileSignerConfig` del Anexo B: dibuja la imagen de la firma sobre
// el PDF. Coordenadas en puntos PDF, origen abajo-izquierda. `page` acepta
// un número o la palabra LAST.
export function layoutFirmaVisible({ imagenBase64, llx = 250, lly = 300, urx = 350, ury = 450, page = 'LAST' }) {
  if (!imagenBase64) throw new Error('Falta la imagen de la firma en base64');
  return [
    '<AgileSignerConfig>',
    '<Application id="THIS-CONFIG">',
    '<pdfPassword/>',
    '<Signature>',
    '<Visible active="true" layer2="false" label="true" pos="1">',
    `<llx>${llx}</llx>`, `<lly>${lly}</lly>`, `<urx>${urx}</urx>`, `<ury>${ury}</ury>`,
    `<page>${page}</page>`,
    '<image>BASE64</image>',
    `<BASE64VALUE>${imagenBase64}</BASE64VALUE>`,
    '</Visible>', '</Signature>', '</Application>', '</AgileSignerConfig>',
  ].join('');
}

// El documento describe la respuesta de dos maneras distintas: el JSON
// Schema usa snake_case (`files_signed`, `OTP_expired`, con `files_recived`
// y `files_received` en el mismo bloque) y el ejemplo del código 200 usa
// camelCase (`filesSigned`, `otpExpired`, `objectsReceived`). Se normaliza
// leyendo ambas en vez de apostar por una.
export function normalizarRespuesta(json = {}) {
  const m = json.metadata || {};
  const num = (...claves) => {
    for (const k of claves) if (typeof m[k] === 'number') return m[k];
    return null;
  };
  return {
    firmados: (json.files || []).filter((f) => f.status === 'OK').map((f) => ({
      descripcion: f.description || null,
      checksumOriginal: f.checksum_original || null,
      checksumFirmado: f.checksum_signed || f.checksum || null,
      contenido: f.content ? Buffer.from(f.content, 'base64') : null,
    })),
    fallidos: (json.files || []).filter((f) => f.status !== 'OK').map((f) => ({
      descripcion: f.description || null,
      checksumOriginal: f.checksum_original || null,
      estado: f.status || 'error',
    })),
    metadata: {
      recibidos: num('files_received', 'files_recived', 'objectsReceived'),
      firmados: num('files_signed', 'filesSigned'),
      fallidos: num('signed_failed', 'signedFailed'),
      otpExpirado: m.OTP_expired ?? m.otpExpired ?? null,
    },
  };
}

// Única función con red. `otp` solo va en firma ATENDIDA: en la desatendida
// el doc es explícito en que la cabecera no debe enviarse.
export async function firmarDocumentos({ archivos, otp = null, ambiente = config.firmaGob?.ambiente || 'test', fetchImpl = fetch }) {
  if (!config.firmaGob?.habilitado) {
    throw new Error('FirmaGob está apagado (FIRMAGOB_HABILITADO=false)');
  }
  if (!Array.isArray(archivos) || archivos.length === 0) {
    throw new Error('Debe adjuntar al menos un documento a firmar');
  }
  const url = AMBIENTES[ambiente];
  if (!url) throw new Error(`Ambiente de firma desconocido: ${ambiente}`);

  const cuerpo = JSON.stringify({
    api_token_key: config.firmaGob.apiTokenKey,
    token: construirToken({
      run: config.firmaGob.run,
      entity: config.firmaGob.entidad,
      purpose: config.firmaGob.proposito,
      secreto: config.firmaGob.secreto,
    }),
    files: archivos,
  });
  if (Buffer.byteLength(cuerpo) > MAX_SOLICITUD_BYTES) {
    throw new Error('La solicitud excede el máximo de 5 MB que acepta la API de firma');
  }

  const headers = { 'Content-Type': 'application/json' };
  if (otp) headers.OTP = String(otp);

  const res = await fetchImpl(url, { method: 'POST', headers, body: cuerpo });
  if (!res.ok) {
    const detalle = await res.json().catch(() => ({}));
    throw new Error(`API de firma respondió ${res.status}: ${detalle.error || 'sin detalle'}`);
  }
  return normalizarRespuesta(await res.json());
}
