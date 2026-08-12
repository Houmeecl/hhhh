import express from 'express';
import crypto from 'crypto';
import multer from 'multer';
import { query } from '../lib/db.js';
import { requireAuth, requireHomePanel, requireNivelOperador, logActividad } from '../middleware/auth.js';
import { validarComponentes, calcularReciclabilidad, MATERIALES_REP } from '../services/rep.js';
import {
  validarItemsVenta, snapshotItemsVenta, totalesVenta, resumenRep,
  normalizarNumeroDoc, cruzarConRcv,
} from '../services/repProveedor.js';
import { analisisIA } from '../services/analisisIA.js';

// ============================================================
// Ley REP desde el panel del proveedor (/api/panel-proveedor/rep).
//
// La empresa — el productor obligado por la Ley 20.920 — mantiene su
// catálogo de productos con la composición del envase, sube su factura
// de venta (evidencia, foto o PDF/XML: en terreno no hay POS) y la pega
// a sus productos con sus unidades. El resumen entrega los kilos de
// envases puestos en el mercado por material y período: el insumo de su
// declaración en RETC/SGR. La declaración formal ante el MMA la hace la
// empresa titular — nunca sicr3p ni a través de sicr3p.
//
// Todo cálculo (reciclabilidad, kilos, resumen) es SERVER-SIDE; los
// items de una venta quedan como SNAPSHOT del producto al momento de
// venderla (editar el producto no reescribe lo ya declarado).
//
// A DIFERENCIA del SII (origen.js: requireContratoVigente), REP no exige
// contrato vigente A PROPÓSITO: la REP es una obligación legal de la
// empresa (Ley 20.920), no un servicio contratado a sicr3p — bloquearle
// el registro de sus propias ventas mientras se emite el contrato sería
// ponerle un peaje a cumplir la ley.
// ============================================================

const router = express.Router();
router.use(requireAuth, requireHomePanel('proveedor'));

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

// Evidencia de la venta: mismos formatos que la carga pública (la foto
// del teléfono es el caso principal en terreno).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(pdf|xml|jpe?g|png|heic)$/i.test(file.originalname);
    cb(ok ? null : new Error('Formato no permitido: usa PDF, XML, JPG, PNG o HEIC.'), ok);
  },
});

// Envuelve multer para que sus errores lleguen como 400 con mensaje en
// español y no como 500 genérico (mismo patrón que uploadArchivos en
// public.js y uploadFoto en juego.js).
function uploadArchivo(req, res, next) {
  upload.single('archivo')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'El archivo debe pesar menos de 15 MB.' });
      }
      return res.status(400).json({ error: 'No se pudo procesar la carga del archivo.' });
    }
    if (err) return res.status(400).json({ error: err.message || 'Formato no permitido.' });
    next();
  });
}

