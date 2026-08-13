import zlib from 'zlib';
import { rutValido } from './dte.js';

// ============================================================
// Lector de planillas: .xlsx y .csv, SIN dependencias nuevas.
//
// POR QUÉ NO `xlsx`/`exceljs`. Un .xlsx es un ZIP con XML adentro, y Node
// ya trae el inflate (zlib.inflateRawSync). Lo que falta es leer el
// directorio del ZIP y recorrer dos XML — unas 120 líneas. La alternativa
// era sumar una dependencia grande, con historial de CVEs, que corre
// contra un archivo que sube alguien de afuera. Mismo criterio con el que
// este repo ya escribió su propio parser de DTE, su propio CSV de salida
// y su propio armado de PDF.
//
// QUÉ NO HACE, A PROPÓSITO:
//  · No evalúa fórmulas — devuelve el último valor calculado que Excel
//    dejó guardado (que es el que la persona vio en pantalla).
//  · No convierte fechas. En xlsx una fecha es un número con un formato
//    aplicado; distinguirla exige leer los estilos. Ninguna columna que
//    este flujo necesita (empresa, RUT, correo, monto) es una fecha, y
//    adivinar habría convertido un número real en una fecha inventada.
//  · No lee .xls antiguo (formato binario OLE2, otra cosa entera). Se
//    detecta y se responde con instrucciones, no con un error críptico.
// ============================================================

const td = new TextDecoder('utf-8');

// ---------- ZIP ----------

const FIRMA_EOCD = 0x06054b50; // fin del directorio central
const FIRMA_CENTRAL = 0x02014b50;
const FIRMA_LOCAL = 0x04034b50;

/**
 * Devuelve un Map<nombre, Buffer> con las entradas del ZIP.
 *
 * Se recorre el DIRECTORIO CENTRAL y no los encabezados locales: el
 * encabezado local puede traer tamaño 0 cuando el escritor usó descriptor
 * de datos (Excel lo hace), y ahí el largo real solo está en el central.
 */
// Techo de lo que se descomprime, en total y por entrada.
//
// Un .xlsx entra por una ruta que sube alguien de afuera, y deflate llega
// a comprimir ~1000:1. Sin esto, 20 MB de ceros se convierten en decenas
// de gigabytes y `inflateRawSync` tumba el proceso entero — no la
// petición: el proceso. 300 MB descomprimidos cubren con holgura el
// archivo real (2,3 MB comprimidos, ~40 MB de XML) y cortan la bomba.
const MAX_DESCOMPRIMIDO = 300 * 1024 * 1024;
const MAX_ENTRADA = 100 * 1024 * 1024;

