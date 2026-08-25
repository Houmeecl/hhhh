import express from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireRole, requireHomePanel, requireSeccion, logActividad } from '../middleware/auth.js';
import {
  generarCodigoActivo, codigoActivoValido, activoParaImpresion, coberturasDeActivo,
} from '../services/activo.js';
import { generateAdhesivoActivo } from '../services/pdf.js';

// ============================================================
// Activos del piloto: alta, listado y emisión del adhesivo.
//
// QUÉ RESUELVE. Hasta acá `activos` (migración 109) solo se podía llenar
// con SQL a mano y `generateAdhesivoActivo` no tenía quien lo llamara: el
// PDF salía correcto y no había forma de pedirlo. Sin esto el piloto no
// puede pegar un adhesivo en ninguna camioneta.
//
// POR QUÉ LA PATENTE VIVE ACÁ Y NO EN LA RUTA PÚBLICA. En el adhesivo
// impreso la patente no revela nada: está pegada al lado de la placa. En
// `GET /api/activo/:codigo` sí revelaría, porque la lee cualquiera desde
// cualquier parte probando códigos, y convertiría el QR en un directorio
// de qué móvil pertenece a qué empresa auditada. Por eso este módulo va
// detrás de `requireSeccion('activos')` y usa `activoParaImpresion`,
// mientras la ruta pública usa `activoPublico`.
// ============================================================

const router = express.Router();
router.use(requireAuth, requireHomePanel('sicrep'));
const adminOnly = requireRole('admin');

const TIPOS = ['vehiculo', 'maquinaria', 'equipo', 'otro'];

// Tope de la tanda. No es una cifra mágica: es cuántas páginas se pueden
// armar en memoria sin que la petición se vuelva un problema, y el piloto
// declarado son 3 contratos × 3 activos. Si un día no alcanza, se sube
// acá y se dice — lo que no se hace es truncar en silencio, que es como
// una tanda de 60 se convierte en 50 y nadie se entera hasta que faltan
// diez adhesivos en terreno.
const MAX_TANDA = 60;

// Nombre de archivo seguro: el código ya está validado contra su regexp,
// así que no puede traer separadores de ruta, pero se deja explícito
// porque este valor viaja en una cabecera.
const nombreArchivo = (codigo) => `adhesivo-${String(codigo).replace(/[^A-Z0-9-]/gi, '')}.pdf`;

// ---------- Listado ----------
//
// Trae la patente: es una pantalla de administración detrás de su sección,
// y sin patente la lista es inutilizable para quien tiene que reconocer
// cuál camioneta es cuál.
router.get('/', requireSeccion('activos'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT a.id, a.codigo, a.nombre, a.tipo, a.contrato, a.identificador_interno,
              a.periodo_desde, a.periodo_hasta, a.activo, a.created_at,
              a.proveedor_id, p.nombre_empresa, p.rut
         FROM activos a
         JOIN proveedores p ON p.id = a.proveedor_id
        ORDER BY p.nombre_empresa, a.contrato NULLS LAST, a.created_at DESC`
    );
    res.json({ activos: rows });
  } catch (err) { next(err); }
});

// ---------- Proveedores para el selector del alta ----------
//
// Tiene su propio endpoint en vez de reusar el de `accesos`: ese exige la
// sección 'accesos_externos', y una cuenta que solo imprime adhesivos no
// tiene por qué llevarse de arriba todo el módulo de accesos externos.
// Devuelve nombre y RUT y nada más — es un selector, no una ficha.
router.get('/proveedores', requireSeccion('activos'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, nombre_empresa, rut FROM proveedores
        WHERE activo = true ORDER BY nombre_empresa`
    );
    res.json({ proveedores: rows });
  } catch (err) { next(err); }
});

