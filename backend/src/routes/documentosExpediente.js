import crypto from 'crypto';
import express from 'express';
import multer from 'multer';
import { query } from '../lib/db.js';
import { requireAuth, requireHomePanel, requireNivelOperador, logActividad } from '../middleware/auth.js';

// Centro documental del panel proveedor.
// La carpeta YA existe (`expedientes`). Este router solo conserva los
// archivos que la empresa entrega y permite que usuarios del mismo
// proveedor los revisen. Ningún archivo es público.
const router = express.Router();
router.use(requireAuth, requireHomePanel('proveedor'));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATEGORIAS = [
  'xml_combustible', 'reporte_gps', 'horometro', 'contrato',
  'calculo', 'ficha_activo', 'otro',
];
const DECISIONES = ['aprobar', 'observar', 'rechazar'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(xml|pdf|jpe?g|png)$/i.test(file.originalname || '');
    cb(ok ? null : new Error('Formato no permitido. Usa XML, PDF, JPG o PNG.'), ok);
  },
});

function texto(v, max = 300) {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
}

function mimeSeguro(row) {
  const ext = String(row.extension || '').toLowerCase();
  if (ext === 'xml') return 'application/xml; charset=utf-8';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  return row.mime_type || 'application/octet-stream';
}

async function expedientePropio(id, proveedorId) {
  if (!UUID_RE.test(String(id))) return null;
  const { rows } = await query(
    `SELECT id, cliente_nombre, orden_compra, periodo, glosa, estado
       FROM expedientes WHERE id = $1 AND proveedor_id = $2`,
    [id, proveedorId]
  );
  return rows[0] || null;
}

async function archivoPropio(id, proveedorId) {
  if (!UUID_RE.test(String(id))) return null;
  const { rows } = await query(
    `SELECT a.*, e.cliente_nombre, e.periodo
       FROM expediente_archivos a
       JOIN expedientes e ON e.id = a.expediente_id
      WHERE a.id = $1 AND e.proveedor_id = $2`,
    [id, proveedorId]
  );
  return rows[0] || null;
}

function estadoDe(v) {
  const aprobar = Number(v.aprobar || 0);
  const observar = Number(v.observar || 0);
  const rechazar = Number(v.rechazar || 0);
  const total = aprobar + observar + rechazar;
  if (!total) return 'pendiente';
  if (rechazar > 0) return 'rechazado';
  if (observar > 0) return 'con_observaciones';
  return 'aprobado';
}

// Lista TODO lo cargado por la empresa, con resumen para el panel.
router.get('/', async (req, res, next) => {
  try {
    const expedienteId = texto(req.query?.expediente_id, 36);
    if (expedienteId && !UUID_RE.test(expedienteId)) {
      return res.status(400).json({ error: 'Expediente no válido.' });
    }
    const params = [req.user.proveedor_id];
    let filtro = '';
    if (expedienteId) {
      params.push(expedienteId);
      filtro = ` AND a.expediente_id = $${params.length}`;
    }
    const { rows } = await query(
      `SELECT a.id, a.expediente_id, a.categoria, a.descripcion, a.archivo_original,
              a.mime_type, a.extension, a.tamano_bytes, a.sha256, a.version,
              a.subido_por, a.created_at,
              e.cliente_nombre, e.orden_compra, e.periodo,
              COUNT(v.id)::int AS votos_total,
              COUNT(v.id) FILTER (WHERE v.decision = 'aprobar')::int AS aprobar,
              COUNT(v.id) FILTER (WHERE v.decision = 'observar')::int AS observar,
              COUNT(v.id) FILTER (WHERE v.decision = 'rechazar')::int AS rechazar,
              MAX(v.updated_at) AS ultima_revision
         FROM expediente_archivos a
         JOIN expedientes e ON e.id = a.expediente_id
         LEFT JOIN expediente_archivo_votos v ON v.archivo_id = a.id
        WHERE e.proveedor_id = $1 ${filtro}
        GROUP BY a.id, e.id
        ORDER BY a.created_at DESC`,
      params
    );

    const documentos = rows.map((r) => ({ ...r, estado_revision: estadoDe(r) }));
    const revisados = documentos.filter((d) => d.votos_total > 0).length;
    const observados = documentos.filter((d) => d.estado_revision === 'con_observaciones').length;
    const rechazados = documentos.filter((d) => d.estado_revision === 'rechazado').length;
    res.json({
      documentos,
      resumen: {
        total: documentos.length,
        revisados,
        pendientes: documentos.length - revisados,
        con_observaciones: observados,
        rechazados,
        avance: documentos.length ? Math.round((revisados / documentos.length) * 100) : 0,
      },
      categorias: CATEGORIAS,
    });
  } catch (err) { next(err); }
});

