import express from 'express';
import multer from 'multer';
import { query, withTx } from '../lib/db.js';
import { requireAuth, requireRole, requireHomePanel, requireSeccion, logActividad } from '../middleware/auth.js';
import { simpleApi } from '../services/simpleApi.js';
import { cargarCuentas, registrarMovimientos } from '../services/capitalNatural.js';
import { bigquery } from '../services/bigquery.js';
import { invalidarCacheCatalogo } from '../services/catalogoCorredor.js';

const router = express.Router();
router.use(requireAuth, requireHomePanel('sicrep'), requireSeccion('corredor'));
const adminOnly = requireRole('admin', 'operador');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(pdf|xml|jpe?g|png)$/i.test(file.originalname);
    cb(ok ? null : new Error('Formato no permitido'), ok);
  },
});

const round4 = (n) => Math.round(n * 10000) / 10000;
// Tipos de documento que el motor Simple puede analizar hoy.
const SOPORTA_SIMPLE = new Set(['factura', 'energia', 'combustible']);

// ============================================================
// METODOLOGÍA POR PAÍS
// ============================================================
router.get('/metodologias', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM metodologias_pais ORDER BY array_position(ARRAY['CL','AR','PY','BR'], pais)`
    );
    res.json({ metodologias: rows });
  } catch (err) { next(err); }
});

router.put('/metodologias/:pais', adminOnly, async (req, res, next) => {
  try {
    const pais = String(req.params.pais).toUpperCase();
    const { nombre, factores, referencia, fuente, vigencia, activo, notas } = req.body;
    const { rows } = await query(
      `UPDATE metodologias_pais SET
         nombre = COALESCE($2,nombre),
         factores = COALESCE($3,factores),
         referencia = COALESCE($4,referencia),
         fuente = COALESCE($5,fuente),
         vigencia = COALESCE($6,vigencia),
         activo = COALESCE($7,activo),
         notas = COALESCE($8,notas),
         updated_at = now()
       WHERE pais = $1 RETURNING *`,
      [pais, nombre, factores ? JSON.stringify(factores) : null, referencia, fuente, vigencia,
       typeof activo === 'boolean' ? activo : null, notas]
    );
    if (!rows[0]) return res.status(404).json({ error: 'País no encontrado' });
    await logActividad({ usuarioId: req.user.sub, accion: 'editar_metodologia', entidad: 'metodologia_pais', entidadId: pais, ip: req.ip });
    res.json({ metodologia: rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// DOCUMENTOS DEL CORREDOR
// ============================================================
router.get('/documentos', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM documentos_corredor ORDER BY created_at DESC LIMIT 200`);
    res.json({ documentos: rows });
  } catch (err) { next(err); }
});

router.get('/documentos/:id', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM documentos_corredor WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Documento no encontrado' });
    const { rows: items } = await query(`SELECT * FROM documento_items WHERE documento_id = $1`, [req.params.id]);
    res.json({ documento: rows[0], items });
  } catch (err) { next(err); }
});