// ---------- Alta ----------
router.post('/', requireSeccion('activos'), adminOnly, async (req, res, next) => {
  try {
    const {
      proveedor_id: proveedorId, nombre, tipo = 'vehiculo', contrato,
      identificador_interno: patente, periodo_desde: desde, periodo_hasta: hasta,
    } = req.body || {};

    if (!proveedorId) return res.status(400).json({ error: 'Falta el proveedor' });
    if (!String(nombre || '').trim()) return res.status(400).json({ error: 'Falta el nombre del activo' });
    if (!TIPOS.includes(tipo)) return res.status(400).json({ error: `Tipo inválido: ${TIPOS.join(', ')}` });

    // El período se valida acá y no solo en la base: un rango invertido
    // pasa el CHECK de tipo DATE sin problema y después imprime
    // "31-dic-2026 a 01-ene-2026" en un adhesivo pegado a una camioneta.
    if (desde && hasta && new Date(desde) > new Date(hasta)) {
      return res.status(400).json({ error: 'El período termina antes de empezar' });
    }

    const { rows: prov } = await query('SELECT id FROM proveedores WHERE id = $1', [proveedorId]);
    if (!prov.length) return res.status(404).json({ error: 'Proveedor no encontrado' });

    // El código se genera en el servidor y no se acepta del cliente: es la
    // única credencial de una página pública y quien la elija podría
    // elegirla corta o adivinable.
    const codigo = generarCodigoActivo();

    const { rows } = await query(
      `INSERT INTO activos (codigo, proveedor_id, nombre, tipo, contrato,
                            identificador_interno, periodo_desde, periodo_hasta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [codigo, proveedorId, String(nombre).trim(), tipo,
        contrato ? String(contrato).trim() : null,
        patente ? String(patente).trim().toUpperCase() : null,
        desde || null, hasta || null]
    );

    await logActividad(req, 'activo_creado', { codigo, proveedor_id: proveedorId });
    res.status(201).json({ activo: rows[0] });
  } catch (err) { next(err); }
});

// ---------- Baja lógica ----------
//
// No se borra la fila: el adhesivo ya está pegado en una camioneta y su QR
// va a seguir siendo escaneado. Bajar `activo` hace que la ruta pública
// responda 404, que es lo correcto —ese activo salió del piloto— sin
// perder el registro de que existió.
router.delete('/:id', requireSeccion('activos'), adminOnly, async (req, res, next) => {
  try {
    const { rows } = await query(
      'UPDATE activos SET activo = false WHERE id = $1 RETURNING codigo',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Activo no encontrado' });
    await logActividad(req, 'activo_dado_de_baja', { codigo: rows[0].codigo });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// La fila más las coberturas de su contrato, lista para el PDF.
// Compartida por la emisión de uno y la de la tanda para que un adhesivo
// suelto y el mismo adhesivo dentro de una tanda no puedan salir
// distintos.
async function paraImprimir(codigo) {
  const { rows } = await query(
    `SELECT codigo, nombre, tipo, contrato, identificador_interno,
            periodo_desde, periodo_hasta, proveedor_id
       FROM activos WHERE codigo = $1 AND activo = true`,
    [codigo]
  );
  const fila = rows[0];
  if (!fila) return null;
  return activoParaImpresion(fila, await coberturasDeActivo(query, fila));
}

// ---------- Emitir UN adhesivo ----------
router.get('/:codigo/adhesivo.pdf', requireSeccion('activos'), async (req, res, next) => {
  try {
    const codigo = String(req.params.codigo || '').trim().toUpperCase();
    if (!codigoActivoValido(codigo)) return res.status(404).json({ error: 'Activo no encontrado' });

    const activo = await paraImprimir(codigo);
    if (!activo) return res.status(404).json({ error: 'Activo no encontrado' });

    const pdf = await generateAdhesivoActivo({ activo });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nombreArchivo(codigo)}"`);
    res.send(pdf);
  } catch (err) { next(err); }
});

