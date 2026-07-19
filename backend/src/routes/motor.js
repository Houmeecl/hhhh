import express from 'express';
import { query, withTx } from '../lib/db.js';
import { requireAuth, requireRole, logActividad } from '../middleware/auth.js';
import { calcularFactura, cargarCategorias } from '../services/motorPropio.js';
import { hashDocumento, hashCadena } from '../services/cadenaHash.js';

// ============================================================
// Motor propio de cálculo — administración de categorías
// (factores, palabras clave) y estadística de uso propio/externo.
// El cálculo en sí vive en services/motorPropio.js y se aplica
// automáticamente en routes/public.js al subir un DTE XML (motor
// 'propio'), un PDF con capa de texto ('propio_texto') o una imagen
// JPG/PNG con OCR local ('propio_ocr').
// ============================================================

const router = express.Router();
router.use(requireAuth);
const adminOnly = requireRole('admin', 'operador');

router.get('/categorias', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM motor_categorias ORDER BY codigo`);
    res.json({ categorias: rows });
  } catch (err) { next(err); }
});

router.put('/categorias/:codigo', adminOnly, async (req, res, next) => {
  try {
    const { nombre, unidad_fisica, factor_fisico_kgco2e, factor_gasto_kgco2e_clp1000, palabras_clave, fuente, activo, alcance_ghg } = req.body;
    const { rows } = await query(
      `UPDATE motor_categorias SET
         nombre = COALESCE($2,nombre),
         unidad_fisica = COALESCE($3,unidad_fisica),
         factor_fisico_kgco2e = COALESCE($4,factor_fisico_kgco2e),
         factor_gasto_kgco2e_clp1000 = COALESCE($5,factor_gasto_kgco2e_clp1000),
         palabras_clave = COALESCE($6,palabras_clave),
         fuente = COALESCE($7,fuente),
         activo = COALESCE($8,activo),
         alcance_ghg = COALESCE($9,alcance_ghg),
         updated_at = now()
       WHERE codigo = $1 RETURNING *`,
      [
        req.params.codigo,
        nombre,
        unidad_fisica,
        factor_fisico_kgco2e != null ? Number(factor_fisico_kgco2e) : null,
        factor_gasto_kgco2e_clp1000 != null ? Number(factor_gasto_kgco2e_clp1000) : null,
        Array.isArray(palabras_clave) ? palabras_clave : null,
        fuente,
        activo != null ? Boolean(activo) : null,
        alcance_ghg != null ? String(alcance_ghg) : null,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Categoría no encontrada' });
    await logActividad({ usuarioId: req.user.sub, accion: 'editar_categoria_motor', entidad: 'motor_categoria', entidadId: req.params.codigo, ip: req.ip });
    res.json({ categoria: rows[0] });
  } catch (err) { next(err); }
});

// ---------- Fuentes metodológicas (migración 018) ----------
// Registro citable de los documentos que avalan la METODOLOGÍA (IPCC,
// GHG Protocol, DEFRA, MMA, CEN, GLEC). Honestidad: avalan el método,
// no a sicr3p — nada aquí es un "certificado". Defensivo: si la tabla
// aún no existe (migración sin correr), la lista vuelve vacía en vez
// de romper el panel.
const ESTADOS_FUENTE = ['avalada_referencial', 'validada_oficial'];

router.get('/fuentes', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT f.*, COUNT(mc.codigo)::int AS n_categorias
       FROM fuentes_metodologicas f
       LEFT JOIN motor_categorias mc ON mc.fuente_metodologica_id = f.id
       GROUP BY f.id
       ORDER BY f.organismo, f.codigo`
    );
    res.json({ fuentes: rows });
  } catch (err) {
    if (err.code === '42P01') return res.json({ fuentes: [] }); // tabla aún no migrada
    next(err);
  }
});

// Edita lo administrable de una fuente: url, año/edición, notas y estado.
// 'validada_oficial' SOLO cuando el admin tiene descargada la edición
// vigente del documento; organismo/documento/código no se editan por API
// (son la identidad citable de la fuente).
router.put('/fuentes/:id', adminOnly, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(404).json({ error: 'Fuente no encontrada' });
    }
    const { url, version_anio, estado, notas } = req.body;
    if (estado != null && !ESTADOS_FUENTE.includes(estado)) {
      return res.status(400).json({ error: "El estado debe ser 'avalada_referencial' o 'validada_oficial'." });
    }
    const { rows } = await query(
      `UPDATE fuentes_metodologicas SET
         url = COALESCE($2,url),
         version_anio = COALESCE($3,version_anio),
         estado = COALESCE($4,estado),
         notas = COALESCE($5,notas)
       WHERE id = $1 RETURNING *`,
      [
        id,
        url != null ? String(url).trim() : null,
        version_anio != null ? String(version_anio).trim() : null,
        estado != null ? String(estado) : null,
        notas != null ? String(notas) : null,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Fuente no encontrada' });
    await logActividad({ usuarioId: req.user.sub, accion: 'editar_fuente_metodologica', entidad: 'fuente_metodologica', entidadId: String(id), ip: req.ip });
    res.json({ fuente: rows[0] });
  } catch (err) {
    if (err.code === '42P01') {
      return res.status(503).json({ error: 'El registro de fuentes metodológicas aún no está disponible.' });
    }
    next(err);
  }
});