router.post('/documentos', adminOnly, upload.single('archivo'), async (req, res, next) => {
  try {
    const { pais_origen, pais_destino, tramo, tipo_documento, rut_emisor, rut_receptor, numero_documento } = req.body;
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'Debes adjuntar un documento.' });
    const tipo = tipo_documento || 'otro';

    // País cuya metodología aplica (destino, o Chile por defecto).
    const paisMet = (pais_destino || pais_origen || 'CL').toUpperCase();
    const { rows: mRows } = await query(`SELECT * FROM metodologias_pais WHERE pais = $1`, [paisMet]);
    const met = mRows[0];

    const soportado = SOPORTA_SIMPLE.has(tipo);
    // Si la metodología del país no está activa, no calculamos carbono (queda pendiente).
    const metActiva = met && met.activo;

    const result = await withTx(async (client) => {
      let estado = 'traza';
      let total = 0;
      let categoria = null;
      let items = [];

      if (soportado && metActiva) {
        const analysis = await simpleApi.analyzeInvoice({
          filename: file.originalname, index: 0, rutReceptor: rut_receptor, client,
        });
        // Ajuste por factor eléctrico del país (Simple usa un factor base; escalamos
        // los ítems de energía según la metodología nacional).
        const factorPais = Number(met.factores?.electricidad_kgco2e_kwh) || 0.2421;
        const escala = factorPais / 0.2421; // base Chile
        items = analysis.items.map((it) => ({
          ...it,
          co2e: /el[eé]ctric|energ|kwh|sen/i.test(it.descripcion) ? round4(it.co2e * escala) : it.co2e,
        }));
        total = round4(items.reduce((a, it) => a + Number(it.co2e), 0));
        items = items.map((it) => ({ ...it, porcentaje_total: total > 0 ? round4((it.co2e / total) * 100) : 0 }));
        categoria = analysis.categoria;
        estado = 'procesado';
      } else if (soportado && !metActiva) {
        estado = 'pendiente_motor'; // tipo calculable, pero el país aún no está activo
      }

      const { rows: dRows } = await client.query(
        `INSERT INTO documentos_corredor
           (pais_origen, pais_destino, tramo, tipo_documento, rut_emisor, rut_receptor,
            archivo_original, metodologia_pais, estado, total_co2e, categoria, numero_documento)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [pais_origen || null, pais_destino || null, tramo || null, tipo, rut_emisor || null,
         rut_receptor || null, file.originalname, paisMet, estado, total, categoria,
         numero_documento || null]
      );
      const doc = dRows[0];
      for (const it of items) {
        await client.query(
          `INSERT INTO documento_items (documento_id, descripcion, cantidad, co2e, porcentaje_total)
           VALUES ($1,$2,$3,$4,$5)`,
          [doc.id, it.descripcion, it.cantidad, it.co2e, it.porcentaje_total]
        );
      }
      if (estado === 'procesado') {
        // Capital Natural: los documentos del corredor también cargan las
        // cuentas ambientales (sin FK a facturas: la traza queda en la glosa).
        const cuentasNaturales = await cargarCuentas((sql) => client.query(sql));
        await registrarMovimientos({
          client,
          factura: {
            id: null, categoria, total_co2e: total,
            numero_venta: `corredor ${paisMet}`, archivo_original: file.originalname,
            // Explícito, no por omisión: esta categoría la trae el MOTOR
            // EXTERNO (no el catch-all del motor propio), y ese adaptador
            // devuelve 'Sin categoría' cuando no sabe, en vez de una categoría
            // con factor físico. Vale el mismo trato que el histórico. El día
            // que este flujo pase al motor propio hay que traer acá el
            // `categoria_origen` real, o capitalNatural.js dejará de frenar lo
            // que no está clasificado.
            categoria_origen: null,
          },
          cuentas: cuentasNaturales,
        });
      }
      return doc;
    });

    await logActividad({ usuarioId: req.user.sub, accion: 'cargar_documento_corredor', entidad: 'documento_corredor', entidadId: result.id, detalle: { tipo, paisMet }, ip: req.ip });
    res.status(201).json({ documento: result });

    // Export al data warehouse (no bloqueante; apagado por defecto).
    bigquery.exportDocumentoCorredor(result);
  } catch (err) { next(err); }
});

// ============================================================
// PUNTOS DE CONTROL DEL CORREDOR (tabla puntos_corredor, migración 093)
// El catálogo que antes vivía hardcodeado: el admin agrega o corrige un
// punto acá y aparece en el mapa de la torre, el select del portador y
// los carteles QR sin deploy. Reglas duras:
//  - El id (slug) NO es editable y NO hay DELETE: los eslabones sellados
//    referencian datos.punto_id — un punto que sale de servicio se marca
//    activo=false y su id queda reservado para siempre.
//  - Toda escritura invalida el cache del catálogo (services/
//    catalogoCorredor.js) para que el propio proceso lo vea al tiro.
// ============================================================

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const PAISES_CORREDOR = ['BR', 'PY', 'AR', 'CL'];

function validarPunto(b, { esNuevo }) {
  const errores = [];
  const id = String(b.id || '').trim();
  if (esNuevo && !SLUG_RE.test(id)) errores.push('El id debe ser un slug (minúsculas, números y guiones, 3-40 caracteres).');
  const nombre = String(b.nombre || '').trim().slice(0, 120);
  if (!nombre) errores.push('Falta el nombre del punto.');
  const pais = String(b.pais || '').toUpperCase();
  if (!PAISES_CORREDOR.includes(pais)) errores.push(`El país debe ser uno de: ${PAISES_CORREDOR.join(', ')}.`);
  const lat = Number(b.lat); const lng = Number(b.lng);
  if (!Number.isFinite(lat) || lat < -60 || lat > 0) errores.push('Latitud fuera de rango para el corredor.');
  if (!Number.isFinite(lng) || lng < -80 || lng > -40) errores.push('Longitud fuera de rango para el corredor.');
  const orden = Number(b.orden);
  if (!Number.isInteger(orden) || orden < 0 || orden > 999) errores.push('El orden debe ser un entero entre 0 y 999.');
  return { ok: errores.length === 0, error: errores.join(' '), datos: { id, nombre, pais, lat, lng, orden, es_frontera: b.es_frontera === true } };
}

// Lista completa (incluidos inactivos — el admin necesita verlos para reactivar).
router.get('/puntos', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, nombre, pais, lat, lng, orden, es_frontera, activo, created_at
         FROM puntos_corredor ORDER BY orden`
    );
    res.json({ puntos: rows });
  } catch (err) { next(err); }
});