// Un id que no es UUID hace fallar la consulta con un error de Postgres y
// un 500; se responde 404, que es lo que realmente pasa (patrón motor.js).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CAMPOS_PRODUCTO = `id, nombre, codigo, componentes, peso_total_gr, peso_reciclable_gr,
                         porcentaje, nivel, activo, created_at, updated_at,
                         (foto_embalaje IS NOT NULL) AS tiene_foto_embalaje`;

// Foto de embalaje como EVIDENCIA del producto (opcional, migración 095) —
// distinta de la foto que /estimar-embalaje analiza y descarta: esta se
// adjunta al crear/editar el producto, solo si la persona la guarda.
// Mismos formatos y tope que uploadFotoEmbalaje más abajo.
const uploadFotoProducto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\//.test(file.mimetype);
    cb(ok ? null : new Error('La foto de evidencia debe ser una imagen (JPG, PNG o WEBP).'), ok);
  },
});
function uploadFotoOpcional(req, res, next) {
  uploadFotoProducto.single('foto')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'La foto debe pesar menos de 15 MB.' : 'No se pudo procesar la foto.' });
    }
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}

// ---------- POST /estimar-embalaje — foto → componentes propuestos ----------
// El mismo mecanismo de visión del juego "Sube y Suma", pero para dejar
// de declarar el embalaje al ojo: la foto del producto le precarga los
// componentes al formulario (material/peso/cantidad en la taxonomía REP)
// y la persona los revisa y ajusta ANTES de guardar — el servidor
// re-valida y recalcula todo al guardar, igual que con el tipeo manual.
// La foto se analiza en memoria y se descarta (patrón juego.js: nunca se
// persiste). Si la IA no está configurada o se agotó el presupuesto
// diario, se responde 503 con mensaje claro y el tipeo manual sigue —
// la declaración REP es una obligación legal, jamás depende de la IA.
const uploadFotoEmbalaje = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\//.test(file.mimetype);
    cb(ok ? null : new Error('Sube una foto (JPG, PNG o WEBP).'), ok);
  },
});

router.post('/estimar-embalaje', requireNivelOperador, (req, res, next) => {
  uploadFotoEmbalaje.single('foto')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'La foto debe pesar menos de 15 MB.' : 'No se pudo procesar la foto.' });
    }
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Falta la foto.' });
    const mediaType = req.file.mimetype === 'image/png' ? 'image/png'
      : req.file.mimetype === 'image/webp' ? 'image/webp' : 'image/jpeg';
    const r = await analisisIA.estimarEmbalaje({
      imagenBase64: req.file.buffer.toString('base64'),
      mediaType,
    });
    if (!r) {
      return res.status(503).json({ error: 'La estimación por foto no está disponible en este momento — ingresa los componentes a mano.' });
    }
    if (!r.fotoValida || !r.componentes.length) {
      return res.status(422).json({ error: 'No se pudo identificar el embalaje en la foto. Toma otra con el producto completo y buena luz, o ingresa los componentes a mano.' });
    }
    res.json({ componentes: r.componentes, referencial: true });
  } catch (err) { next(err); }
});

// ---------- GET /productos — catálogo propio ----------
router.get('/productos', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT ${CAMPOS_PRODUCTO} FROM productos_proveedor
        WHERE proveedor_id = $1 ORDER BY activo DESC, nombre`,
      [req.user.proveedor_id]
    );
    res.json({ productos: rows, materiales: MATERIALES_REP });
  } catch (err) { next(err); }
});

// Solo invoca multer si la petición realmente es multipart — crear/editar
// sin foto sigue mandando JSON puro (ej. el toggle activar/desactivar), y
// multer no sabe parsear eso.
function conFotoOpcional(req, res, next) {
  if (req.is('multipart/form-data')) return uploadFotoOpcional(req, res, next);
  next();
}

// Valida el cuerpo de crear/editar producto. Devuelve {error} o {datos}.
// `componentes` llega como array con JSON body, o como STRING con
// multipart (FormData no serializa arrays anidados) — se parsea acá.
function leerProducto(body) {
  const nombre = String(body?.nombre || '').trim();
  if (!nombre) return { error: 'El nombre del producto es obligatorio.' };
  if (nombre.length > 200) return { error: 'El nombre del producto es demasiado largo.' };
  const codigo = body?.codigo == null || String(body.codigo).trim() === '' ? null : String(body.codigo).trim().slice(0, 80);
  let componentes = body?.componentes;
  if (typeof componentes === 'string') {
    try { componentes = JSON.parse(componentes); } catch { return { error: 'Los componentes del envase no son válidos.' }; }
  }
  const v = validarComponentes(componentes);
  if (!v.ok) return { error: v.error };
  const calc = calcularReciclabilidad(componentes);
  if (!calc.nivel) return { error: 'El envase declarado no tiene peso: revisa los componentes.' };
  return { datos: { nombre, codigo, componentes, ...calc } };
}

// Extensión real desde el mimetype (no del nombre del archivo, que en
// fotos de cámara suele venir genérico o ausente) — mismo criterio que
// estimar-embalaje más arriba.
function datosFotoDesde(req) {
  if (!req.file) return null;
  const extension = req.file.mimetype === 'image/png' ? 'png'
    : req.file.mimetype === 'image/webp' ? 'webp' : 'jpg';
  return {
    foto_embalaje: req.file.buffer,
    foto_extension: extension,
    foto_tamano_bytes: req.file.size,
    foto_sha256: sha256(req.file.buffer),
  };
}