// ---------- Cola de revisión humana (migración 019) ----------
// Documentos sin señal extraíble que, con MOTOR_EXTERNO=off, quedaron en
// revisión en vez de irse a un motor de terceros. El operador corrige los
// datos mirando el archivo original; el CÁLCULO lo hace siempre el motor
// propio en el servidor con esos datos — jamás se acepta un total_co2e
// tipeado a mano. Al confirmar, el documento recién ahí se encadena.

const MAX_ITEMS_REVISION = 100;
// facturas.id es UUID: validar el formato antes de tocar la BD.
const esUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));

router.get('/revision', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT f.id, f.sesion_id, f.archivo_original, f.numero_venta,
              f.rut_emisor, f.rut_receptor, f.created_at,
              r.mime, r.texto_extraido,
              s.rut_cliente AS rut_sesion
       FROM facturas f
       JOIN facturas_revision r ON r.factura_id = f.id
       LEFT JOIN sesiones s ON s.id = f.sesion_id
       WHERE f.motor = 'revision'
       ORDER BY f.created_at ASC`
    );
    res.json({ pendientes: rows });
  } catch (err) {
    if (err.code === '42P01') return res.json({ pendientes: [] }); // migración 019 sin correr
    next(err);
  }
});

// Descarga del archivo original para revisarlo (solo mientras esté en cola).
router.get('/revision/:facturaId/archivo', async (req, res, next) => {
  try {
    const id = req.params.facturaId;
    if (!esUuid(id)) return res.status(404).json({ error: 'Documento no encontrado' });
    const { rows } = await query(
      `SELECT r.archivo, r.mime, f.archivo_original
       FROM facturas_revision r JOIN facturas f ON f.id = r.factura_id
       WHERE r.factura_id = $1 AND f.motor = 'revision'`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Documento no encontrado' });
    res.setHeader('Content-Type', rows[0].mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${String(rows[0].archivo_original || 'documento').replace(/[^\w.\- ]/g, '_')}"`);
    res.send(rows[0].archivo);
  } catch (err) {
    if (err.code === '42P01') return res.status(404).json({ error: 'Documento no encontrado' });
    next(err);
  }
});