export function leerZip(buf) {
  // El EOCD está al final, pero puede haber hasta 64 KB de comentario
  // después. Se busca hacia atrás desde el final.
  let eocd = -1;
  const desde = Math.max(0, buf.length - 66_000);
  for (let i = buf.length - 22; i >= desde; i--) {
    if (buf.readUInt32LE(i) === FIRMA_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('El archivo no es un .xlsx válido (no se encontró el índice del ZIP).');

  const total = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entradas = new Map();
  let acumulado = 0;

  for (let n = 0; n < total; n++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== FIRMA_CENTRAL) break;
    const metodo = buf.readUInt16LE(off + 10);
    const comprimido = buf.readUInt32LE(off + 20);
    const descomprimido = buf.readUInt32LE(off + 24);
    const largoNombre = buf.readUInt16LE(off + 28);
    const largoExtra = buf.readUInt16LE(off + 30);
    const largoComentario = buf.readUInt16LE(off + 32);
    const offLocal = buf.readUInt32LE(off + 42);
    const nombre = buf.toString('utf8', off + 46, off + 46 + largoNombre);

    // El tamaño declarado se comprueba ANTES de descomprimir; el
    // `maxOutputLength` de abajo es el que atrapa a un archivo que MIENTE
    // en su directorio. Hacen falta los dos.
    acumulado += descomprimido;
    if (descomprimido > MAX_ENTRADA || acumulado > MAX_DESCOMPRIMIDO) {
      throw new Error('La planilla se descomprime a un tamaño desproporcionado; no se procesa.');
    }

    if (buf.readUInt32LE(offLocal) === FIRMA_LOCAL) {
      // El encabezado local tiene SUS PROPIOS largos de nombre y extra,
      // distintos de los del central (el central suele traer más extra).
      const inicio = offLocal + 30 + buf.readUInt16LE(offLocal + 26) + buf.readUInt16LE(offLocal + 28);
      const crudo = buf.subarray(inicio, inicio + comprimido);
      if (metodo === 0) entradas.set(nombre, crudo);
      else if (metodo === 8) {
        try {
          entradas.set(nombre, zlib.inflateRawSync(crudo, { maxOutputLength: MAX_ENTRADA }));
        } catch (e) {
          if (/maxOutputLength|buffer.*size|ERR_BUFFER_TOO_LARGE/i.test(e.message)) {
            throw new Error('La planilla se descomprime a un tamaño desproporcionado; no se procesa.');
          }
          throw e;
        }
      }
      // Otros métodos (bzip2, lzma) no los produce Excel: se omiten.
    }
    off += 46 + largoNombre + largoExtra + largoComentario;
  }
  return entradas;
}

// ---------- XML ----------

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function desescaparXml(s) {
  return String(s).replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (todo, cuerpo) => {
    if (cuerpo[0] === '#') {
      const n = cuerpo[1] === 'x' || cuerpo[1] === 'X'
        ? parseInt(cuerpo.slice(2), 16)
        : parseInt(cuerpo.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : todo;
    }
    return ENTIDADES[cuerpo] ?? todo;
  });
}

// Todo el texto de los <t> de un fragmento, concatenado. Una celda con
// formato mixto ("Bío**bío**") se guarda partida en varios <r><t>, y
// quedarse con el primero perdía media razón social.
const textoDeT = (xml) =>
  [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => desescaparXml(m[1])).join('');

/** "A"→0, "Z"→25, "AA"→26. Devuelve -1 si no hay letras. */
export function columnaDeRef(ref) {
  const letras = String(ref || '').match(/^[A-Z]+/i)?.[0];
  if (!letras) return -1;
  let n = 0;
  for (const c of letras.toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

// ---------- xlsx ----------

/**
 * Las pestañas del libro, EN EL ORDEN EN QUE SE VEN EN EXCEL y con su
 * nombre visible.
 *
 * Hay que cruzar dos XML porque `sheet3.xml` no es necesariamente la
 * tercera pestaña: workbook.xml da el orden y el nombre con un r:id, y
 * workbook.xml.rels traduce ese r:id al archivo. Se comprobó contra una
 * planilla real de 6 hojas donde los números sí coincidían — pero la
 * pestaña que el admin elige por nombre no puede depender de esa suerte.
 */
export function hojasDeXlsx(zip) {
  const rels = new Map();
  const relsXml = zip.get('xl/_rels/workbook.xml.rels');
  if (relsXml) {
    for (const m of td.decode(relsXml).matchAll(/<Relationship\s([^>]*)>/g)) {
      const id = m[1].match(/\bId="([^"]+)"/)?.[1];
      const destino = m[1].match(/\bTarget="([^"]+)"/)?.[1];
      if (id && destino) rels.set(id, `xl/${destino.replace(/^\.?\//, '')}`);
    }
  }
  const wb = zip.get('xl/workbook.xml');
  const hojas = [];
  if (wb) {
    for (const m of td.decode(wb).matchAll(/<sheet\s([^>]*?)\/?>/g)) {
      const nombre = desescaparXml(m[1].match(/\bname="([^"]*)"/)?.[1] || '');
      const rid = m[1].match(/r:id="([^"]+)"/)?.[1];
      const archivo = rels.get(rid);
      if (archivo && zip.has(archivo)) hojas.push({ nombre, archivo });
    }
  }
  // Respaldo por si el libro viene sin rels legibles.
  if (!hojas.length) {
    for (const k of [...zip.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
      .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))) {
      hojas.push({ nombre: k.replace(/^.*\/|\.xml$/g, ''), archivo: k });
    }
  }
  return hojas;
}

/**
 * Matriz de strings de una hoja. `hoja` es el NOMBRE de la pestaña; sin
 * él se toma la primera que tenga filas — un libro de trabajo real trae
 * pestañas vacías intercaladas ("Hoja 1" con 0 filas entre dos con
 * miles), y abrir en la vacía parece que el archivo no se pudo leer.
 */
export function leerXlsx(buf, { hoja = null } = {}) {
  const zip = leerZip(buf);
  const hojas = hojasDeXlsx(zip);
  if (!hojas.length) throw new Error('El .xlsx no contiene ninguna hoja de cálculo.');

  const compartidas = [];
  const ss = zip.get('xl/sharedStrings.xml');
  if (ss) {
    for (const [, si] of td.decode(ss).matchAll(/<si>([\s\S]*?)<\/si>/g)) compartidas.push(textoDeT(si));
  }

  const leerHoja = (archivo) => filasDeHoja(td.decode(zip.get(archivo)), compartidas);

  let elegida = hoja ? hojas.find((h) => h.nombre === hoja) : null;
  if (hoja && !elegida) throw new Error(`La planilla no tiene una hoja llamada "${hoja}".`);
  let filas = elegida ? leerHoja(elegida.archivo) : [];
  if (!elegida) {
    for (const h of hojas) {
      filas = leerHoja(h.archivo);
      if (filas.length) { elegida = h; break; }
    }
    if (!elegida) elegida = hojas[0];
  }
  return { hojas: hojas.map((h) => h.nombre), hoja: elegida.nombre, filas };
}

