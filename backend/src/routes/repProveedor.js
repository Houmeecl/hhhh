import express from 'express';
import crypto from 'crypto';
import multer from 'multer';
import { query } from '../lib/db.js';
import { requireAuth, requireHomePanel, requireNivelOperador, logActividad } from '../middleware/auth.js';
import { validarComponentes, calcularReciclabilidad, MATERIALES_REP } from '../services/rep.js';
import {
  validarItemsVenta, snapshotItemsVenta, totalesVenta, resumenRep,
} from '../services/repProveedor.js';

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
                         porcentaje, nivel, activo, created_at, updated_at`;

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

// Valida el cuerpo de crear/editar producto. Devuelve {error} o {datos}.
function leerProducto(body) {
  const nombre = String(body?.nombre || '').trim();
  if (!nombre) return { error: 'El nombre del producto es obligatorio.' };
  if (nombre.length > 200) return { error: 'El nombre del producto es demasiado largo.' };
  const codigo = body?.codigo == null || String(body.codigo).trim() === '' ? null : String(body.codigo).trim().slice(0, 80);
  const v = validarComponentes(body?.componentes);
  if (!v.ok) return { error: v.error };
  const calc = calcularReciclabilidad(body.componentes);
  if (!calc.nivel) return { error: 'El envase declarado no tiene peso: revisa los componentes.' };
  return { datos: { nombre, codigo, componentes: body.componentes, ...calc } };
}

// ---------- POST /productos — crear producto con su envase ----------
router.post('/productos', requireNivelOperador, async (req, res, next) => {
  try {
    const r = leerProducto(req.body);
    if (r.error) return res.status(400).json({ error: r.error });
    const d = r.datos;
    const { rows } = await query(
      `INSERT INTO productos_proveedor
         (proveedor_id, nombre, codigo, componentes, peso_total_gr, peso_reciclable_gr, porcentaje, nivel)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING ${CAMPOS_PRODUCTO}`,
      [req.user.proveedor_id, d.nombre, d.codigo, JSON.stringify(d.componentes),
       d.peso_total_gr, d.peso_reciclable_gr, d.porcentaje, d.nivel]
    );
    await logActividad({
      usuarioId: req.user.sub, accion: 'rep_producto_crear', entidad: 'producto_proveedor',
      entidadId: rows[0].id, detalle: { nombre: d.nombre, nivel: d.nivel }, ip: req.ip,
    });
    res.status(201).json({ producto: rows[0] });
  } catch (err) { next(err); }
});

// ---------- PUT /productos/:id — editar o activar/desactivar ----------
// Editar NO reescribe ventas pasadas: sus items son snapshots.
router.put('/productos/:id', requireNivelOperador, async (req, res, next) => {
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
    const { rows } = await query(
      `UPDATE productos_proveedor
          SET nombre = $3, codigo = $4, componentes = $5, peso_total_gr = $6,
              peso_reciclable_gr = $7, porcentaje = $8, nivel = $9,
              activo = COALESCE($10, activo), updated_at = now()
        WHERE id = $1 AND proveedor_id = $2
        RETURNING ${CAMPOS_PRODUCTO}`,
      [req.params.id, req.user.proveedor_id, d.nombre, d.codigo, JSON.stringify(d.componentes),
       d.peso_total_gr, d.peso_reciclable_gr, d.porcentaje, d.nivel,
       typeof req.body?.activo === 'boolean' ? req.body.activo : null]
    );
    await logActividad({
      usuarioId: req.user.sub, accion: 'rep_producto_editar', entidad: 'producto_proveedor',
      entidadId: req.params.id, detalle: { nombre: d.nombre }, ip: req.ip,
    });
    res.json({ producto: rows[0] });
  } catch (err) { next(err); }
});

// ---------- GET /ventas — ventas propias + resumen REP ----------
router.get('/ventas', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, numero_documento, fecha_documento, periodo, archivo_nombre, extension,
              tamano_bytes, sha256, items, kg_envases, kg_reciclables, created_at
         FROM ventas_rep WHERE proveedor_id = $1
        ORDER BY fecha_documento DESC, created_at DESC`,
      [req.user.proveedor_id]
    );
    res.json({
      ventas: rows,
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
