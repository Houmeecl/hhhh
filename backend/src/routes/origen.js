import express from 'express';
import { query, withTx } from '../lib/db.js';
import { requireAuth, requireRole, logActividad } from '../middleware/auth.js';
import { verificarCadenaCompleta } from '../services/cadenaHash.js';
import {
  ROLES,
  hashEslabonLote,
  generarNonce,
  validarEslabon,
  balanceMasas,
  filtrarPorVisibilidad,
  codigoDeclaracionValido,
  emisionesIncorporadasPorTonelada,
  resumenNormativo,
  validarNc,
  generarCodigoLote,
  hashCadena,
} from '../services/pasaporteOrigen.js';

// ============================================================
// Pasaporte de Origen — administración de lotes minerales y su
// cadena de custodia (migración 021). Montado en /api/admin/origen.
//
// Reglas duras:
//  - Los eslabones son APPEND-ONLY: no hay UPDATE ni DELETE (romperían
//    el hash). Un error se corrige con un eslabón nuevo que declare
//    datos.corrige_eslabon = N.
//  - El append serializa con SELECT ... FOR UPDATE sobre la fila del
//    lote (mismo patrón que cadena_estado en public.js).
//  - Toda validación ocurre en el servidor (services/pasaporteOrigen.js).
// ============================================================

const router = express.Router();
router.use(requireAuth);
const adminOnly = requireRole('admin', 'operador');

const NORM_SQL = `regexp_replace(COALESCE($1,''), '[^0-9kK]', '', 'g')`;
const MATERIALES = ['cobre_catodo', 'concentrado_cobre', 'litio_carbonato', 'oro', 'otro'];

// ---------- GET /lotes — lista con filtros ----------
router.get('/lotes', async (req, res, next) => {
  try {
    const { material, estado, rut } = req.query;
    const cond = [];
    const params = [];
    if (material && MATERIALES.includes(material)) { params.push(material); cond.push(`material = $${params.length}`); }
    if (estado && ['abierto', 'cerrado'].includes(estado)) { params.push(estado); cond.push(`estado = $${params.length}`); }
    if (rut) {
      params.push(String(rut));
      cond.push(`regexp_replace(COALESCE(rut_titular,''), '[^0-9kK]', '', 'g') = regexp_replace($${params.length}, '[^0-9kK]', '', 'g')`);
    }
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
    const { rows } = await query(
      `SELECT id, codigo, material, cantidad, unidad, pais_origen, faena_origen,
              rut_titular, estado, n_eslabones, ultimo_hash, created_at, updated_at
       FROM lotes_minerales ${where}
       ORDER BY created_at DESC LIMIT 200`,
      params
    );
    res.json({ lotes: rows });
  } catch (err) { next(err); }
});

// ---------- POST /lotes — crear lote ----------
router.post('/lotes', adminOnly, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!MATERIALES.includes(b.material)) {
      return res.status(400).json({ error: `Material inválido. Uno de: ${MATERIALES.join(', ')}.` });
    }
    const cantidad = Number(b.cantidad);
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      return res.status(400).json({ error: 'Cantidad debe ser un número mayor que 0.' });
    }
    if (!['t', 'kg'].includes(b.unidad || 't')) return res.status(400).json({ error: 'Unidad inválida (t | kg).' });
    if (b.codigo_nc && !validarNc(b.codigo_nc)) {
      return res.status(400).json({ error: 'Código NC inválido: 4, 6 u 8 dígitos.' });
    }
    const pais = String(b.pais_origen || 'CL').toUpperCase();
    if (!/^[A-Z]{2}$/.test(pais)) return res.status(400).json({ error: 'País de origen debe ser ISO-2.' });

    const lote = await withTx(async (client) => {
      const anio = new Date().getFullYear();
      const { rows: cRows } = await client.query(
        `SELECT count(*)::int + 1 AS n FROM lotes_minerales WHERE codigo LIKE $1`,
        [`LM-${anio}-%`]
      );
      const codigo = generarCodigoLote(anio, cRows[0].n);
      const { rows } = await client.query(
        `INSERT INTO lotes_minerales
           (codigo, material, descripcion, codigo_nc, cantidad, unidad, pais_origen,
            faena_origen, rut_titular, composicion, estandar_externo, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING *`,
        [
          codigo, b.material, b.descripcion || null, b.codigo_nc || null, cantidad,
          b.unidad || 't', pais, b.faena_origen || null, b.rut_titular || null,
          JSON.stringify(b.composicion || {}), JSON.stringify(b.estandar_externo || {}),
          req.user.sub,
        ]
      );
      return rows[0];
    });

    await logActividad({
      usuarioId: req.user.sub, accion: 'crear_lote_origen', entidad: 'lote_mineral',
      entidadId: lote.id, detalle: { codigo: lote.codigo, material: lote.material }, ip: req.ip,
    });
    res.status(201).json({ lote });
  } catch (err) { next(err); }
});