function filasDeHoja(xml, compartidas) {
  const filas = [];
  // `<row/>` autocerrada (fila vacía con formato) también calza, con
  // cuerpo undefined: cuenta como fila vacía y no rompe el índice.
  for (const m of xml.matchAll(/<row(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const fila = [];
    for (const c of (m[1] || '').matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const cuerpo = c[2] || '';
      const tipo = attrs.match(/\bt="([^"]+)"/)?.[1] || 'n';
      const i = columnaDeRef(attrs.match(/\br="([^"]+)"/)?.[1]);
      let valor = '';
      if (tipo === 's') {
        const idx = Number(cuerpo.match(/<v>([\s\S]*?)<\/v>/)?.[1]);
        valor = compartidas[idx] ?? '';
      } else if (tipo === 'inlineStr') {
        valor = textoDeT(cuerpo);
      } else {
        valor = desescaparXml(cuerpo.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '');
      }
      // Con `r` se respeta la columna real (Excel omite las celdas
      // vacías: sin esto, una fila sin RUT corría el correo un lugar).
      if (i >= 0) fila[i] = valor; else fila.push(valor);
    }
    filas.push([...fila].map((v) => v ?? ''));
  }
  return filas;
}

// ---------- csv ----------

/**
 * El separador que más aparece FUERA de comillas en la primera línea.
 * Excel en es-CL exporta con `;` porque la coma es el decimal — asumir
 * `,` partía "Transportes Ángel, González" en dos columnas.
 */
export function detectarSeparador(texto) {
  const linea = texto.split(/\r?\n/, 1)[0] || '';
  let comillas = false;
  const cuenta = { ';': 0, ',': 0, '\t': 0 };
  for (const ch of linea) {
    if (ch === '"') comillas = !comillas;
    else if (!comillas && ch in cuenta) cuenta[ch]++;
  }
  return Object.entries(cuenta).sort((a, b) => b[1] - a[1])[0][1] > 0
    ? Object.entries(cuenta).sort((a, b) => b[1] - a[1])[0][0]
    : ';';
}

/** CSV RFC 4180: comillas dobles, `""` escapado, saltos de línea dentro de comillas. */
export function leerCsv(texto, sep = null) {
  const s = texto.replace(/^﻿/, ''); // BOM de Excel
  const d = sep || detectarSeparador(s);
  const filas = [];
  let fila = [];
  let campo = '';
  let comillas = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (comillas) {
      if (ch === '"') {
        if (s[i + 1] === '"') { campo += '"'; i++; } else comillas = false;
      } else campo += ch;
      continue;
    }
    if (ch === '"') { comillas = true; continue; }
    if (ch === d) { fila.push(campo); campo = ''; continue; }
    if (ch === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = ''; continue; }
    if (ch === '\r') continue;
    campo += ch;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}

// ---------- entrada única ----------

/**
 * Lee la planilla y devuelve `{ hojas, hoja, filas }`. Un CSV no tiene
 * pestañas: `hojas: []`, `hoja: null`.
 *
 * Decide por los BYTES y no por la extensión: alguien renombra un .csv a
 * .xlsx más seguido de lo que parece, y el error resultante ("no es un
 * ZIP válido") no dice nada útil a quien está subiendo su lista.
 */
export function leerTabla(buf, { hoja = null } = {}) {
  if (buf.length >= 4 && buf.readUInt32LE(0) === FIRMA_LOCAL) return leerXlsx(buf, { hoja });
  // OLE2 (.xls de Excel 97-2003): otro formato entero, no un ZIP.
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0xd0cf11e0) {
    throw new Error('Ese es un .xls antiguo. Ábrelo en Excel y guárdalo como .xlsx o .csv.');
  }
  return { hojas: [], hoja: null, filas: leerCsv(buf.toString('utf8')) };
}

// ---------- encabezados ----------

