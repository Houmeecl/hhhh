import express from 'express';
import multer from 'multer';
import { query } from '../lib/db.js';
import { requireAuth, logActividad } from '../middleware/auth.js';
import { generateReport } from '../services/pdf.js';
import { parseDte } from '../services/dte.js';

// ============================================================
// Etapa 2 — Informes mensuales por cliente, cadena
// comprador-vendedor y verificador local de DTE.
// ============================================================

const router = express.Router();
router.use(requireAuth);

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const rutNorm = (r) => String(r || '').replace(/[^0-9kK]/g, '').toUpperCase();

// Facturas (con ítems) de un cliente en un mes calendario.
async function facturasDelMes(rut, anio, mes) {
  const { rows: facturas } = await query(
    `SELECT f.*, s.fecha AS fecha, s.nombre_cliente, s.rut_cliente
     FROM facturas f JOIN sesiones s ON s.id = f.sesion_id
     WHERE regexp_replace(s.rut_cliente, '[^0-9kK]', '', 'g') ILIKE $1
       AND EXTRACT(YEAR FROM f.created_at) = $2
       AND EXTRACT(MONTH FROM f.created_at) = $3
     ORDER BY f.created_at`,
    [rutNorm(rut), anio, mes]
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

// ---------- GET /mensual?rut=&anio=&mes= ----------
router.get('/mensual', async (req, res, next) => {
  try {
    const { rut } = req.query;
    const anio = Number(req.query.anio) || new Date().getFullYear();
    const mes = Number(req.query.mes) || new Date().getMonth() + 1;
    if (!rut) return res.status(400).json({ error: 'Indica el RUT del cliente.' });
    const facturas = await facturasDelMes(rut, anio, mes);
    const total = facturas.reduce((a, f) => a + Number(f.total_co2e || 0), 0);
    const porCategoria = {};
    for (const f of facturas) {
      const c = f.categoria || 'Sin categoría';
      porCategoria[c] = (porCategoria[c] || 0) + Number(f.total_co2e || 0);
    }
    res.json({
      periodo: { anio, mes, nombre: `${MESES[mes - 1]} ${anio}` },
      n_facturas: facturas.length,
      total_co2e: Math.round(total * 10000) / 10000,
      por_categoria: porCategoria,
      facturas: facturas.map((f) => ({
        id: f.id, numero_venta: f.numero_venta, archivo_original: f.archivo_original,
        categoria: f.categoria, total_co2e: f.total_co2e, fecha: f.created_at,
        rut_emisor: f.rut_emisor, empresa: f.nombre_cliente,
      })),
    });
  } catch (err) { next(err); }
});

// ---------- GET /mensual.pdf?rut=&anio=&mes= ----------
router.get('/mensual.pdf', async (req, res, next) => {
  try {
    const { rut } = req.query;
    const anio = Number(req.query.anio) || new Date().getFullYear();
    const mes = Number(req.query.mes) || new Date().getMonth() + 1;
    if (!rut) return res.status(400).json({ error: 'Indica el RUT del cliente.' });
    const facturas = await facturasDelMes(rut, anio, mes);
    if (!facturas.length) return res.status(404).json({ error: 'Sin facturas del cliente en ese mes.' });

    // Sesión sintética que representa el período mensual.
    const sesion = {
      id: `${anio}${String(mes).padStart(2, '0')}${rutNorm(rut)}`,
      nombre_cliente: facturas[0].nombre_cliente,
      rut_cliente: facturas[0].rut_cliente,
      fecha: new Date(anio, mes - 1, 1),
      total_co2e: facturas.reduce((a, f) => a + Number(f.total_co2e || 0), 0),
      periodo_texto: `${MESES[mes - 1]} ${anio}`,
    };
    // Cada fila del libro usa la fecha real de la factura.
    for (const f of facturas) f.fecha = f.created_at;

    const pdf = await generateReport({ sesion, facturas });
    await logActividad({ usuarioId: req.user.sub, accion: 'informe_mensual', entidad: 'informe', entidadId: `${rutNorm(rut)}-${anio}-${mes}`, ip: req.ip });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="sicr3p-mensual-${anio}-${String(mes).padStart(2, '0')}.pdf"`);
    res.send(pdf);
  } catch (err) { next(err); }
});

// ---------- GET /cadena?rut= — cadena comprador-vendedor ----------
// Usa rut_emisor / rut_receptor guardados desde la Etapa 1.
router.get('/cadena', async (req, res, next) => {
  try {
    const { rut } = req.query;
    if (!rut) return res.status(400).json({ error: 'Indica un RUT para trazar su cadena.' });
    const rn = rutNorm(rut);

    // Como comprador: proveedores que le emiten documentos.
    const { rows: proveedores } = await query(
      `SELECT f.rut_emisor AS rut, COUNT(*)::int AS n_documentos,
              SUM(f.total_co2e)::float AS total_co2e,
              MAX(f.created_at) AS ultimo_documento,
              array_agg(DISTINCT f.categoria) AS categorias
       FROM facturas f
       WHERE regexp_replace(COALESCE(f.rut_receptor,''), '[^0-9kK]', '', 'g') ILIKE $1
         AND f.rut_emisor IS NOT NULL
       GROUP BY f.rut_emisor ORDER BY total_co2e DESC NULLS LAST LIMIT 100`,
      [rn]
    );
    // Como vendedor: compradores que reciben sus documentos.
    const { rows: compradores } = await query(
      `SELECT f.rut_receptor AS rut, COUNT(*)::int AS n_documentos,
              SUM(f.total_co2e)::float AS total_co2e,
              MAX(f.created_at) AS ultimo_documento,
              array_agg(DISTINCT f.categoria) AS categorias
       FROM facturas f
       WHERE regexp_replace(COALESCE(f.rut_emisor,''), '[^0-9kK]', '', 'g') ILIKE $1
         AND f.rut_receptor IS NOT NULL
       GROUP BY f.rut_receptor ORDER BY total_co2e DESC NULLS LAST LIMIT 100`,
      [rn]
    );
    const totalComprado = proveedores.reduce((a, p) => a + Number(p.total_co2e || 0), 0);
    const totalVendido = compradores.reduce((a, c) => a + Number(c.total_co2e || 0), 0);
    res.json({
      rut,
      resumen: {
        n_proveedores: proveedores.length,
        n_compradores: compradores.length,
        co2e_comprado: Math.round(totalComprado * 10000) / 10000,
        co2e_vendido: Math.round(totalVendido * 10000) / 10000,
      },
      proveedores, compradores,
    });
  } catch (err) { next(err); }
});

// ---------- POST /dte/verificar — verificador local de DTE XML ----------
const uploadXml = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = /\.xml$/i.test(file.originalname);
    cb(ok ? null : new Error('Sube un archivo XML de DTE'), ok);
  },
});

router.post('/dte/verificar', uploadXml.single('archivo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Adjunta el XML del DTE.' });
    const dte = parseDte(req.file.buffer.toString('utf8'));
    if (!dte) return res.status(422).json({ error: 'El archivo no parece un DTE válido (falta <DTE> o <Documento>).' });
    await logActividad({ usuarioId: req.user.sub, accion: 'verificar_dte', entidad: 'dte', entidadId: dte.folio || 's/f', ip: req.ip });
    res.json({ dte });
  } catch (err) { next(err); }
});

export default router;
