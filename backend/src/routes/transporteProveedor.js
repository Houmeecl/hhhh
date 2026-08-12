import express from 'express';
import crypto from 'crypto';
import multer from 'multer';
import { query } from '../lib/db.js';
import { requireAuth, requireHomePanel, requireNivelOperador, logActividad } from '../middleware/auth.js';
import { calcularCo2eViaje, resumenTransporte, validarViaje } from '../services/transporte.js';
import { generateInformeTransporte } from '../services/pdf.js';
import { generateComprobanteTransporte } from '../services/transportePdf.js';
import { sendMail, comprobanteTransporteEmail } from '../services/mailer.js';

// ============================================================
// Transporte de personal (GHG Protocol Categoría 7) desde el panel del
// proveedor — mismo cálculo y mismos modos/factores que ya usa el admin
// en routes/transporte.js (calcularCo2eViaje, transporte_modos), acá
// SOLO scopeado a la empresa dueña de la sesión (proveedor_id) y con
// evidencia OPCIONAL adjunta (a diferencia de Ley REP, donde la factura
// es obligatoria: acá el dato central es el km declarado, no el
// documento — ver migración 090).
// ============================================================

const router = express.Router();
router.use(requireAuth, requireHomePanel('proveedor'));

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

// Evidencia opcional (peaje, boleta de pasaje, etc.) — mismos formatos
// que Ley REP y la carga pública.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(pdf|xml|jpe?g|png|heic)$/i.test(file.originalname);
    cb(ok ? null : new Error('Formato no permitido: usa PDF, XML, JPG, PNG o HEIC.'), ok);
  },
});

// Igual que uploadArchivo en repProveedor.js, pero el archivo es opcional:
// sin `archivo` en el multipart, upload.single() no falla, solo deja
// req.file undefined.
function uploadEvidencia(req, res, next) {
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERIODO_RE = /^\d{4}-\d{2}$/;

const CAMPOS_VIAJE = `v.id, v.fecha, v.modo, v.origen, v.destino, v.km, v.pasajeros, v.ida_vuelta,
                       v.co2e, v.notas, v.archivo_nombre, v.created_at, m.nombre AS modo_nombre`;

// ---------- GET /modos — catálogo de modos, mismos que usa el admin ----------
router.get('/modos', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM transporte_modos ORDER BY array_position(ARRAY['bus','camioneta','auto','tren','avion'], codigo)`
    );
    res.json({ modos: rows });
  } catch (err) { next(err); }
});

// ---------- GET /viajes — viajes propios + resumen por modo/período ----------
router.get('/viajes', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT ${CAMPOS_VIAJE} FROM transporte_viajes v
       JOIN transporte_modos m ON m.codigo = v.modo
       WHERE v.proveedor_id = $1
       ORDER BY v.fecha DESC, v.created_at DESC LIMIT 500`,
      [req.user.proveedor_id]
    );
    res.json({ viajes: rows, resumen: resumenTransporte(rows) });
  } catch (err) { next(err); }
});