/** minúsculas, sin tildes, sin puntuación: "R.U.T. Empresa" → "rut empresa". */
export const normalizarClave = (s) =>
  String(s ?? '')
    // Escapes explícitos y no los caracteres literales: son marcas
    // combinantes invisibles, y un editor que "limpie" el archivo las
    // borraría sin que nadie lo note hasta que "Compañía" deje de calzar.
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// Nombres de columna que se aceptan para cada campo. La lista es
// deliberadamente generosa: la planilla la escribe una persona, no un
// sistema, y rechazar una lista completa porque el encabezado dice
// "Correo electrónico" en vez de "email" es fricción pura.
export const ALIAS_COLUMNAS = {
  empresa: ['empresa', 'razon social', 'nombre empresa', 'cliente', 'nombre', 'compania', 'compañia'],
  rut: ['rut', 'rut empresa', 'r u t', 'rol unico tributario', 'rut cliente'],
  contacto: ['contacto', 'nombre contacto', 'persona', 'persona contacto', 'representante', 'encargado'],
  email: ['email', 'correo', 'e mail', 'mail', 'correo electronico', 'correo contacto', 'email contacto'],
  monto: ['monto', 'monto clp', 'precio', 'valor', 'total', 'monto a pagar'],
};

/**
 * Empareja los encabezados de la planilla con los campos que se conocen.
 * Devuelve { campo: índiceDeColumna } solo con los que se encontraron.
 *
 * Gana la coincidencia EXACTA sobre la parcial, y el alias más específico
 * sobre el más genérico: con encabezados "Nombre" y "Nombre contacto",
 * `contacto` se queda con el segundo y `empresa` con el primero, que es
 * lo que una persona esperaría al mirar su propia planilla.
 */
export function mapearColumnas(encabezados) {
  const claves = (encabezados || []).map(normalizarClave);
  const mapa = {};
  const tomadas = new Set();

  for (const exacta of [true, false]) {
    for (const [campo, alias] of Object.entries(ALIAS_COLUMNAS)) {
      if (campo in mapa) continue;
      // Alias más largo primero: "email contacto" antes que "email".
      for (const a of [...alias].sort((x, y) => y.length - x.length)) {
        const i = claves.findIndex((c, idx) =>
          !tomadas.has(idx) && c && (exacta ? c === a : c.includes(a)));
        if (i >= 0) { mapa[campo] = i; tomadas.add(i); break; }
      }
    }
  }
  return mapa;
}

// ---------- reconocer una planilla que nadie preparó ----------
//
// Estas heurísticas existen porque la planilla real NO viene con
// encabezados. Una base de contactos de ferias tiene varias pestañas,
// unas con títulos y otras donde la fila 1 ya es un contacto, y hasta
// tres columnas de correo por fila. Pedirle al admin que la deje
// "prolija" antes de importar es pedirle que haga el trabajo a mano.
//
// NINGUNA de estas funciones decide sola: lo que devuelven es una
// PROPUESTA que la vista previa muestra y el admin confirma o corrige
// antes de que se escriba una sola fila.

export const EMAIL_RE = /^[^@\s,;]+@[^@\s,;]+\.[a-z]{2,}$/i;

/** El primer correo de una celda que puede traer varios ("a@x.cl / b@x.cl"). */
export function primerEmail(celda) {
  for (const t of String(celda ?? '').split(/[\s,;|]+/)) {
    const s = t.trim().replace(/^<|>$/g, '');
    if (EMAIL_RE.test(s)) return s.toLowerCase();
  }
  return null;
}

const MUESTRA = 200; // filas que se miran para decidir; el resto no cambia el veredicto

/**
 * ¿La fila 1 son títulos o ya es un dato?
 *
 * La señal que de verdad discrimina es el arroba: una fila de títulos
 * dice "Correo 1", nunca `jromero@empresa.cl`. Se comprobó contra las 6
 * pestañas de la planilla real y acierta en las 6 — las que tienen
 * encabezado ("Chile_Hispanos", "Extranjeros_Ingles") y las que parten
 * derecho con datos.
 */
export function tieneEncabezado(filas) {
  const primera = filas?.[0];
  if (!primera?.length) return false;
  if (primera.some((c) => primerEmail(c))) return false;
  // Sin arrobas, se exige además que algo suene a título conocido: una
  // fila de datos sin correo (empresa sin contacto) no debe perderse por
  // creerla encabezado.
  return Object.keys(mapearColumnas(primera)).length >= 2;
}

/**
 * Propone { campo: índice } mirando el CONTENIDO, para las pestañas sin
 * encabezado.
 *
 * Solo el correo se detecta con confianza (el arroba no se presta a
 * dudas). Para `empresa` la señal es "texto corto y casi todo distinto":
 * en la planilla real la columna 0 es la feria de origen —"Aguas
 * Latinoamerica" repetida miles de veces— y la 1 es la empresa, así que
 * la RAZÓN DE VALORES DISTINTOS separa una de otra, y el largo mediano
 * descarta la columna de descripción, que también es distinta en cada
 * fila pero mide párrafos.
 */