// Sube un archivo a un expediente ya existente. Conserva bytes originales
// y SHA-256; no interpreta todavía el contenido ni cambia cálculos.
router.post('/:expedienteId', requireNivelOperador, upload.single('archivo'), async (req, res, next) => {
  try {
    const expediente = await expedientePropio(req.params.expedienteId, req.user.proveedor_id);
    if (!expediente) return res.status(404).json({ error: 'Expediente no encontrado.' });
    if (!req.file) return res.status(400).json({ error: 'Adjunta un archivo.' });

    const categoria = String(req.body?.categoria || 'otro');
    if (!CATEGORIAS.includes(categoria)) {
      return res.status(400).json({ error: `Categoría no válida. Usa: ${CATEGORIAS.join(', ')}.` });
    }
    const sha256 = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const ext = (req.file.originalname.match(/\.([^.]+)$/)?.[1] || '').toLowerCase();

    try {
      const { rows } = await query(
        `INSERT INTO expediente_archivos
           (expediente_id, categoria, descripcion, archivo_original, mime_type,
            extension, tamano_bytes, sha256, contenido, subido_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id, expediente_id, categoria, descripcion, archivo_original, mime_type,
                   extension, tamano_bytes, sha256, version, subido_por, created_at`,
        [req.params.expedienteId, categoria, texto(req.body?.descripcion),
          req.file.originalname.slice(0, 240), req.file.mimetype || 'application/octet-stream',
          ext, req.file.size, sha256, req.file.buffer, String(req.user.sub || '')]
      );
      await logActividad({
        usuarioId: req.user.sub, accion: 'expediente_archivo_subir', entidad: 'expediente',
        entidadId: req.params.expedienteId,
        detalle: { archivo_id: rows[0].id, categoria, sha256 }, ip: req.ip,
      });
      res.status(201).json({ documento: { ...rows[0], estado_revision: 'pendiente', votos_total: 0 } });
    } catch (err) {
      if (err?.code === '23505') {
        return res.status(409).json({ error: 'Ese mismo archivo ya fue cargado en este expediente.' });
      }
      throw err;
    }
  } catch (err) { next(err); }
});

// Vista privada. El QR público nunca apunta a este endpoint.
router.get('/:id/archivo', async (req, res, next) => {
  try {
    const a = await archivoPropio(req.params.id, req.user.proveedor_id);
    if (!a) return res.status(404).json({ error: 'Archivo no encontrado.' });
    res.setHeader('Content-Type', mimeSeguro(a));
    const limpio = String(a.archivo_original || 'archivo').replace(/["\\\r\n]/g, '_');
    res.setHeader('Content-Disposition', `inline; filename="${limpio}"`);
    res.setHeader('X-Content-SHA256', a.sha256);
    res.send(a.contenido);
  } catch (err) { next(err); }
});

// Cada usuario deja un voto/revisión. Un segundo voto del mismo usuario
// reemplaza el anterior y conserva la fecha de creación del registro.
router.put('/:id/voto', requireNivelOperador, async (req, res, next) => {
  try {
    const a = await archivoPropio(req.params.id, req.user.proveedor_id);
    if (!a) return res.status(404).json({ error: 'Archivo no encontrado.' });
    const decision = String(req.body?.decision || '');
    if (!DECISIONES.includes(decision)) {
      return res.status(400).json({ error: 'Decisión no válida. Usa aprobar, observar o rechazar.' });
    }
    const comentario = texto(req.body?.comentario, 1000);
    if ((decision === 'observar' || decision === 'rechazar') && !comentario) {
      return res.status(400).json({ error: 'Describe la observación antes de guardar.' });
    }
    await query(
      `INSERT INTO expediente_archivo_votos (archivo_id, usuario_id, decision, comentario)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (archivo_id, usuario_id) DO UPDATE SET
         decision = EXCLUDED.decision, comentario = EXCLUDED.comentario, updated_at = now()`,
      [a.id, String(req.user.sub || ''), decision, comentario]
    );
    await logActividad({
      usuarioId: req.user.sub, accion: 'expediente_archivo_votar', entidad: 'expediente_archivo',
      entidadId: a.id, detalle: { decision }, ip: req.ip,
    });
    const { rows } = await query(
      `SELECT COUNT(*)::int AS votos_total,
              COUNT(*) FILTER (WHERE decision='aprobar')::int AS aprobar,
              COUNT(*) FILTER (WHERE decision='observar')::int AS observar,
              COUNT(*) FILTER (WHERE decision='rechazar')::int AS rechazar,
              MAX(updated_at) AS ultima_revision
         FROM expediente_archivo_votos WHERE archivo_id = $1`,
      [a.id]
    );
    res.json({ ...rows[0], estado_revision: estadoDe(rows[0]) });
  } catch (err) { next(err); }
});

export default router;