// ---------- POST /productos — crear producto con su envase ----------
// Multipart opcional: campo `foto` con la evidencia de embalaje que la
// persona decidió guardar (checkbox del frontend, migración 095) — sin
// ella, crear un producto funciona exactamente igual que antes.
router.post('/productos', requireNivelOperador, conFotoOpcional, async (req, res, next) => {
  try {
    const r = leerProducto(req.body);
    if (r.error) return res.status(400).json({ error: r.error });
    const d = r.datos;
    const foto = datosFotoDesde(req);
    const { rows } = await query(
      `INSERT INTO productos_proveedor
         (proveedor_id, nombre, codigo, componentes, peso_total_gr, peso_reciclable_gr, porcentaje, nivel,
          foto_embalaje, foto_extension, foto_tamano_bytes, foto_sha256)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING ${CAMPOS_PRODUCTO}`,
      [req.user.proveedor_id, d.nombre, d.codigo, JSON.stringify(d.componentes),
       d.peso_total_gr, d.peso_reciclable_gr, d.porcentaje, d.nivel,
       foto?.foto_embalaje ?? null, foto?.foto_extension ?? null,
       foto?.foto_tamano_bytes ?? null, foto?.foto_sha256 ?? null]
    );
    await logActividad({
      usuarioId: req.user.sub, accion: 'rep_producto_crear', entidad: 'producto_proveedor',
      entidadId: rows[0].id, detalle: { nombre: d.nombre, nivel: d.nivel, con_foto: !!foto }, ip: req.ip,
    });
    res.status(201).json({ producto: rows[0] });
  } catch (err) { next(err); }
});

// ---------- PUT /productos/:id — editar o activar/desactivar ----------
// Editar NO reescribe ventas pasadas: sus items son snapshots. La foto
// solo se reemplaza si llega una nueva (COALESCE) — editar el texto del
// envase no borra la evidencia ya guardada.
router.put('/productos/:id', requireNivelOperador, conFotoOpcional, async (req, res, next) => {
  try {
    if (!UUID_RE.test(String(req.params.id))) return res.status(404).json({ error: 'Producto no encontrado.' });
    const { rows: propios } = await query(
      `SELECT id FROM productos_proveedor WHERE id = $1 AND proveedor_id = $2`,
      [req.params.id, req.user.proveedor_id]
    );
    if (!propios[0]) return res.status(404).json({ error: 'Producto no encontrado.' });

    // Solo activar/desactivar, sin tocar el envase.
    if (req.body?.componentes === undefined && typeof req.body?.activo === 'boolean') {
      const { rows } = await query(
        `UPDATE productos_proveedor SET activo = $3, updated_at = now()
          WHERE id = $1 AND proveedor_id = $2 RETURNING ${CAMPOS_PRODUCTO}`,
        [req.params.id, req.user.proveedor_id, req.body.activo]
      );
      return res.json({ producto: rows[0] });
    }

    const r = leerProducto(req.body);
    if (r.error) return res.status(400).json({ error: r.error });
    const d = r.datos;
    const foto = datosFotoDesde(req);
    const { rows } = await query(
      `UPDATE productos_proveedor
          SET nombre = $3, codigo = $4, componentes = $5, peso_total_gr = $6,
              peso_reciclable_gr = $7, porcentaje = $8, nivel = $9,
              activo = COALESCE($10, activo),
              foto_embalaje = COALESCE($11, foto_embalaje),
              foto_extension = COALESCE($12, foto_extension),
              foto_tamano_bytes = COALESCE($13, foto_tamano_bytes),
              foto_sha256 = COALESCE($14, foto_sha256),
              updated_at = now()
        WHERE id = $1 AND proveedor_id = $2
        RETURNING ${CAMPOS_PRODUCTO}`,
      [req.params.id, req.user.proveedor_id, d.nombre, d.codigo, JSON.stringify(d.componentes),
       d.peso_total_gr, d.peso_reciclable_gr, d.porcentaje, d.nivel,
       typeof req.body?.activo === 'boolean' ? req.body.activo : null,
       foto?.foto_embalaje ?? null, foto?.foto_extension ?? null,
       foto?.foto_tamano_bytes ?? null, foto?.foto_sha256 ?? null]
    );
    await logActividad({
      usuarioId: req.user.sub, accion: 'rep_producto_editar', entidad: 'producto_proveedor',
      entidadId: req.params.id, detalle: { nombre: d.nombre, con_foto_nueva: !!foto }, ip: req.ip,
    });
    res.json({ producto: rows[0] });
  } catch (err) { next(err); }
});