// ---------- Emitir una TANDA ----------
//
// Una flota se imprime junta o no se imprime: pedir cuarenta PDF de a uno
// y pegarlos a mano es la clase de fricción que hace que el piloto salga a
// terreno sin adhesivos.
//
// Devuelve un ZIP y no un PDF de varias páginas a propósito: cada adhesivo
// tiene su propio tamaño de página (300×190 pt) y las imprentas de
// etiquetas piden un archivo por etiqueta. Un PDF multipágina obligaría a
// recortar.
router.post('/adhesivos.zip', requireSeccion('activos'), async (req, res, next) => {
  try {
    const pedidos = Array.isArray(req.body?.codigos) ? req.body.codigos : [];
    if (!pedidos.length) return res.status(400).json({ error: 'No se pidió ningún código' });
    if (pedidos.length > MAX_TANDA) {
      // Se dice el tope en vez de recortar. Ver MAX_TANDA.
      return res.status(400).json({ error: `Máximo ${MAX_TANDA} adhesivos por tanda; se pidieron ${pedidos.length}` });
    }

    const archivos = [];
    const faltantes = [];
    for (const bruto of pedidos) {
      const codigo = String(bruto || '').trim().toUpperCase();
      if (!codigoActivoValido(codigo)) { faltantes.push(bruto); continue; }
      const activo = await paraImprimir(codigo);
      if (!activo) { faltantes.push(codigo); continue; }
      archivos.push({ nombre: nombreArchivo(codigo), datos: await generateAdhesivoActivo({ activo }) });
    }

    // Si no salió NINGUNO se responde error, no un ZIP vacío: un archivo de
    // cero bytes se descarga sin protestar y el problema aparece recién
    // cuando alguien lo abre.
    if (!archivos.length) return res.status(404).json({ error: 'Ninguno de los códigos corresponde a un activo vigente' });

    // Los que no salieron se nombran en una cabecera. No se callan: una
    // tanda de 9 que entrega 7 sin decirlo es exactamente cómo el piloto
    // llega a terreno con dos camionetas sin adhesivo.
    if (faltantes.length) res.setHeader('X-Adhesivos-Omitidos', faltantes.join(','));

    await logActividad(req, 'adhesivos_emitidos', { emitidos: archivos.length, omitidos: faltantes.length });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="adhesivos.zip"');
    res.send(zipSinCompresion(archivos));
  } catch (err) { next(err); }
});

// ---------- ZIP mínimo, sin dependencias ----------
//
// Se guarda con método 0 (almacenado, sin comprimir). Un PDF ya viene
// comprimido por dentro, así que deflate ahorraría casi nada y a cambio
// habría que traer una dependencia nueva para armar un archivo de cuarenta
// etiquetas. Mismo criterio que el lector de Excel de `cobros`: si el
// formato se puede escribir en treinta líneas, se escribe.
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function zipSinCompresion(archivos) {
  const locales = [];
  const centrales = [];
  let offset = 0;

  for (const { nombre, datos } of archivos) {
    const nom = Buffer.from(nombre, 'utf8');
    const crc = crc32(datos);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);   // firma
    local.writeUInt16LE(20, 4);           // versión mínima
    local.writeUInt16LE(0, 6);            // sin banderas
    local.writeUInt16LE(0, 8);            // método 0 = almacenado
    local.writeUInt16LE(0, 10);           // hora: cero, no la del reloj
    local.writeUInt16LE(0x21, 12);        // fecha: 1980-01-01, el mínimo del formato
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(datos.length, 18);
    local.writeUInt32LE(datos.length, 22);
    local.writeUInt16LE(nom.length, 26);
    local.writeUInt16LE(0, 28);           // sin campo extra
    locales.push(local, nom, datos);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(datos.length, 20);
    central.writeUInt32LE(datos.length, 24);
    central.writeUInt16LE(nom.length, 28);
    central.writeUInt32LE(offset, 42);
    centrales.push(central, nom);

    offset += 30 + nom.length + datos.length;
  }

  const cuerpoCentral = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(archivos.length, 8);
  fin.writeUInt16LE(archivos.length, 10);
  fin.writeUInt32LE(cuerpoCentral.length, 12);
  fin.writeUInt32LE(offset, 16);

  return Buffer.concat([...locales, cuerpoCentral, fin]);
}

export default router;
