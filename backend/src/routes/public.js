import express from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { query, withTx } from '../lib/db.js';
import { simpleApi } from '../services/simpleApi.js';
import { generateReport, generateLabel } from '../services/pdf.js';
import { qrBuffer } from '../services/qr.js';
import { sendMail, reporteEmail } from '../services/mailer.js';

const router = express.Router();

// Almacenamiento en memoria; solo guardamos el nombre original (no el binario).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: config.maxFilesPerSession },
  fileFilter: (req, file, cb) => {
    const ok = /\.(pdf|xml|jpe?g|png)$/i.test(file.originalname);
    cb(ok ? null : new Error('Formato no permitido'), ok);
  },
});

// Carga completa de una tabla de ítems para una lista de facturas.
async function hydrateFacturas(sesionId) {
  const { rows: facturas } = await query(
    `SELECT * FROM facturas WHERE sesion_id = $1 ORDER BY created_at`,
    [sesionId]
  );
  for (const f of facturas) {
    const { rows: items } = await query(
      `SELECT descripcion, cantidad, co2e, porcentaje_total FROM line_items WHERE factura_id = $1`,
      [f.id]
    );
    f.items = items;
  }
  return facturas;
}

// Envuelve multer para devolver el mensaje amigable del límite duro de la demo.
function uploadArchivos(req, res, next) {
  upload.array('archivos', config.maxFilesPerSession)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ error: 'La demo permite hasta 5 facturas. Contáctanos para más.' });
      }
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Cada archivo debe pesar menos de 15 MB.' });
      }
      return res.status(400).json({ error: 'No se pudo procesar la carga de archivos.' });
    }
    if (err) return res.status(400).json({ error: err.message || 'Formato no permitido.' });
    next();
  });
}

// ---------- POST /api/sesiones — procesa hasta 5 facturas ----------
router.post('/sesiones', uploadArchivos, async (req, res, next) => {
  try {
    const { rut, empresa, email } = req.body;
    const files = req.files || [];

    if (!rut || !empresa || !email) {
      return res.status(400).json({ error: 'Faltan datos: RUT, empresa y email son obligatorios.' });
    }
    if (files.length === 0) {
      return res.status(400).json({ error: 'Debes subir al menos una factura.' });
    }
    // Límite duro de la demo.
    if (files.length > config.maxFilesPerSession) {
      return res.status(400).json({
        error: 'La demo permite hasta 5 facturas. Contáctanos para más.',
      });
    }

    const result = await withTx(async (client) => {
      const { rows: sRows } = await client.query(
        `INSERT INTO sesiones (rut_cliente, nombre_cliente, email_cliente)
         VALUES ($1,$2,$3) RETURNING *`,
        [rut, empresa, email]
      );
      const sesion = sRows[0];

      let totalSesion = 0;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const analysis = await simpleApi.analyzeInvoice({
          sesionId: sesion.id,
          filename: file.originalname,
          index: i,
          rutReceptor: rut,
          client,
        });
        totalSesion += Number(analysis.total_co2e || 0);

        const { rows: fRows } = await client.query(
          `INSERT INTO facturas
             (sesion_id, invoice_id_simple, numero_venta, archivo_original,
              rut_emisor, rut_receptor, total_co2e, categoria, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'procesada') RETURNING *`,
          [
            sesion.id,
            analysis.invoice_id_simple,
            analysis.numero_venta,
            file.originalname,
            analysis.rut_emisor,
            analysis.rut_receptor,
            analysis.total_co2e,
            analysis.categoria,
          ]
        );
        const factura = fRows[0];
        for (const it of analysis.items) {
          await client.query(
            `INSERT INTO line_items (factura_id, descripcion, cantidad, co2e, porcentaje_total)
             VALUES ($1,$2,$3,$4,$5)`,
            [factura.id, it.descripcion, it.cantidad, it.co2e, it.porcentaje_total]
          );
        }
      }

      await client.query(`UPDATE sesiones SET total_co2e = $1 WHERE id = $2`, [
        Math.round(totalSesion * 10000) / 10000,
        sesion.id,
      ]);
      sesion.total_co2e = Math.round(totalSesion * 10000) / 10000;
      return sesion;
    });

    const facturas = await hydrateFacturas(result.id);
    res.status(201).json({ sesion: result, facturas });

    // Envío del informe por correo (no bloqueante: nunca afecta la respuesta).
    (async () => {
      try {
        const pdf = await generateReport({ sesion: result, facturas });
        await sendMail({
          to: result.email_cliente,
          ...reporteEmail({ nombre: result.nombre_cliente, totalCo2e: result.total_co2e, nFacturas: facturas.length }),
          attachments: [{ filename: `sicr3p-informe-${result.id.slice(0, 8)}.pdf`, content: pdf }],
        });
      } catch (e) {
        console.warn('[correo] no se pudo enviar el informe:', e.message);
      }
    })();
  } catch (err) {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'La demo permite hasta 5 facturas. Contáctanos para más.' });
    }
    next(err);
  }
});

// ---------- GET /api/sesiones/:id — resultados ----------
router.get('/sesiones/:id', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM sesiones WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Sesión no encontrada' });
    const facturas = await hydrateFacturas(req.params.id);
    res.json({ sesion: rows[0], facturas });
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/sesiones/:id/informe.pdf ----------
router.get('/sesiones/:id/informe.pdf', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM sesiones WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Sesión no encontrada' });
    const facturas = await hydrateFacturas(req.params.id);
    const pdf = await generateReport({ sesion: rows[0], facturas });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="sicr3p-informe-${req.params.id.slice(0, 8)}.pdf"`);
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/facturas/:id/etiqueta.pdf ----------
router.get('/facturas/:id/etiqueta.pdf', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM facturas WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Factura no encontrada' });
    const factura = rows[0];
    const { rows: items } = await query(
      `SELECT descripcion, cantidad, co2e, porcentaje_total FROM line_items WHERE factura_id = $1`,
      [factura.id]
    );
    factura.items = items;
    const { rows: sRows } = await query(`SELECT * FROM sesiones WHERE id = $1`, [factura.sesion_id]);
    const pdf = await generateLabel({ sesion: sRows[0], factura });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="sicr3p-etiqueta-${factura.numero_venta || factura.id.slice(0, 8)}.pdf"`);
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/facturas/:id/qr.png — QR de verificación (para previsualizar) ----------
router.get('/facturas/:id/qr.png', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT id FROM facturas WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Factura no encontrada' });
    const png = await qrBuffer(req.params.id);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(png);
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/verificar/:id — verificación pública de trazabilidad ----------
router.get('/verificar/:id', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM facturas WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Documento no encontrado' });
    const factura = rows[0];
    const { rows: items } = await query(
      `SELECT descripcion, cantidad, co2e, porcentaje_total FROM line_items WHERE factura_id = $1`,
      [factura.id]
    );
    const { rows: sRows } = await query(
      `SELECT nombre_cliente, rut_cliente, fecha FROM sesiones WHERE id = $1`,
      [factura.sesion_id]
    );
    res.json({
      valido: true,
      factura: {
        id: factura.id,
        numero_venta: factura.numero_venta,
        categoria: factura.categoria,
        total_co2e: factura.total_co2e,
        status: factura.status,
        fecha: sRows[0]?.fecha,
      },
      cliente: {
        nombre: sRows[0]?.nombre_cliente,
        rut: sRows[0]?.rut_cliente,
      },
      items,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