// ---------- GET /ventas — ventas propias + resumen REP + cruce RCV ----------
router.get('/ventas', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, numero_documento, fecha_documento, periodo, archivo_nombre, extension,
              tamano_bytes, sha256, items, kg_envases, kg_reciclables, created_at
         FROM ventas_rep WHERE proveedor_id = $1
        ORDER BY fecha_documento DESC, created_at DESC`,
      [req.user.proveedor_id]
    );
    // Cruce contra las ventas REALES del RCV que el mismo proveedor
    // descargó del SII: la declaración REP se contrasta, no se cree sola.
    const { rows: rcv } = await query(
      `SELECT periodo, folio, tipo_dte FROM dte_proveedor WHERE proveedor_id = $1 AND tipo = 'venta'`,
      [req.user.proveedor_id]
    );
    const cruce = cruzarConRcv(rows, rcv);
    res.json({
      ventas: rows.map((v) => ({ ...v, consta_en_rcv: cruce.por_venta.get(v.id) ?? null })),
      cruce_rcv: cruce.por_periodo,
      resumen: resumenRep(rows),
      // El texto que el frontend muestra junto al resumen — una sola
      // fuente para no reescribirlo distinto en cada pantalla.
      aviso: 'Estos kilos por material son el insumo para tu declaración de envases y embalajes '
        + 'en RETC/SGR (Ley 20.920). La declaración formal ante el MMA la hace tu empresa — '
        + 'sicr3p no declara por ti ni certifica.',
    });
  } catch (err) { next(err); }
});

// ---------- POST /ventas — subir la factura y pegarla a productos ----------
// multipart: archivo + numero_documento + fecha_documento + items (JSON).
router.post('/ventas', requireNivelOperador, uploadArchivo, async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Adjunta la factura (archivo o foto).' });
    const numero = String(req.body?.numero_documento || '').trim();
    if (!numero) return res.status(400).json({ error: 'El número del documento es obligatorio.' });
    if (numero.length > 60) return res.status(400).json({ error: 'El número del documento es demasiado largo.' });
    const fecha = String(req.body?.fecha_documento || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(fecha))) {
      return res.status(400).json({ error: 'La fecha del documento debe ser AAAA-MM-DD.' });
    }
    // Una factura con fecha futura no existe todavía. Margen de 1 día por
    // zonas horarias (el servidor puede ir en UTC, un día "adelante" de Chile).
    if (Date.parse(fecha) > Date.now() + 24 * 3600 * 1000) {
      return res.status(400).json({ error: 'La fecha del documento está en el futuro — revísala.' });
    }

    // La misma factura registrada dos veces DUPLICA kilos en el resumen
    // que alimenta la declaración RETC/SGR. Este chequeo compara por
    // número normalizado a dígitos ("F-123" = "123") y es el que atrapa
    // las variantes con prefijo. El índice único de la migración 088
    // cubre solo el duplicado exacto (lower/trim) — es el respaldo contra
    // dobles envíos simultáneos del MISMO texto, no un candado total.
    const { rows: existentes } = await query(
      `SELECT numero_documento FROM ventas_rep WHERE proveedor_id = $1`,
      [req.user.proveedor_id]
    );
    const numNorm = normalizarNumeroDoc(numero);
    const repetida = existentes.find((e) => normalizarNumeroDoc(e.numero_documento) === numNorm);
    if (repetida) {
      return res.status(409).json({
        error: `La factura N° ${repetida.numero_documento} ya está registrada — registrarla de nuevo duplicaría sus kilos en tu declaración.`,
      });
    }

    let items;
    try { items = JSON.parse(req.body?.items || '[]'); }
    catch { return res.status(400).json({ error: 'Los productos de la factura llegaron mal formados.' }); }

    const { rows: productos } = await query(
      `SELECT ${CAMPOS_PRODUCTO} FROM productos_proveedor WHERE proveedor_id = $1`,
      [req.user.proveedor_id]
    );
    const porId = new Map(productos.map((p) => [p.id, p]));
    const v = validarItemsVenta(items, porId);
    if (!v.ok) return res.status(400).json({ error: v.error });

    const snapshot = snapshotItemsVenta(items, porId);
    const tot = totalesVenta(snapshot);
    const ext = (req.file.originalname.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();

    const { rows } = await query(
      `INSERT INTO ventas_rep
         (proveedor_id, numero_documento, fecha_documento, periodo, archivo, archivo_nombre,
          extension, tamano_bytes, sha256, items, kg_envases, kg_reciclables)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id, numero_documento, fecha_documento, periodo, archivo_nombre, extension,
                 tamano_bytes, sha256, items, kg_envases, kg_reciclables, created_at`,
      [req.user.proveedor_id, numero, fecha, fecha.slice(0, 7), req.file.buffer,
       req.file.originalname.slice(0, 200), ext, req.file.size, sha256(req.file.buffer),
       JSON.stringify(snapshot), tot.kg_envases, tot.kg_reciclables]
    );
    await logActividad({
      usuarioId: req.user.sub, accion: 'rep_venta_registrar', entidad: 'venta_rep',
      entidadId: rows[0].id,
      detalle: { numero_documento: numero, kg_envases: tot.kg_envases, n_productos: snapshot.length },
      ip: req.ip,
    });
    res.status(201).json({ venta: rows[0] });
  } catch (err) {
    // Carrera contra el índice único de la 088 (dos envíos simultáneos
    // del mismo número): mismo 409 amable que el chequeo de arriba.
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'Esa factura ya está registrada — registrarla de nuevo duplicaría sus kilos en tu declaración.' });
    }
    next(err);
  }
});

// ---------- GET /productos/:id/foto — descargar la foto de evidencia ----------
router.get('/productos/:id/foto', async (req, res, next) => {
  try {
    if (!UUID_RE.test(String(req.params.id))) return res.status(404).json({ error: 'Producto no encontrado.' });
    const { rows } = await query(
      `SELECT foto_embalaje, foto_extension FROM productos_proveedor
        WHERE id = $1 AND proveedor_id = $2`,
      [req.params.id, req.user.proveedor_id]
    );
    if (!rows[0] || !rows[0].foto_embalaje) return res.status(404).json({ error: 'Este producto no tiene foto de evidencia.' });
    res.setHeader('Content-Type', MIME[rows[0].foto_extension] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(rows[0].foto_embalaje);
  } catch (err) { next(err); }
});

// ---------- GET /ventas/:id/archivo — descargar la evidencia propia ----------
const MIME = {
  pdf: 'application/pdf', xml: 'application/xml', jpg: 'image/jpeg',
  jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic',
};
router.get('/ventas/:id/archivo', async (req, res, next) => {
  try {
    if (!UUID_RE.test(String(req.params.id))) return res.status(404).json({ error: 'Venta no encontrada.' });
    const { rows } = await query(
      `SELECT archivo, archivo_nombre, extension FROM ventas_rep
        WHERE id = $1 AND proveedor_id = $2`,
      [req.params.id, req.user.proveedor_id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Venta no encontrada.' });
    res.setHeader('Content-Type', MIME[rows[0].extension] || 'application/octet-stream');
    // El nombre viene del usuario: fuera de ASCII imprimible, setHeader
    // lanza (emoji, tildes raras) y la descarga propia moriría en 500.
    const nombreSeguro = rows[0].archivo_nombre.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreSeguro || 'factura'}"`);
    res.send(rows[0].archivo);
  } catch (err) { next(err); }
});

export default router;