// Confirma la revisión: el operador entrega los datos corregidos (folio,
// RUTs e ítems con nombre/cantidad/unidad/monto). El servidor calcula con
// el motor propio, encadena el documento (con lock de cadena_estado, igual
// que el flujo público) y borra el archivo retenido. motor='propio_revisado'.
router.put('/revision/:facturaId', adminOnly, async (req, res, next) => {
  try {
    const id = req.params.facturaId;
    if (!esUuid(id)) return res.status(404).json({ error: 'Documento no encontrado' });

    const { folio, rut_emisor, rut_receptor, items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Debes entregar al menos un ítem corregido.' });
    }
    if (items.length > MAX_ITEMS_REVISION) {
      return res.status(400).json({ error: `Máximo ${MAX_ITEMS_REVISION} ítems por documento.` });
    }
    const itemsLimpios = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {};
      const nombre = String(it.nombre || it.descripcion || '').trim();
      const monto = Number(it.monto);
      if (!nombre) return res.status(400).json({ error: `Ítem ${i + 1}: falta la descripción.` });
      if (!Number.isFinite(monto) || monto <= 0) {
        return res.status(400).json({ error: `Ítem ${i + 1}: el monto debe ser un número mayor que 0.` });
      }
      const cantidad = it.cantidad != null && it.cantidad !== '' ? Number(it.cantidad) : null;
      if (cantidad != null && (!Number.isFinite(cantidad) || cantidad <= 0)) {
        return res.status(400).json({ error: `Ítem ${i + 1}: la cantidad debe ser mayor que 0.` });
      }
      itemsLimpios.push({
        nombre,
        descripcion: nombre,
        cantidad,
        unidad: it.unidad != null ? String(it.unidad).trim() : null,
        monto,
      });
    }

    const resultado = await withTx(async (client) => {
      // Solo documentos realmente en cola; FOR UPDATE evita doble confirmación.
      const { rows: fRows } = await client.query(
        `SELECT * FROM facturas WHERE id = $1 AND motor = 'revision' FOR UPDATE`,
        [id]
      );
      if (!fRows[0]) return { error: 404 };
      const facturaPrevia = fRows[0];

      const categorias = await cargarCategorias((sql) => client.query(sql));
      const calc = calcularFactura(itemsLimpios, categorias);

      const numeroVenta = folio ? `F-${String(folio).replace(/^F-?/i, '')}` : facturaPrevia.numero_venta;
      const rutEmisor = rut_emisor != null && rut_emisor !== '' ? String(rut_emisor).trim() : facturaPrevia.rut_emisor;
      const rutReceptor = rut_receptor != null && rut_receptor !== '' ? String(rut_receptor).trim() : facturaPrevia.rut_receptor;

      // Encadenar AHORA, con los datos definitivos (mismo lock del flujo público).
      const { rows: cadRows } = await client.query(
        `SELECT ultimo_hash, n_eslabones FROM cadena_estado WHERE id = 1 FOR UPDATE`
      );
      const hashAnterior = cadRows[0].ultimo_hash;
      const eslabon = Number(cadRows[0].n_eslabones) + 1;
      const hDoc = hashDocumento({
        numero_venta: numeroVenta,
        rut_emisor: rutEmisor,
        rut_receptor: rutReceptor,
        total_co2e: calc.total_co2e,
        categoria: calc.categoria,
        archivo_original: facturaPrevia.archivo_original,
      });
      const hCad = hashCadena(hashAnterior, hDoc);

      const { rows: updRows } = await client.query(
        `UPDATE facturas SET
           numero_venta = $2, rut_emisor = $3, rut_receptor = $4,
           total_co2e = $5, categoria = $6, status = 'procesada',
           motor = 'propio_revisado',
           hash_documento = $7, hash_anterior = $8, hash_cadena = $9, eslabon = $10
         WHERE id = $1 RETURNING *`,
        [id, numeroVenta, rutEmisor, rutReceptor, calc.total_co2e, calc.categoria, hDoc, hashAnterior, hCad, eslabon]
      );
      for (const it of calc.items) {
        await client.query(
          `INSERT INTO line_items (factura_id, descripcion, cantidad, co2e, porcentaje_total)
           VALUES ($1,$2,$3,$4,$5)`,
          [id, it.descripcion, it.cantidad, it.co2e, it.porcentaje_total]
        );
      }
      await client.query(
        `UPDATE cadena_estado SET ultimo_hash = $1, n_eslabones = $2, updated_at = now() WHERE id = 1`,
        [hCad, eslabon]
      );
      // El total de la sesión vuelve a cuadrar con sus documentos.
      await client.query(
        `UPDATE sesiones s SET total_co2e = (
           SELECT COALESCE(ROUND(SUM(f.total_co2e)::numeric, 4), 0) FROM facturas f WHERE f.sesion_id = s.id
         ) WHERE s.id = $1`,
        [facturaPrevia.sesion_id]
      );
      // El archivo retenido se borra: no se guarda más allá de lo necesario.
      await client.query(`DELETE FROM facturas_revision WHERE factura_id = $1`, [id]);
      return { factura: updRows[0] };
    });

    if (resultado.error === 404) return res.status(404).json({ error: 'Documento no encontrado o ya revisado' });
    await logActividad({ usuarioId: req.user.sub, accion: 'confirmar_revision_motor', entidad: 'factura', entidadId: String(id), ip: req.ip });
    res.json({ factura: resultado.factura });
  } catch (err) {
    if (err.code === '42P01') {
      return res.status(503).json({ error: 'La cola de revisión aún no está disponible (falta aplicar migraciones).' });
    }
    next(err);
  }
});

router.get('/estadisticas', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT motor, COUNT(*)::int AS n FROM facturas GROUP BY motor`
    );
    const total = rows.reduce((a, r) => a + r.n, 0);
    const n = (motor) => rows.find((r) => r.motor === motor)?.n || 0;
    const propio = n('propio');
    const propio_texto = n('propio_texto');
    const propio_ocr = n('propio_ocr');
    const propio_revisado = n('propio_revisado');
    const revision = n('revision');
    const externo = n('externo');
    // "Propio" para el % de independencia = XML + texto de PDF + OCR +
    // revisión humana confirmada. Lo aún EN revisión no cuenta para nadie.
    const propioTotal = propio + propio_texto + propio_ocr + propio_revisado;
    res.json({
      total,
      propio,
      propio_texto,
      propio_ocr,
      propio_revisado,
      revision,
      externo,
      motor_externo_activo: String(process.env.MOTOR_EXTERNO || 'on').toLowerCase() !== 'off',
      porcentaje_propio: total > 0 ? Math.round((propioTotal / total) * 1000) / 10 : 0,
    });
  } catch (err) { next(err); }
});

export default router;