router.post('/puntos', adminOnly, async (req, res, next) => {
  try {
    const val = validarPunto(req.body || {}, { esNuevo: true });
    if (!val.ok) return res.status(400).json({ error: val.error });
    const d = val.datos;
    const { rows } = await query(
      `INSERT INTO puntos_corredor (id, nombre, pais, lat, lng, orden, es_frontera)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO NOTHING
       RETURNING *`,
      [d.id, d.nombre, d.pais, d.lat, d.lng, d.orden, d.es_frontera]
    );
    if (!rows[0]) return res.status(409).json({ error: `Ya existe un punto con el id '${d.id}' (puede estar inactivo).` });
    invalidarCacheCatalogo();
    await logActividad({
      usuarioId: req.user.sub, accion: 'punto_corredor_crear', entidad: 'punto_corredor',
      detalle: { id: d.id, nombre: d.nombre }, ip: req.ip,
    });
    res.status(201).json({ punto: rows[0] });
  } catch (err) { next(err); }
});

// Edita nombre/país/coordenadas/orden/frontera/activo — nunca el id.
router.put('/puntos/:id', adminOnly, async (req, res, next) => {
  try {
    const val = validarPunto({ ...req.body, id: req.params.id }, { esNuevo: false });
    if (!val.ok) return res.status(400).json({ error: val.error });
    const d = val.datos;
    const { rows } = await query(
      `UPDATE puntos_corredor
          SET nombre = $2, pais = $3, lat = $4, lng = $5, orden = $6,
              es_frontera = $7, activo = $8
        WHERE id = $1 RETURNING *`,
      [req.params.id, d.nombre, d.pais, d.lat, d.lng, d.orden, d.es_frontera, req.body.activo !== false]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Punto no encontrado' });
    invalidarCacheCatalogo();
    await logActividad({
      usuarioId: req.user.sub, accion: 'punto_corredor_editar', entidad: 'punto_corredor',
      detalle: { id: req.params.id, activo: rows[0].activo }, ip: req.ip,
    });
    res.json({ punto: rows[0] });
  } catch (err) { next(err); }
});

export default router;