// ---------- GET /lotes/:id — detalle completo (nivel privado) ----------
router.get('/lotes/:id', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM lotes_minerales WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Lote no encontrado' });
    const lote = rows[0];
    const [{ rows: eslabones }, { rows: declaraciones }] = await Promise.all([
      query(`SELECT * FROM lote_eslabones WHERE lote_id = $1 ORDER BY eslabon`, [lote.id]),
      query(`SELECT codigo, estado, detalle, evidencia_url, updated_at FROM lote_declaraciones WHERE lote_id = $1`, [lote.id]),
    ]);
    res.json({
      lote,
      eslabones: filtrarPorVisibilidad(eslabones, 'privado'),
      declaraciones,
      balance: balanceMasas(lote, eslabones),
      emisiones: emisionesIncorporadasPorTonelada(lote, eslabones),
      normativo: resumenNormativo(lote, declaraciones),
      integridad: verificarCadenaCompleta(eslabones),
    });
  } catch (err) { next(err); }
});

// ---------- PATCH /lotes/:id — editar campos del LOTE (nunca eslabones) ----------
router.patch('/lotes/:id', adminOnly, async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM lotes_minerales WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Lote no encontrado' });
    if (rows[0].estado !== 'abierto') return res.status(409).json({ error: 'El lote está cerrado: no se edita.' });

    const b = req.body || {};
    if (b.codigo_nc !== undefined && b.codigo_nc !== null && b.codigo_nc !== '' && !validarNc(b.codigo_nc)) {
      return res.status(400).json({ error: 'Código NC inválido: 4, 6 u 8 dígitos.' });
    }
    for (const campo of ['emisiones_directas_tco2e_t', 'emisiones_indirectas_tco2e_t']) {
      if (b[campo] != null && (!Number.isFinite(Number(b[campo])) || Number(b[campo]) < 0)) {
        return res.status(400).json({ error: `${campo} debe ser un número ≥ 0.` });
      }
    }
    if (b.metodo_emisiones != null && !['valores_reales', 'valores_defecto', 'mixto'].includes(b.metodo_emisiones)) {
      return res.status(400).json({ error: 'metodo_emisiones inválido.' });
    }

    const { rows: uRows } = await query(
      `UPDATE lotes_minerales SET
         descripcion   = COALESCE($2, descripcion),
         codigo_nc     = CASE WHEN $3::text IS NOT NULL THEN NULLIF($3,'') ELSE codigo_nc END,
         faena_origen  = COALESCE($4, faena_origen),
         rut_titular   = COALESCE($5, rut_titular),
         composicion   = COALESCE($6::jsonb, composicion),
         estandar_externo = COALESCE($7::jsonb, estandar_externo),
         emisiones_directas_tco2e_t   = COALESCE($8, emisiones_directas_tco2e_t),
         emisiones_indirectas_tco2e_t = COALESCE($9, emisiones_indirectas_tco2e_t),
         metodo_emisiones = COALESCE($10, metodo_emisiones),
         fuente_metodologica_id = COALESCE($11, fuente_metodologica_id),
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [
        req.params.id, b.descripcion ?? null, b.codigo_nc ?? null, b.faena_origen ?? null,
        b.rut_titular ?? null,
        b.composicion !== undefined ? JSON.stringify(b.composicion) : null,
        b.estandar_externo !== undefined ? JSON.stringify(b.estandar_externo) : null,
        b.emisiones_directas_tco2e_t ?? null, b.emisiones_indirectas_tco2e_t ?? null,
        b.metodo_emisiones ?? null, b.fuente_metodologica_id ?? null,
      ]
    );
    await logActividad({
      usuarioId: req.user.sub, accion: 'editar_lote_origen', entidad: 'lote_mineral',
      entidadId: req.params.id, detalle: { campos: Object.keys(b) }, ip: req.ip,
    });
    res.json({ lote: uRows[0] });
  } catch (err) { next(err); }
});

// ---------- POST /lotes/:id/eslabones — anexar eslabón (append-only) ----------
router.post('/lotes/:id/eslabones', adminOnly, async (req, res, next) => {
  try {
    const b = req.body || {};
    const resultado = await withTx(async (client) => {
      // Lock de la fila del lote: serializa appends concurrentes al MISMO
      // lote sin bloquear los demás (a diferencia de la cadena global).
      const { rows: lRows } = await client.query(
        `SELECT * FROM lotes_minerales WHERE id = $1 FOR UPDATE`, [req.params.id]
      );
      const lote = lRows[0];
      if (!lote) return { status: 404, body: { error: 'Lote no encontrado' } };

      const { rows: prevRows } = await client.query(
        `SELECT eslabon, rol FROM lote_eslabones WHERE lote_id = $1 ORDER BY eslabon`, [lote.id]
      );
      const val = validarEslabon(b, lote, prevRows);
      if (!val.ok) return { status: 400, body: { error: val.errores.join(' ') } };

      // Vínculo opcional al DTE real: existe, y su RUT debiera coincidir.
      let facturaNumero = null;
      const advertencias = [...val.advertencias];
      if (b.factura_id) {
        const { rows: fRows } = await client.query(
          `SELECT id, numero_venta, rut_emisor, rut_receptor FROM facturas WHERE id = $1`, [b.factura_id]
        );
        if (!fRows[0]) return { status: 400, body: { error: 'factura_id no existe.' } };
        facturaNumero = fRows[0].numero_venta;
        const ruts = [fRows[0].rut_emisor, fRows[0].rut_receptor]
          .map((r) => String(r || '').replace(/[^0-9kK]/g, '').toLowerCase());
        if (val.rut_normalizado && !ruts.includes(val.rut_normalizado)) {
          advertencias.push('El RUT del eslabón no aparece como emisor ni receptor del DTE vinculado.');
        }
      }

      const eslabonN = Number(lote.n_eslabones) + 1;
      const nonce = generarNonce();
      const hashDoc = hashEslabonLote({
        lote_codigo: lote.codigo, eslabon: eslabonN, rol: b.rol,
        rut_empresa: val.rut_normalizado, pais: val.pais, fecha: b.fecha,
        cantidad: b.cantidad, co2e_aportado: b.co2e_aportado, factura_numero: facturaNumero, nonce,
      });
      const hashEnc = hashCadena(lote.ultimo_hash, hashDoc);

      const { rows: eRows } = await client.query(
        `INSERT INTO lote_eslabones
           (lote_id, eslabon, rol, rut_empresa, nombre_empresa, pais, fecha, cantidad,
            factura_id, co2e_aportado, visibilidad, datos, nonce,
            hash_documento, hash_anterior, hash_cadena)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING *`,
        [
          lote.id, eslabonN, b.rol, val.rut_normalizado, b.nombre_empresa || null, val.pais,
          b.fecha, b.cantidad ?? null, b.factura_id || null, Number(b.co2e_aportado ?? 0),
          b.visibilidad || 'publico', JSON.stringify(b.datos || {}), nonce,
          hashDoc, lote.ultimo_hash, hashEnc,
        ]
      );
      await client.query(
        `UPDATE lotes_minerales SET ultimo_hash = $2, n_eslabones = $3, updated_at = now() WHERE id = $1`,
        [lote.id, hashEnc, eslabonN]
      );
      return { status: 201, body: { eslabon: eRows[0], advertencias } };
    });

    if (resultado.status === 201) {
      await logActividad({
        usuarioId: req.user.sub, accion: 'agregar_eslabon_origen', entidad: 'lote_eslabon',
        entidadId: resultado.body.eslabon.id,
        detalle: { lote_id: req.params.id, eslabon: resultado.body.eslabon.eslabon, rol: resultado.body.eslabon.rol },
        ip: req.ip,
      });
    }
    res.status(resultado.status).json(resultado.body);
  } catch (err) { next(err); }
});

// ---------- PUT /lotes/:id/declaraciones/:codigo — checklist normativo ----------
router.put('/lotes/:id/declaraciones/:codigo', adminOnly, async (req, res, next) => {
  try {
    const { codigo } = req.params;
    if (!codigoDeclaracionValido(codigo)) return res.status(400).json({ error: 'Código de declaración desconocido.' });
    const b = req.body || {};
    if (!['pendiente', 'declarado', 'con_evidencia', 'no_aplica'].includes(b.estado)) {
      return res.status(400).json({ error: 'Estado inválido.' });
    }
    const { rows: lRows } = await query(`SELECT id FROM lotes_minerales WHERE id = $1`, [req.params.id]);
    if (!lRows[0]) return res.status(404).json({ error: 'Lote no encontrado' });

    const { rows } = await query(
      `INSERT INTO lote_declaraciones (lote_id, codigo, estado, detalle, evidencia_url, declarado_por, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6, now())
       ON CONFLICT (lote_id, codigo) DO UPDATE SET
         estado = $3, detalle = $4, evidencia_url = $5, declarado_por = $6, updated_at = now()
       RETURNING codigo, estado, detalle, evidencia_url, updated_at`,
      [req.params.id, codigo, b.estado, b.detalle || null, b.evidencia_url || null, req.user.sub]
    );
    await logActividad({
      usuarioId: req.user.sub, accion: 'declarar_normativa_origen', entidad: 'lote_declaracion',
      detalle: { lote_id: req.params.id, codigo, estado: b.estado }, ip: req.ip,
    });
    res.json({ declaracion: rows[0] });
  } catch (err) { next(err); }
});

// ---------- POST /lotes/:id/cerrar ----------
router.post('/lotes/:id/cerrar', adminOnly, async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE lotes_minerales SET estado = 'cerrado', updated_at = now()
       WHERE id = $1 AND estado = 'abierto' RETURNING id, codigo, estado, ultimo_hash, n_eslabones`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(409).json({ error: 'Lote inexistente o ya cerrado.' });
    await logActividad({
      usuarioId: req.user.sub, accion: 'cerrar_lote_origen', entidad: 'lote_mineral',
      entidadId: rows[0].id, detalle: { codigo: rows[0].codigo, n_eslabones: rows[0].n_eslabones }, ip: req.ip,
    });
    res.json({ lote: rows[0] });
  } catch (err) { next(err); }
});

// ---------- GET /lotes/:id/verificar — recalcular la cadena del lote ----------
router.get('/lotes/:id/verificar', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, eslabon, hash_documento, hash_anterior, hash_cadena
       FROM lote_eslabones WHERE lote_id = $1 ORDER BY eslabon`, [req.params.id]
    );
    res.json({ integridad: verificarCadenaCompleta(rows) });
  } catch (err) { next(err); }
});

// ---------- GET /catalogo — roles y materiales para el frontend ----------
router.get('/catalogo', (req, res) => {
  res.json({ roles: ROLES, materiales: MATERIALES });
});

export default router;