// ---------- POST /viajes — registrar un traslado propio ----------
// multipart: archivo (opcional) + modo/fecha/origen/destino/km/pasajeros/ida_vuelta/notas.
router.post('/viajes', requireNivelOperador, uploadEvidencia, async (req, res, next) => {
  try {
    // Validación autoritativa en el servidor (validarViaje, con tests):
    // km > 0 y con tope de cordura, pasajeros entero positivo acotado,
    // fecha no futura, origen/destino con largo máximo. El frontend
    // restringe los inputs pero esto es lo que de verdad protege el
    // inventario — un typo acá se sella como cargo en Capital Natural.
    const v = validarViaje(req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    const { modo, fecha, origen, destino, km, pasajeros: pax, ida_vuelta: idaVuelta, notas } = v.datos;

    const { rows: mRows } = await query(`SELECT * FROM transporte_modos WHERE codigo = $1`, [modo]);
    if (!mRows[0]) return res.status(400).json({ error: 'Modo de transporte desconocido.' });

    const co2e = calcularCo2eViaje({ km, pasajeros: pax, ida_vuelta: idaVuelta, factor_kgco2e_pkm: mRows[0].factor_kgco2e_pkm });

    const ext = req.file ? (req.file.originalname.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase() : null;
    const { rows } = await query(
      `INSERT INTO transporte_viajes
         (proveedor_id, fecha, modo, origen, destino, km, pasajeros, ida_vuelta, co2e, notas,
          archivo, archivo_nombre, extension, tamano_bytes, sha256)
       VALUES ($1,COALESCE($2::date,CURRENT_DATE),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING id, fecha, modo, origen, destino, km, pasajeros, ida_vuelta, co2e, notas, archivo_nombre, created_at`,
      [
        req.user.proveedor_id, fecha, modo, origen, destino, km, pax, idaVuelta, co2e, notas,
        req.file ? req.file.buffer : null,
        req.file ? req.file.originalname.slice(0, 200) : null,
        ext,
        req.file ? req.file.size : null,
        req.file ? sha256(req.file.buffer) : null,
      ]
    );

    // Capital Natural: el traslado carga la cuenta de carbono, mismo
    // criterio que el registro del admin (routes/transporte.js).
    const { rows: cn } = await query(`SELECT activo FROM cuentas_naturales WHERE codigo = 'CO2E'`);
    if (cn[0]?.activo) {
      await query(
        `INSERT INTO movimientos_naturales (cuenta_codigo, fecha, glosa, cantidad, unidad, tipo, origen)
         VALUES ('CO2E', COALESCE($1::date,CURRENT_DATE), $2, $3, 'tCO2e', 'cargo', 'manual')`,
        // '->' y no '→': la glosa termina impresa en el balance de Capital
        // Natural (services/pdf.js, fuente Courier/WinAnsi sin ese glifo).
        [fecha, `Transporte personal — ${origen} -> ${destino}`, co2e]
      );
    }

    await logActividad({
      usuarioId: req.user.sub, accion: 'proveedor_viaje_registrar', entidad: 'transporte_viaje',
      entidadId: rows[0].id, detalle: { modo, km, co2e }, ip: req.ip,
    });

    // Enviar email con comprobante (best effort — no bloquea si falla).
    setImmediate(async () => {
      try {
        const { rows: provRows } = await query(
          `SELECT nombre_empresa, rut, contacto_email FROM proveedores WHERE id = $1`,
          [req.user.proveedor_id]
        );
        const prov = provRows[0];
        if (!prov?.contacto_email) {
          console.log('[transporte] sin correo de contacto para enviar comprobante');
          return;
        }
        const pdf = await generateComprobanteTransporte({
          viaje: rows[0],
          empresa: prov,
          modoNombre: mRows[0].nombre,
        });
        await sendMail({
          to: prov.contacto_email,
          subject: `Comprobante de transporte — ${prov.nombre_empresa}`,
          html: comprobanteTransporteEmail({
            empresa: prov.nombre_empresa,
            viaje: rows[0],
            modoNombre: mRows[0].nombre,
            co2e: rows[0].co2e,
          }).html,
          attachments: [{ filename: `comprobante-transporte-${rows[0].id}.pdf`, content: pdf }],
          area: 'Proveedor',
        });
      } catch (err) {
        console.error('[transporte] error enviando comprobante por email:', err.message);
      }
    });

    res.status(201).json({ viaje: { ...rows[0], modo_nombre: mRows[0].nombre } });
  } catch (err) { next(err); }
});

// ---------- DELETE /viajes/:id — eliminar un traslado propio ----------
router.delete('/viajes/:id', requireNivelOperador, async (req, res, next) => {
  try {
    if (!UUID_RE.test(String(req.params.id))) return res.status(404).json({ error: 'Viaje no encontrado.' });
    const { rowCount } = await query(
      `DELETE FROM transporte_viajes WHERE id = $1 AND proveedor_id = $2`,
      [req.params.id, req.user.proveedor_id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Viaje no encontrado.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------- GET /viajes/:id/archivo — descargar la evidencia propia ----------
const MIME = {
  pdf: 'application/pdf', xml: 'application/xml', jpg: 'image/jpeg',
  jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic',
};
router.get('/viajes/:id/archivo', async (req, res, next) => {
  try {
    if (!UUID_RE.test(String(req.params.id))) return res.status(404).json({ error: 'Viaje no encontrado.' });
    const { rows } = await query(
      `SELECT archivo, archivo_nombre, extension FROM transporte_viajes
        WHERE id = $1 AND proveedor_id = $2`,
      [req.params.id, req.user.proveedor_id]
    );
    if (!rows[0] || !rows[0].archivo) return res.status(404).json({ error: 'Este viaje no tiene evidencia adjunta.' });
    res.setHeader('Content-Type', MIME[rows[0].extension] || 'application/octet-stream');
    const nombreSeguro = (rows[0].archivo_nombre || 'evidencia').replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreSeguro}"`);
    res.send(rows[0].archivo);
  } catch (err) { next(err); }
});

// ---------- GET /informe/:periodo.pdf — informe consolidado del mes ----------
router.get('/informe/:periodo.pdf', async (req, res, next) => {
  try {
    const periodo = req.params.periodo;
    if (!PERIODO_RE.test(periodo)) return res.status(400).json({ error: 'Período inválido — usa AAAA-MM.' });
    const { rows: prov } = await query(`SELECT nombre_empresa, rut FROM proveedores WHERE id = $1`, [req.user.proveedor_id]);
    const { rows: viajes } = await query(
      `SELECT ${CAMPOS_VIAJE} FROM transporte_viajes v
       JOIN transporte_modos m ON m.codigo = v.modo
       WHERE v.proveedor_id = $1 AND to_char(v.fecha, 'YYYY-MM') = $2
       ORDER BY v.fecha`,
      [req.user.proveedor_id, periodo]
    );
    const pdf = await generateInformeTransporte({
      empresa: prov[0] || {}, periodo, viajes, resumen: resumenTransporte(viajes),
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="sicr3p-transporte-${periodo}.pdf"`);
    res.send(pdf);
  } catch (err) { next(err); }
});

export default router;