export function detectarColumnas(filas) {
  // Se muestrean filas CON CONTENIDO, no las primeras N a secas: una
  // pestaña real ("contactados lunes 3101") trae 30 contactos y 970
  // filas vacías con formato, y midiendo sobre las 200 primeras toda
  // columna parecía despoblada — no se detectaba ninguna.
  const muestra = [];
  for (const f of filas || []) {
    if (f.some((c) => String(c ?? '').trim())) muestra.push(f);
    if (muestra.length >= MUESTRA) break;
  }
  const nCols = muestra.reduce((m, f) => Math.max(m, f.length), 0);
  if (!nCols) return {};

  const col = (i) => muestra.map((f) => String(f[i] ?? '').trim());
  const stats = [];
  for (let i = 0; i < nCols; i++) {
    const vals = col(i);
    const llenos = vals.filter(Boolean);
    const largos = llenos.map((v) => v.length).sort((a, b) => a - b);
    stats.push({
      i,
      llenos: llenos.length,
      correos: llenos.filter((v) => primerEmail(v)).length,
      // `rutValido` verifica el dígito verificador (módulo 11). Un patrón
      // de forma no basta: los teléfonos chilenos de la planilla real
      // ("56 2 2222 3333") calzaban con cualquier regex de 8-9 dígitos
      // más separador, y la columna de fono se importaba como RUT.
      ruts: llenos.filter((v) => rutValido(v)).length,
      urls: llenos.filter((v) => /^https?:|^www\./i.test(v)).length,
      distintos: new Set(llenos.map((v) => v.toLowerCase())).size,
      largoMediano: largos.length ? largos[Math.floor(largos.length / 2)] : 0,
    });
  }

  const mapa = {};
  const tomadas = new Set();
  const reservar = (campo, s) => { if (s) { mapa[campo] = s.i; tomadas.add(s.i); } };
  const libres = () => stats.filter((s) => !tomadas.has(s.i) && s.llenos > 0);

  // Correo: la columna con más celdas que traen un arroba válido.
  reservar('email', libres()
    .filter((s) => s.correos / s.llenos >= 0.5)
    .sort((a, b) => b.correos - a.correos)[0]);

  // RUT: basta con que aparezca en un tercio; muchas listas lo traen a medias.
  reservar('rut', libres()
    .filter((s) => s.ruts / s.llenos >= 0.34)
    .sort((a, b) => b.ruts - a.ruts)[0]);

  // Empresa: texto corto, casi todo distinto, poblado y sin URLs.
  const nombrables = libres().filter((s) =>
    s.llenos / muestra.length >= 0.6
    && s.largoMediano >= 3 && s.largoMediano <= 80
    && s.correos === 0 && s.urls === 0);
  reservar('empresa', [...nombrables].sort((a, b) =>
    (b.distintos / b.llenos) - (a.distintos / a.llenos) || a.i - b.i)[0]);

  // Contacto: la siguiente columna con la misma forma, a la derecha de la
  // empresa. Es la más incierta de todas — y la que menos importa que
  // falle: si sale vacía el cobro igual se envía, solo pierde el "Hola X".
  //
  // El filtro de valores distintos es el que hace el trabajo: sin él se
  // quedaba con la columna "País", que también es texto corto y poblado
  // pero repite "Chile" mil veces. El nombre de una persona no se repite.
  reservar('contacto', libres()
    .filter((s) => nombrables.some((n) => n.i === s.i)
      && s.largoMediano <= 60
      && s.distintos / s.llenos >= 0.5
      && (mapa.empresa == null || s.i > mapa.empresa))[0]);

  return mapa;
}

/**
 * Encabezados si los hay, contenido si no. Es la entrada que usan las
 * rutas: devuelve además desde qué fila empiezan los datos.
 */
export function proponerMapeo(filas) {
  const encabezado = tieneEncabezado(filas);
  const mapa = encabezado ? mapearColumnas(filas[0]) : detectarColumnas(filas);
  // Con encabezado pero sin columna de correo reconocida, el contenido
  // manda: hay planillas cuyo título es "Mail 1" o "@" y aun así la
  // columna es inconfundible mirando los valores.
  if (encabezado && mapa.email == null) {
    const porContenido = detectarColumnas(filas.slice(1));
    if (porContenido.email != null) mapa.email = porContenido.email;
  }
  return { encabezado, desde: encabezado ? 1 : 0, mapeo: mapa };
}
