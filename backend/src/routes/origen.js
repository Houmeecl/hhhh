import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { query, withTx } from '../lib/db.js';
import { requireAuth, requireRole, requireHomePanel, requireNivelOperador, logActividad, signAccess } from '../middleware/auth.js';
import { loginLimiter } from '../middleware/rateLimit.js';
import { verificarCadenaCompleta, GENESIS, hashCadena } from '../services/cadenaHash.js';
import { generarClave, generarSerial } from '../services/posTerminal.js';
import { generateCredencialTarjeta, generateCredencialProveedor } from '../services/pdf.js';
import { leerDocumentoGenerico } from '../services/lecturaDocumentoGenerico.js';
import {
  ROLES,
  TIPOS,
  CATALOGO_MATERIALES,
  ROLES_POR_TIPO,
  materialValido,
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
  generarSerialTarjeta,
  hashAnclajeLote,
  sanearPuntoId,
  PUNTOS_CORREDOR_IDS,
  generarSerialCredencialProveedor,
  validarIdentidadProveedor,
  loteAdmiteRol,
  TIPOS_DOCUMENTO_CARGA,
  semaforoDocumental,
  hashDocumentoLote,
  placaValida,
} from '../services/pasaporteOrigen.js';

// Roles que hoy admiten credencial de firma (atestación) por tipo de
// lote — uno por tipo, para mantener la emisión simple sin selector de
// rol en el body salvo cuando el tipo lo requiere.
const ROLES_CREDENCIAL_VALIDOS = ['proveedor', 'puerto'];

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
router.use(requireAuth, requireHomePanel('sicrep'));
const adminOnly = requireRole('admin', 'operador');

const NORM_SQL = `regexp_replace(COALESCE($1,''), '[^0-9kK]', '', 'g')`;
// Superset de materiales de todos los tipos (para filtros de lista).
const MATERIALES = [...new Set(Object.values(CATALOGO_MATERIALES).flat())];

// ---------- GET /lotes — lista con filtros ----------
router.get('/lotes', async (req, res, next) => {
  try {
    const { material, estado, rut, tipo } = req.query;
    const cond = [];
    const params = [];
    if (tipo && TIPOS.includes(tipo)) { params.push(tipo); cond.push(`tipo = $${params.length}`); }
    if (material && MATERIALES.includes(material)) { params.push(material); cond.push(`material = $${params.length}`); }
    if (estado && ['abierto', 'cerrado'].includes(estado)) { params.push(estado); cond.push(`estado = $${params.length}`); }
    if (rut) {
      params.push(String(rut));
      cond.push(`regexp_replace(COALESCE(rut_titular,''), '[^0-9kK]', '', 'g') = regexp_replace($${params.length}, '[^0-9kK]', '', 'g')`);
    }
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
    const { rows } = await query(
      `SELECT id, codigo, tipo, material, cantidad, unidad, pais_origen, faena_origen,
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
    const tipo = b.tipo || 'mineral';
    if (!TIPOS.includes(tipo)) {
      return res.status(400).json({ error: `Tipo inválido. Uno de: ${TIPOS.join(', ')}.` });
    }
    if (!materialValido(tipo, b.material)) {
      return res.status(400).json({ error: `Material inválido para tipo ${tipo}. Uno de: ${CATALOGO_MATERIALES[tipo].join(', ')}.` });
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
           (codigo, tipo, material, descripcion, codigo_nc, cantidad, unidad, pais_origen,
            faena_origen, rut_titular, composicion, estandar_externo, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [
          codigo, tipo, b.material, b.descripcion || null, b.codigo_nc || null, cantidad,
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
    const { rows } = await query(
      `SELECT l.*, a.nombre AS agencia_nombre
       FROM lotes_minerales l LEFT JOIN agencias_aduana a ON a.id = l.agencia_id
       WHERE l.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Lote no encontrado' });
    const lote = rows[0];
    const [{ rows: eslabones }, { rows: declaraciones }, { rows: documentos }] = await Promise.all([
      query(`SELECT * FROM lote_eslabones WHERE lote_id = $1 ORDER BY eslabon`, [lote.id]),
      query(`SELECT codigo, estado, detalle, evidencia_url, updated_at FROM lote_declaraciones WHERE lote_id = $1`, [lote.id]),
      query(
        `SELECT id, lote_id, eslabon_id, tipo_documento, archivo_original, extension, tamano_bytes,
                sha256, estado, etapa_lectura, visibilidad, datos, hash_documento, hash_anterior,
                hash_cadena, revisado_por, revisado_en, created_at
         FROM lote_documentos WHERE lote_id = $1 ORDER BY created_at DESC`,
        [lote.id]
      ),
    ]);
    res.json({
      lote,
      eslabones: filtrarPorVisibilidad(eslabones, 'privado'),
      declaraciones,
      documentos,
      semaforo: semaforoDocumental(lote, documentos),
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
    // Asignación de agencia de aduana — solo lotes documentales (Carga
    // Bioceánica); sin esto la agencia nunca vería el expediente en
    // /panel-agencia (routes/agencia.js filtra por agencia_id).
    if (b.agencia_id !== undefined && b.agencia_id !== null) {
      if (rows[0].tipo !== 'documental') {
        return res.status(400).json({ error: 'Solo los lotes documentales admiten agencia de aduana.' });
      }
      const { rows: aRows } = await query(`SELECT id FROM agencias_aduana WHERE id = $1 AND activo = true`, [b.agencia_id]);
      if (!aRows[0]) return res.status(400).json({ error: 'agencia_id no existe o está inactiva.' });
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
         agencia_id    = CASE WHEN $12::text IS NOT NULL THEN NULLIF($12,'')::uuid ELSE agencia_id END,
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [
        req.params.id, b.descripcion ?? null, b.codigo_nc ?? null, b.faena_origen ?? null,
        b.rut_titular ?? null,
        b.composicion !== undefined ? JSON.stringify(b.composicion) : null,
        b.estandar_externo !== undefined ? JSON.stringify(b.estandar_externo) : null,
        b.emisiones_directas_tco2e_t ?? null, b.emisiones_indirectas_tco2e_t ?? null,
        b.metodo_emisiones ?? null, b.fuente_metodologica_id ?? null,
        b.agencia_id !== undefined ? String(b.agencia_id ?? '') : null,
      ]
    );
    await logActividad({
      usuarioId: req.user.sub, accion: 'editar_lote_origen', entidad: 'lote_mineral',
      entidadId: req.params.id, detalle: { campos: Object.keys(b) }, ip: req.ip,
    });
    res.json({ lote: uRows[0] });
  } catch (err) { next(err); }
});

// Anexa un eslabón a un lote YA BLOQUEADO (SELECT ... FOR UPDATE) dentro
// de una transacción. Compartido entre el POST admin y el paso del
// portador de la tarjeta de viaje (tarjetaRouter). Devuelve {status, body}.
async function anexarEslabonTx(client, lote, b) {
  const { rows: prevRows } = await client.query(
    `SELECT eslabon, rol FROM lote_eslabones WHERE lote_id = $1 ORDER BY eslabon`, [lote.id]
  );
  const val = validarEslabon(b, lote, prevRows);
  if (!val.ok) return { status: 400, body: { error: val.errores.join(' ') } };

  // Vínculo opcional al DTE real: existe, y su RUT debiera coincidir.
  let facturaNumero = null;
  const advertencias = [...val.advertencias];

  // El punto_id es dato declarativo del actor (torre/tarjeta lo usan para
  // ubicar el paso en el mapa del Corredor): si no calza con el catálogo
  // real, el eslabón igual se guarda (append-only, nunca se rechaza por
  // esto) pero se avisa — mismo patrón no bloqueante que la advertencia
  // de RUT que no calza con el DTE/documento vinculado, más abajo.
  const puntoIdDeclarado = b.datos?.punto_id;
  if (puntoIdDeclarado && !PUNTOS_CORREDOR_IDS.includes(puntoIdDeclarado)) {
    advertencias.push(`El punto de control '${puntoIdDeclarado}' no está en el catálogo del corredor.`);
  }

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

  // Vínculo opcional a un documento del Corredor (MIC/DTA, manifiesto —
  // el ancla natural del pasaporte DOCUMENTAL, migración 023).
  if (b.documento_corredor_id) {
    const { rows: dRows } = await client.query(
      `SELECT id, numero_documento, rut_emisor, rut_receptor FROM documentos_corredor WHERE id = $1`,
      [b.documento_corredor_id]
    );
    if (!dRows[0]) return { status: 400, body: { error: 'documento_corredor_id no existe.' } };
    const rutsDoc = [dRows[0].rut_emisor, dRows[0].rut_receptor]
      .map((r) => String(r || '').replace(/[^0-9kK]/g, '').toLowerCase());
    if (val.rut_normalizado && rutsDoc.some(Boolean) && !rutsDoc.includes(val.rut_normalizado)) {
      advertencias.push('El RUT del eslabón no aparece en el documento del corredor vinculado.');
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
        factura_id, documento_corredor_id, co2e_aportado, visibilidad, datos, nonce,
        hash_documento, hash_anterior, hash_cadena)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING *`,
    [
      lote.id, eslabonN, b.rol, val.rut_normalizado, b.nombre_empresa || null, val.pais,
      b.fecha, b.cantidad ?? null, b.factura_id || null, b.documento_corredor_id || null,
      Number(b.co2e_aportado ?? 0),
      b.visibilidad || 'publico', JSON.stringify(b.datos || {}), nonce,
      hashDoc, lote.ultimo_hash, hashEnc,
    ]
  );
  await client.query(
    `UPDATE lotes_minerales SET ultimo_hash = $2, n_eslabones = $3, updated_at = now() WHERE id = $1`,
    [lote.id, hashEnc, eslabonN]
  );
  return { status: 201, body: { eslabon: eRows[0], advertencias } };
}

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
      return anexarEslabonTx(client, lote, b);
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

// ---------- POST /lotes/:id/cerrar — sella el lote y lo ANCLA en la cadena global ----------
// El hash final del lote queda como eslabón de la cadena global de
// sicr3p (cadena_anclajes comparte la secuencia de cadena_estado con
// las facturas — por eso las verificaciones globales leen la unión).
router.post('/lotes/:id/cerrar', adminOnly, async (req, res, next) => {
  try {
    const resultado = await withTx(async (client) => {
      const { rows: lRows } = await client.query(
        `SELECT * FROM lotes_minerales WHERE id = $1 FOR UPDATE`, [req.params.id]
      );
      const lote = lRows[0];
      if (!lote) return { status: 404, body: { error: 'Lote no encontrado' } };
      if (lote.estado !== 'abierto') return { status: 409, body: { error: 'El lote ya está cerrado.' } };

      // Mismo lock global que el encadenado de facturas (public.js).
      const { rows: eRows } = await client.query(`SELECT * FROM cadena_estado WHERE id = 1 FOR UPDATE`);
      const estadoGlobal = eRows[0];
      let anclaje = null;
      if (estadoGlobal) {
        const hashDoc = hashAnclajeLote({
          codigo: lote.codigo, ultimo_hash: lote.ultimo_hash, n_eslabones: lote.n_eslabones,
        });
        const hashEnc = hashCadena(estadoGlobal.ultimo_hash, hashDoc);
        const eslabonGlobal = Number(estadoGlobal.n_eslabones) + 1;
        const { rows: aRows } = await client.query(
          `INSERT INTO cadena_anclajes (lote_id, eslabon, hash_documento, hash_anterior, hash_cadena)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [lote.id, eslabonGlobal, hashDoc, estadoGlobal.ultimo_hash, hashEnc]
        );
        anclaje = aRows[0];
        await client.query(
          `UPDATE cadena_estado SET ultimo_hash = $1, n_eslabones = $2, updated_at = now() WHERE id = 1`,
          [hashEnc, eslabonGlobal]
        );
      }

      const { rows: uRows } = await client.query(
        `UPDATE lotes_minerales SET estado = 'cerrado', updated_at = now()
         WHERE id = $1 RETURNING id, codigo, estado, ultimo_hash, n_eslabones`,
        [lote.id]
      );
      return { status: 200, body: { lote: uRows[0], anclaje } };
    });

    if (resultado.status === 200) {
      await logActividad({
        usuarioId: req.user.sub, accion: 'cerrar_lote_origen', entidad: 'lote_mineral',
        entidadId: resultado.body.lote.id,
        detalle: {
          codigo: resultado.body.lote.codigo,
          n_eslabones: resultado.body.lote.n_eslabones,
          anclaje_global: resultado.body.anclaje?.eslabon ?? null,
        },
        ip: req.ip,
      });
    }
    res.status(resultado.status).json(resultado.body);
  } catch (err) { next(err); }
});

// ---------- Tarjetas de viaje (NFC/RFID que acompañan a la carga) ----------
router.get('/lotes/:id/tarjetas', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, serial, uid_fisico, portador, activo, ultima_actividad, pasos_registrados, created_at,
              placa_tracto, placa_semirremolque, conductor_nombre, conductor_documento
       FROM tarjetas_viaje WHERE lote_id = $1 ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json({ tarjetas: rows });
  } catch (err) { next(err); }
});

// Emite una tarjeta para el lote: serial TV-XXXX + clave del portador
// (bcrypt; en claro SOLO en esta respuesta — patrón POS/mandantes).
router.post('/lotes/:id/tarjetas', adminOnly, async (req, res, next) => {
  try {
    const { rows: lRows } = await query(`SELECT id, codigo, estado FROM lotes_minerales WHERE id = $1`, [req.params.id]);
    if (!lRows[0]) return res.status(404).json({ error: 'Lote no encontrado' });
    if (lRows[0].estado !== 'abierto') return res.status(409).json({ error: 'El lote está cerrado.' });

    const b = req.body || {};
    const clave = generarClave();
    const claveHash = await bcrypt.hash(clave, 10);

    // Placa/conductor: chequeo liviano, NUNCA bloqueante — un camión un
    // día no tiene todavía la placa a mano, no debe impedir emitir la tarjeta.
    const advertencias = [];
    if (b.placa_tracto && !placaValida(b.placa_tracto)) advertencias.push('placa_tracto no parece una patente válida.');
    if (b.placa_semirremolque && !placaValida(b.placa_semirremolque)) advertencias.push('placa_semirremolque no parece una patente válida.');

    let tarjeta = null;
    for (let intento = 0; intento < 5 && !tarjeta; intento++) {
      try {
        const { rows } = await query(
          `INSERT INTO tarjetas_viaje
             (serial, uid_fisico, lote_id, portador, clave_hash,
              placa_tracto, placa_semirremolque, conductor_nombre, conductor_documento)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING id, serial, uid_fisico, portador, activo, created_at,
                     placa_tracto, placa_semirremolque, conductor_nombre, conductor_documento`,
          [
            generarSerialTarjeta(), b.uid_fisico || null, lRows[0].id, b.portador || null, claveHash,
            b.placa_tracto || null, b.placa_semirremolque || null, b.conductor_nombre || null, b.conductor_documento || null,
          ]
        );
        tarjeta = rows[0];
      } catch (e) {
        if (e.code !== '23505') throw e; // colisión de serial: reintenta
        if (String(e.detail || '').includes('uid_fisico')) {
          return res.status(409).json({ error: 'Ese UID físico ya está registrado en otra tarjeta.' });
        }
      }
    }
    if (!tarjeta) return res.status(500).json({ error: 'No se pudo generar un serial único.' });

    await logActividad({
      usuarioId: req.user.sub, accion: 'emitir_tarjeta_viaje', entidad: 'tarjeta_viaje',
      entidadId: tarjeta.id, detalle: { serial: tarjeta.serial, lote: lRows[0].codigo }, ip: req.ip,
    });
    // `clave` en claro SOLO aquí: se entrega impresa junto con la tarjeta.
    res.status(201).json({ tarjeta, clave, advertencias });
  } catch (err) { next(err); }
});

// Credencial virtual PDF de la tarjeta (tamaño tarjeta, con QR a /v/serial).
// La descarga el admin y se la envía al transportista — WhatsApp o impresa.
router.get('/lotes/:id/tarjetas/:tarjetaId/credencial.pdf', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT t.*, l.codigo AS lote_codigo, l.material AS lote_material
       FROM tarjetas_viaje t JOIN lotes_minerales l ON l.id = t.lote_id
       WHERE t.id = $1 AND t.lote_id = $2`,
      [req.params.tarjetaId, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Tarjeta no encontrada' });
    const t = rows[0];
    const pdf = await generateCredencialTarjeta({
      tarjeta: t,
      lote: { codigo: t.lote_codigo, material: t.lote_material },
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="sicr3p-credencial-${t.serial}.pdf"`);
    res.send(pdf);
  } catch (err) { next(err); }
});

router.put('/tarjetas/:id', adminOnly, async (req, res, next) => {
  try {
    const b = req.body || {};
    // Placa/conductor: chequeo liviano, NUNCA bloqueante (formatos varían
    // mucho entre BR/PY/AR/CL) — solo se advierte, no se rechaza el guardado.
    const advertencias = [];
    if (b.placa_tracto && !placaValida(b.placa_tracto)) advertencias.push('placa_tracto no parece una patente válida.');
    if (b.placa_semirremolque && !placaValida(b.placa_semirremolque)) advertencias.push('placa_semirremolque no parece una patente válida.');
    const { rows } = await query(
      `UPDATE tarjetas_viaje SET
         activo = COALESCE($2, activo),
         portador = COALESCE($3, portador),
         placa_tracto = COALESCE($4, placa_tracto),
         placa_semirremolque = COALESCE($5, placa_semirremolque),
         conductor_nombre = COALESCE($6, conductor_nombre),
         conductor_documento = COALESCE($7, conductor_documento)
       WHERE id = $1
       RETURNING id, serial, portador, activo, pasos_registrados, placa_tracto, placa_semirremolque, conductor_nombre, conductor_documento`,
      [
        req.params.id, typeof b.activo === 'boolean' ? b.activo : null, b.portador ?? null,
        b.placa_tracto ?? null, b.placa_semirremolque ?? null, b.conductor_nombre ?? null, b.conductor_documento ?? null,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Tarjeta no encontrada' });
    await logActividad({
      usuarioId: req.user.sub, accion: 'editar_tarjeta_viaje', entidad: 'tarjeta_viaje',
      entidadId: rows[0].id, detalle: { serial: rows[0].serial, activo: rows[0].activo }, ip: req.ip,
    });
    res.json({ tarjeta: rows[0], advertencias });
  } catch (err) { next(err); }
});

// ---------- Documentos del expediente — Carga Bioceánica (migración 043) ----------
// Relaciona N documentos con un lote (factura, packing list, carta de
// porte, MIC/DTA, etc.) en su PROPIA cadena de hash, aislada de
// lote_eslabones (mismo aislamiento que cuentas_naturales, migración 029).
export const uploadDocumentoLote = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(pdf|jpe?g|png|heic)$/i.test(file.originalname);
    cb(ok ? null : new Error('Formato no permitido'), ok);
  },
});

router.get('/lotes/:id/documentos', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, lote_id, eslabon_id, tipo_documento, archivo_original, extension, tamano_bytes,
              sha256, estado, etapa_lectura, visibilidad, datos, hash_documento, hash_anterior,
              hash_cadena, revisado_por, revisado_en, created_at
       FROM lote_documentos WHERE lote_id = $1 ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json({ documentos: rows });
  } catch (err) { next(err); }
});

// Sube un documento del expediente. Si se lee con señal suficiente, entra
// DE INMEDIATO a la cadena de hash de documentos del lote (estado
// 'leido'). Si no, se guarda TEMPORALMENTE con su binario en
// 'pendiente_revision' para que un humano de sicrep lo resuelva — la
// única cola de revisión que existe en el proyecto, acotada a este flujo
// (el autoservicio público /cargar sigue siendo 422-solo, sin cambios).
// Compartida con routes/agencia.js (pantalla de captura tablet/PC) — mismo
// espíritu que anexarEslabonTx: una sola fuente de verdad para el cálculo
// de hash, exportada en vez de duplicada.
export async function subirDocumentoLote({ loteId, file, tipoDocumento, subidoPor }) {
  if (!TIPOS_DOCUMENTO_CARGA.includes(tipoDocumento)) {
    return { status: 400, body: { error: `tipo_documento inválido. Uno de: ${TIPOS_DOCUMENTO_CARGA.join(', ')}.` } };
  }
  if (!file) return { status: 400, body: { error: 'Debes adjuntar un archivo.' } };

  // Pre-lectura FUERA de la transacción (mismo motivo que public.js: el
  // OCR puede tardar decenas de segundos y no debe serializar al resto).
  const lectura = await leerDocumentoGenerico(file.buffer, file.originalname, tipoDocumento);
  const shaArchivo = crypto.createHash('sha256').update(file.buffer).digest('hex');
  const extension = (file.originalname.split('.').pop() || '').toLowerCase();

  return withTx(async (client) => {
    const { rows: lockRows } = await client.query(
      `SELECT * FROM lotes_minerales WHERE id = $1 FOR UPDATE`, [loteId]
    );
    const lote = lockRows[0];
    if (!lote) return { status: 404, body: { error: 'Lote no encontrado' } };
    if (lote.estado !== 'abierto') return { status: 409, body: { error: 'El lote está cerrado.' } };
    const nonce = generarNonce();

    if (lectura.estado === 'sin_texto') {
      const { rows } = await client.query(
        `INSERT INTO lote_documentos
           (lote_id, tipo_documento, archivo_original, extension, tamano_bytes, sha256,
            estado, etapa_lectura, archivo_pendiente, nonce, hash_documento, hash_anterior, hash_cadena, subido_por)
         VALUES ($1,$2,$3,$4,$5,$6,'pendiente_revision',$7,$8,$9,$10,$10,$10,$11)
         RETURNING id, lote_id, tipo_documento, archivo_original, extension, tamano_bytes, sha256, estado, etapa_lectura, created_at`,
        [lote.id, tipoDocumento, file.originalname, extension, file.size, shaArchivo, lectura.etapa, file.buffer, nonce, GENESIS, subidoPor || null]
      );
      return { status: 201, body: { documento: rows[0] } };
    }

    const nDocumento = Number(lote.doc_n_documentos) + 1;
    const hashDoc = hashDocumentoLote({
      lote_codigo: lote.codigo, n_documento: nDocumento, tipo_documento: tipoDocumento, sha256: shaArchivo, nonce,
    });
    const hashEnc = hashCadena(lote.doc_ultimo_hash, hashDoc);
    const { rows } = await client.query(
      `INSERT INTO lote_documentos
         (lote_id, tipo_documento, archivo_original, extension, tamano_bytes, sha256,
          estado, etapa_lectura, nonce, hash_documento, hash_anterior, hash_cadena, subido_por)
       VALUES ($1,$2,$3,$4,$5,$6,'leido',$7,$8,$9,$10,$11,$12)
       RETURNING id, lote_id, tipo_documento, archivo_original, extension, tamano_bytes, sha256, estado, etapa_lectura, hash_cadena, created_at`,
      [lote.id, tipoDocumento, file.originalname, extension, file.size, shaArchivo, lectura.etapa, nonce, hashDoc, lote.doc_ultimo_hash, hashEnc, subidoPor || null]
    );
    await client.query(
      `UPDATE lotes_minerales SET doc_ultimo_hash = $2, doc_n_documentos = $3, updated_at = now() WHERE id = $1`,
      [lote.id, hashEnc, nDocumento]
    );
    return { status: 201, body: { documento: rows[0] } };
  });
}

router.post('/lotes/:id/documentos', adminOnly, uploadDocumentoLote.single('archivo'), async (req, res, next) => {
  try {
    const resultado = await subirDocumentoLote({
      loteId: req.params.id, file: req.file,
      tipoDocumento: String(req.body?.tipo_documento || ''), subidoPor: req.user.sub,
    });
    if (resultado.status === 201) {
      await logActividad({
        usuarioId: req.user.sub, accion: 'subir_documento_lote', entidad: 'lote_documento',
        entidadId: resultado.body.documento.id,
        detalle: { lote_id: req.params.id, tipo_documento: resultado.body.documento.tipo_documento, estado: resultado.body.documento.estado },
        ip: req.ip,
      });
    }
    res.status(resultado.status).json(resultado.body);
  } catch (err) { next(err); }
});

// ---------- Cola de revisión de documentos — SOLO Carga Bioceánica ----------
// Único humano-en-el-medio del proyecto: acotado a lote_documentos, nunca
// al autoservicio público /cargar (que sigue rechazando con 422).
router.get('/revision-documentos', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT d.id, d.lote_id, l.codigo AS lote_codigo, l.tipo AS lote_tipo, d.tipo_documento,
              d.archivo_original, d.extension, d.tamano_bytes, d.sha256, d.etapa_lectura, d.created_at
       FROM lote_documentos d JOIN lotes_minerales l ON l.id = d.lote_id
       WHERE d.estado = 'pendiente_revision'
       ORDER BY d.created_at ASC`
    );
    res.json({ pendientes: rows });
  } catch (err) { next(err); }
});

// Aprobar: entra recién ahora a la cadena de hash de documentos del lote y
// se borra el binario temporal. Rechazar: se registra en
// documentos_rechazados (SIN binario, mismo patrón del flujo público) y
// se borra la fila (y su binario) por completo.
router.put('/revision-documentos/:id', adminOnly, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!['aprobar', 'rechazar'].includes(b.accion)) {
      return res.status(400).json({ error: 'accion debe ser aprobar o rechazar.' });
    }

    const resultado = await withTx(async (client) => {
      const { rows: dRows } = await client.query(
        `SELECT * FROM lote_documentos WHERE id = $1 AND estado = 'pendiente_revision' FOR UPDATE`,
        [req.params.id]
      );
      const doc = dRows[0];
      if (!doc) return { status: 404, body: { error: 'Documento pendiente no encontrado.' } };

      if (b.accion === 'rechazar') {
        try {
          await client.query(
            `INSERT INTO documentos_rechazados (nombre_archivo, extension, tamano_bytes, sha256, motivo, etapa_alcanzada, rut_cliente)
             VALUES ($1,$2,$3,$4,'sin_senal',$5,
               (SELECT rut_titular FROM lotes_minerales WHERE id = $6))`,
            [doc.archivo_original, doc.extension, doc.tamano_bytes, doc.sha256, doc.etapa_lectura, doc.lote_id]
          );
        } catch (e) {
          if (e.code !== '42P01') throw e; // migración 030 sin correr: no bloquea el rechazo
        }
        await client.query(`DELETE FROM lote_documentos WHERE id = $1`, [doc.id]);
        return { status: 200, body: { resultado: 'rechazado', documento_id: doc.id } };
      }

      const { rows: lRows } = await client.query(
        `SELECT * FROM lotes_minerales WHERE id = $1 FOR UPDATE`, [doc.lote_id]
      );
      const lote = lRows[0];
      if (!lote) return { status: 404, body: { error: 'Lote no encontrado.' } };

      const tipoFinal = b.tipo_documento && TIPOS_DOCUMENTO_CARGA.includes(b.tipo_documento) ? b.tipo_documento : doc.tipo_documento;
      const nDocumento = Number(lote.doc_n_documentos) + 1;
      const hashDoc = hashDocumentoLote({
        lote_codigo: lote.codigo, n_documento: nDocumento, tipo_documento: tipoFinal, sha256: doc.sha256, nonce: doc.nonce,
      });
      const hashEnc = hashCadena(lote.doc_ultimo_hash, hashDoc);
      const { rows: uRows } = await client.query(
        `UPDATE lote_documentos SET
           estado = 'leido', tipo_documento = $2, archivo_pendiente = NULL,
           hash_documento = $3, hash_anterior = $4, hash_cadena = $5,
           revisado_por = $6, revisado_en = now(), datos = COALESCE($7::jsonb, datos)
         WHERE id = $1
         RETURNING id, lote_id, tipo_documento, archivo_original, estado, hash_cadena, revisado_en`,
        [doc.id, tipoFinal, hashDoc, lote.doc_ultimo_hash, hashEnc, req.user.sub, b.datos !== undefined ? JSON.stringify(b.datos) : null]
      );
      await client.query(
        `UPDATE lotes_minerales SET doc_ultimo_hash = $2, doc_n_documentos = $3, updated_at = now() WHERE id = $1`,
        [lote.id, hashEnc, nDocumento]
      );
      return { status: 200, body: { documento: uRows[0] } };
    });

    await logActividad({
      usuarioId: req.user.sub, accion: `revision_documento_${b.accion}`, entidad: 'lote_documento',
      entidadId: req.params.id, detalle: { accion: b.accion }, ip: req.ip,
    });
    res.status(resultado.status).json(resultado.body);
  } catch (err) { next(err); }
});

// ---------- Credenciales de Firma del Proveedor (atestación, migración 038) ----------
// NO es firma electrónica con validez legal (Ley N° 19.799): es una
// atestación sellada por hash, con identidad FIJADA por quien emite la
// credencial (nunca declarada por el firmante). Válida para UN SOLO
// eslabón — ver firmaProveedorRouter más abajo.
router.get('/lotes/:id/credenciales-proveedor', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, serial, rol, rut_empresa, nombre_empresa, punto_id, activo, firmado_at, eslabon_id, created_at
       FROM credenciales_proveedor WHERE lote_id = $1 ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json({ credenciales: rows });
  } catch (err) { next(err); }
});

router.post('/lotes/:id/credenciales-proveedor', adminOnly, async (req, res, next) => {
  try {
    const { rows: lRows } = await query(`SELECT id, codigo, tipo, estado FROM lotes_minerales WHERE id = $1`, [req.params.id]);
    if (!lRows[0]) return res.status(404).json({ error: 'Lote no encontrado' });
    if (lRows[0].estado !== 'abierto') return res.status(409).json({ error: 'El lote está cerrado.' });

    const b = req.body || {};
    const rol = ROLES_CREDENCIAL_VALIDOS.includes(b.rol) ? b.rol : 'proveedor';
    if (!loteAdmiteRol(lRows[0], rol)) {
      return res.status(400).json({
        error: `Este lote (tipo '${lRows[0].tipo}') no tiene el rol '${rol}' en su cadena de custodia.`,
      });
    }

    const val = validarIdentidadProveedor(b);
    if (!val.ok) return res.status(400).json({ error: val.errores.join(' ') });

    // El punto_id (igual que rut_empresa/nombre_empresa) lo fija el EMISOR,
    // nunca el firmante — así el eslabón 'puerto' que se sella al firmar
    // queda con la ubicación correcta para que el actor Puerto lo encuentre.
    let puntoId = null;
    if (rol === 'puerto') {
      puntoId = sanearPuntoId(b.punto_id);
      if (!puntoId) return res.status(400).json({ error: 'punto_id es obligatorio para el rol puerto.' });
    }

    const clave = generarClave();
    const claveHash = await bcrypt.hash(clave, 10);

    let credencial = null;
    for (let intento = 0; intento < 5 && !credencial; intento++) {
      try {
        const { rows } = await query(
          `INSERT INTO credenciales_proveedor (serial, lote_id, rol, rut_empresa, nombre_empresa, clave_hash, punto_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING id, serial, rol, rut_empresa, nombre_empresa, punto_id, activo, created_at`,
          [generarSerialCredencialProveedor(), lRows[0].id, rol, val.rut_normalizado, b.nombre_empresa.trim(), claveHash, puntoId]
        );
        credencial = rows[0];
      } catch (e) {
        if (e.code !== '23505') throw e; // colisión de serial: reintenta
      }
    }
    if (!credencial) return res.status(500).json({ error: 'No se pudo generar un serial único.' });

    await logActividad({
      usuarioId: req.user.sub, accion: 'emitir_credencial_proveedor', entidad: 'credencial_proveedor',
      entidadId: credencial.id, detalle: { serial: credencial.serial, rol, lote: lRows[0].codigo, punto_id: puntoId }, ip: req.ip,
    });
    // `clave` en claro SOLO aquí, igual que tarjetas de viaje / POS.
    res.status(201).json({ credencial, clave });
  } catch (err) { next(err); }
});

// Credencial virtual PDF (tamaño tarjeta, con QR a /f/serial + disclaimer).
router.get('/lotes/:id/credenciales-proveedor/:credencialId/credencial.pdf', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.*, l.codigo AS lote_codigo, l.material AS lote_material
       FROM credenciales_proveedor c JOIN lotes_minerales l ON l.id = c.lote_id
       WHERE c.id = $1 AND c.lote_id = $2`,
      [req.params.credencialId, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Credencial no encontrada' });
    const c = rows[0];
    const pdf = await generateCredencialProveedor({
      credencial: c,
      lote: { codigo: c.lote_codigo, material: c.lote_material },
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="sicr3p-credencial-proveedor-${c.serial}.pdf"`);
    res.send(pdf);
  } catch (err) { next(err); }
});

router.put('/credenciales-proveedor/:id', adminOnly, async (req, res, next) => {
  try {
    const b = req.body || {};
    const { rows: cRows } = await query(`SELECT firmado_at FROM credenciales_proveedor WHERE id = $1`, [req.params.id]);
    if (!cRows[0]) return res.status(404).json({ error: 'Credencial no encontrada' });
    // Identidad inmutable una vez usada: firmó con esos datos, corregirlos
    // rompería la atestación ya sellada. Solo se puede activar/desactivar.
    if (cRows[0].firmado_at && (b.rut_empresa !== undefined || b.nombre_empresa !== undefined)) {
      return res.status(409).json({ error: 'La credencial ya firmó: no se puede editar su identidad.' });
    }
    let val = { rut_normalizado: undefined };
    if (b.rut_empresa !== undefined || b.nombre_empresa !== undefined) {
      // Identidad se reemplaza completa (nunca a medias): evita que falte
      // uno de los dos campos al validar mientras el otro queda intacto.
      if (b.rut_empresa === undefined || b.nombre_empresa === undefined) {
        return res.status(400).json({ error: 'Para editar la identidad debes enviar rut_empresa y nombre_empresa juntos.' });
      }
      const check = validarIdentidadProveedor({ rut_empresa: b.rut_empresa, nombre_empresa: b.nombre_empresa });
      if (!check.ok) return res.status(400).json({ error: check.errores.join(' ') });
      val = check;
    }
    const { rows } = await query(
      `UPDATE credenciales_proveedor SET
         activo = COALESCE($2, activo),
         rut_empresa = COALESCE($3, rut_empresa),
         nombre_empresa = COALESCE($4, nombre_empresa)
       WHERE id = $1
       RETURNING id, serial, rut_empresa, nombre_empresa, activo, firmado_at`,
      [req.params.id, typeof b.activo === 'boolean' ? b.activo : null,
       val.rut_normalizado ?? null, b.nombre_empresa?.trim() ?? null]
    );
    await logActividad({
      usuarioId: req.user.sub, accion: 'editar_credencial_proveedor', entidad: 'credencial_proveedor',
      entidadId: rows[0].id, detalle: { serial: rows[0].serial, activo: rows[0].activo }, ip: req.ip,
    });
    res.json({ credencial: rows[0] });
  } catch (err) { next(err); }
});

// ---------- Proveedor persistente (migración 062) — asignación de qué ----------
// lote tipo 'producto' puede firmar cada proveedor con su cuenta FIDO2
// (/panel-proveedor). No reemplaza credenciales-proveedor (arriba, migración
// 038, de un solo uso): un proveedor puede tener AMBOS caminos vivos a la
// vez sobre el mismo lote — son mecanismos independientes que convergen en
// el mismo anexarEslabonTx.
router.get('/lotes/:id/proveedores-asignados', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT pl.id, pl.proveedor_id, pl.lote_id, pl.activo, pl.firmado_at, pl.eslabon_id, pl.created_at,
              p.nombre_empresa, p.rut
       FROM proveedor_lotes pl JOIN proveedores p ON p.id = pl.proveedor_id
       WHERE pl.lote_id = $1 ORDER BY pl.created_at DESC`,
      [req.params.id]
    );
    res.json({ asignaciones: rows });
  } catch (err) { next(err); }
});

router.post('/lotes/:id/proveedores-asignados', adminOnly, async (req, res, next) => {
  try {
    const { rows: lRows } = await query(`SELECT id, tipo, estado FROM lotes_minerales WHERE id = $1`, [req.params.id]);
    if (!lRows[0]) return res.status(404).json({ error: 'Lote no encontrado' });
    if (!loteAdmiteRol(lRows[0], 'proveedor')) {
      return res.status(400).json({
        error: `Este lote (tipo '${lRows[0].tipo}') no tiene el rol 'proveedor' en su cadena de custodia.`,
      });
    }
    if (lRows[0].estado !== 'abierto') return res.status(409).json({ error: 'El lote está cerrado.' });

    const proveedorId = req.body?.proveedor_id;
    if (!proveedorId) return res.status(400).json({ error: 'proveedor_id es obligatorio.' });
    const { rows: pRows } = await query(`SELECT id FROM proveedores WHERE id = $1 AND activo = true`, [proveedorId]);
    if (!pRows[0]) return res.status(400).json({ error: 'proveedor_id no existe o está inactivo.' });

    // Idempotente: si la asignación ya existe, no se duplica. Si ya firmó,
    // 409 (una asignación firmada es irrepetible, igual que credenciales-proveedor).
    const { rows } = await query(
      `INSERT INTO proveedor_lotes (proveedor_id, lote_id) VALUES ($1,$2)
       ON CONFLICT (proveedor_id, lote_id) DO NOTHING
       RETURNING id, proveedor_id, lote_id, activo, firmado_at, eslabon_id, created_at`,
      [proveedorId, req.params.id]
    );
    if (rows[0]) {
      await logActividad({
        usuarioId: req.user.sub, accion: 'asignar_proveedor_lote', entidad: 'proveedor_lote',
        entidadId: rows[0].id, detalle: { lote_id: req.params.id, proveedor_id: proveedorId }, ip: req.ip,
      });
      return res.status(201).json({ asignacion: rows[0] });
    }
    const { rows: existente } = await query(
      `SELECT id, proveedor_id, lote_id, activo, firmado_at, eslabon_id, created_at
       FROM proveedor_lotes WHERE proveedor_id = $1 AND lote_id = $2`,
      [proveedorId, req.params.id]
    );
    if (existente[0]?.firmado_at) return res.status(409).json({ error: 'Este proveedor ya firmó este lote.' });
    return res.status(200).json({ asignacion: existente[0] });
  } catch (err) { next(err); }
});

// Desasignar (togglear activo) — solo si aún no firmó: una asignación
// firmada queda fija, igual criterio que credenciales-proveedor.
router.put('/proveedores-asignados/:id', adminOnly, async (req, res, next) => {
  try {
    const { rows: existente } = await query(`SELECT firmado_at FROM proveedor_lotes WHERE id = $1`, [req.params.id]);
    if (!existente[0]) return res.status(404).json({ error: 'Asignación no encontrada' });
    if (existente[0].firmado_at) return res.status(409).json({ error: 'Esta asignación ya firmó: no se puede modificar.' });

    const { activo } = req.body || {};
    const { rows } = await query(
      `UPDATE proveedor_lotes SET activo = COALESCE($2, activo) WHERE id = $1
       RETURNING id, proveedor_id, lote_id, activo, firmado_at`,
      [req.params.id, typeof activo === 'boolean' ? activo : null]
    );
    await logActividad({
      usuarioId: req.user.sub, accion: 'editar_proveedor_lote', entidad: 'proveedor_lote',
      entidadId: rows[0].id, detalle: { activo: rows[0].activo }, ip: req.ip,
    });
    res.json({ asignacion: rows[0] });
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

// ---------- GET /catalogo — tipos, roles y materiales para el frontend ----------
router.get('/catalogo', (req, res) => {
  res.json({
    tipos: TIPOS,
    materiales_por_tipo: CATALOGO_MATERIALES,
    roles_por_tipo: ROLES_POR_TIPO,
    // Compatibilidad con clientes antiguos:
    roles: ROLES,
    materiales: MATERIALES,
  });
});

// ---------- POST /demo-torre — arma la demo de la torre de control ----------
// Crea en una transacción TODO lo que la demo necesita: TRES lotes
// documentales del Corredor, cada uno con su tarjeta de viaje (camión) —
// los camiones 1 y 2 nacen EN MOVIMIENTO (pasos ya sellados en puntos
// distintos del corredor) y el camión 3 nace sin ruta: aparece en el
// mapa recién cuando su chofer ACTIVA la tarjeta con el primer paso —
// más un terminal "torre" (rol pos) que comanda a los tres. Las claves
// viajan SOLO en esta respuesta (patrón POS/mandantes). Guion de uso:
// docs/TORRE-DE-CONTROL.md.
const CAMIONES_DEMO = [
  {
    portador: 'Camión demo 1',
    origen: { punto_control: 'Campo Grande', punto_id: 'campo-grande', pais: 'BR' },
    pasos: [{ punto_control: 'Mariscal Estigarribia', punto_id: 'mariscal-estigarribia', pais: 'PY' }],
  },
  {
    portador: 'Camión demo 2',
    origen: { punto_control: 'Campo Grande', punto_id: 'campo-grande', pais: 'BR' },
    pasos: [
      { punto_control: 'San Salvador de Jujuy', punto_id: 'jujuy', pais: 'AR' },
      { punto_control: 'Susques', punto_id: 'susques', pais: 'AR' },
    ],
  },
  {
    portador: 'Camión demo 3',
    // Sin punto_id: no se dibuja en el mapa hasta su primer paso real.
    origen: { punto_control: 'Bodega del generador (aún sin ruta)', punto_id: null, pais: 'BR' },
    pasos: [],
  },
];

router.post('/demo-torre', adminOnly, async (req, res, next) => {
  try {
    const claveTorre = generarClave();
    const clavesTarjeta = CAMIONES_DEMO.map(() => generarClave());
    const hashTorre = await bcrypt.hash(claveTorre, 10);
    const hashesTarjeta = await Promise.all(clavesTarjeta.map((c) => bcrypt.hash(c, 10)));

    const resultado = await withTx(async (client) => {
      const anio = new Date().getFullYear();
      const hoy = new Date().toISOString().slice(0, 10);
      const camiones = [];

      for (let i = 0; i < CAMIONES_DEMO.length; i++) {
        const c = CAMIONES_DEMO[i];
        const { rows: cRows } = await client.query(
          `SELECT count(*)::int + 1 AS n FROM lotes_minerales WHERE codigo LIKE $1`,
          [`LM-${anio}-%`]
        );
        const codigo = generarCodigoLote(anio, cRows[0].n);
        const { rows: lRows } = await client.query(
          `INSERT INTO lotes_minerales
             (codigo, tipo, material, descripcion, cantidad, unidad, pais_origen, faena_origen, creado_por)
           VALUES ($1,'documental','carga_general',$2,$3,'t','BR',$4,$5)
           RETURNING *`,
          [codigo, `Carga demo del Corredor Bioceánico — ${c.portador}`, 28, 'Campo Grande, MS (demo)', req.user.sub]
        );

        // Lock de la fila recién creada (mismo protocolo que todo append)
        // y eslabones iniciales: origen + pasos "en movimiento".
        let { rows: lockRows } = await client.query(
          `SELECT * FROM lotes_minerales WHERE id = $1 FOR UPDATE`, [lRows[0].id]
        );
        let lote = lockRows[0];
        const eslabones = [
          { rol: 'origen', nombre_empresa: 'Generador de carga (demo)', cantidad: 28, ...c.origen },
          ...c.pasos.map((p) => ({ rol: 'transporte', nombre_empresa: c.portador, ...p })),
        ];
        for (const e of eslabones) {
          const r = await anexarEslabonTx(client, lote, {
            rol: e.rol,
            pais: e.pais,
            fecha: hoy,
            nombre_empresa: e.nombre_empresa,
            cantidad: e.cantidad,
            co2e_aportado: 0,
            visibilidad: 'publico',
            datos: {
              punto_control: e.punto_control,
              ...(e.punto_id ? { punto_id: e.punto_id } : {}),
            },
          });
          if (r.status !== 201) return { status: r.status, body: r.body };
          // Releer el lote: anexarEslabonTx actualizó ultimo_hash/n_eslabones.
          ({ rows: lockRows } = await client.query(
            `SELECT * FROM lotes_minerales WHERE id = $1 FOR UPDATE`, [lote.id]
          ));
          lote = lockRows[0];
        }

        // Tarjeta del camión (serial TV-XXXX; colisión → reintento).
        let tarjeta = null;
        for (let intento = 0; intento < 5 && !tarjeta; intento++) {
          try {
            const { rows } = await client.query(
              `INSERT INTO tarjetas_viaje (serial, lote_id, portador, clave_hash)
               VALUES ($1,$2,$3,$4) RETURNING id, serial, portador, activo`,
              [generarSerialTarjeta(), lote.id, c.portador, hashesTarjeta[i]]
            );
            tarjeta = rows[0];
          } catch (e) {
            if (e.code !== '23505') throw e;
          }
        }
        if (!tarjeta) return { status: 500, body: { error: 'No se pudo generar un serial único de tarjeta.' } };

        camiones.push({
          lote: { id: lote.id, codigo: lote.codigo, en_movimiento: c.pasos.length > 0 },
          tarjeta: { id: tarjeta.id, serial: tarjeta.serial, portador: tarjeta.portador, clave: clavesTarjeta[i] },
          urls: { credencial: `/v/${tarjeta.serial}`, torre: `/torre/${lote.codigo}` },
        });
      }

      // Terminal torre (rol pos): misma tabla y login que el mostrador sicr3p.
      let torre = null;
      for (let intento = 0; intento < 5 && !torre; intento++) {
        try {
          const { rows } = await client.query(
            `INSERT INTO pos_terminales (nombre, ubicacion, serial, clave_hash)
             VALUES ($1,$2,$3,$4) RETURNING id, nombre, serial, activo`,
            [`Torre demo ${camiones[0].lote.codigo}`, 'Torre de control (demo)', generarSerial(), hashTorre]
          );
          torre = rows[0];
        } catch (e) {
          if (e.code !== '23505') throw e;
        }
      }
      if (!torre) return { status: 500, body: { error: 'No se pudo generar un serial único de terminal.' } };

      return {
        status: 201,
        body: {
          camiones,
          torre: { id: torre.id, serial: torre.serial, nombre: torre.nombre, clave: claveTorre },
          urls: { flota: '/torre' },
        },
      };
    });

    if (resultado.status === 201) {
      await logActividad({
        usuarioId: req.user.sub, accion: 'crear_demo_torre', entidad: 'lote_mineral',
        entidadId: resultado.body.camiones[0].lote.id,
        detalle: {
          lotes: resultado.body.camiones.map((x) => x.lote.codigo),
          torre: resultado.body.torre.serial,
        },
        ip: req.ip,
      });
    }
    res.status(resultado.status).json(resultado.body);
  } catch (err) { next(err); }
});

// ============================================================
// Router del PORTADOR de la tarjeta de viaje — montado SIN requireAuth
// de admin en /api/tarjeta. La tarjeta abre el pasaporte a cualquiera
// (solo lectura); registrar un paso exige la clave entregada junto con
// la tarjeta (decisión del usuario: sin registros anónimos).
// ============================================================
export const tarjetaRouter = express.Router();

const MENSAJE_TARJETA = 'Serial o clave incorrectos';

// POST /api/tarjeta/auth — login del portador (patrón login POS).
tarjetaRouter.post('/auth', loginLimiter, async (req, res, next) => {
  try {
    const { serial, clave } = req.body || {};
    if (!serial || !clave) return res.status(401).json({ error: MENSAJE_TARJETA });
    const { rows } = await query(
      `SELECT t.*, l.codigo AS lote_codigo, l.estado AS lote_estado
       FROM tarjetas_viaje t LEFT JOIN lotes_minerales l ON l.id = t.lote_id
       WHERE t.serial = $1`,
      [String(serial).trim().toUpperCase()]
    );
    const tarjeta = rows[0];
    if (!tarjeta || !tarjeta.activo || !tarjeta.lote_id) return res.status(401).json({ error: MENSAJE_TARJETA });
    const ok = await bcrypt.compare(String(clave), tarjeta.clave_hash);
    if (!ok) return res.status(401).json({ error: MENSAJE_TARJETA });

    await query(`UPDATE tarjetas_viaje SET ultima_actividad = now() WHERE id = $1`, [tarjeta.id]);
    await logActividad({ accion: 'tarjeta_login', entidad: 'tarjeta_viaje', entidadId: tarjeta.id, ip: req.ip });
    res.json({
      tarjeta: { serial: tarjeta.serial, portador: tarjeta.portador, lote_codigo: tarjeta.lote_codigo },
      token: signAccess({ id: tarjeta.id, rol: 'tarjeta', email: null }),
    });
  } catch (err) { next(err); }
});

// POST /api/tarjeta/paso — el portador registra un paso en ruta.
// Entra como eslabón 'transporte' sellado en la cadena del lote: la
// secuencia de pasos ES la ruta (sin GPS).
tarjetaRouter.post('/paso', requireAuth, requireRole('tarjeta'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const resultado = await withTx(async (client) => {
      const { rows: tRows } = await client.query(
        `SELECT * FROM tarjetas_viaje WHERE id = $1 AND activo = true`, [req.user.sub]
      );
      const tarjeta = tRows[0];
      if (!tarjeta || !tarjeta.lote_id) return { status: 404, body: { error: 'Tarjeta inválida o sin lote asignado' } };

      const { rows: lRows } = await client.query(
        `SELECT * FROM lotes_minerales WHERE id = $1 FOR UPDATE`, [tarjeta.lote_id]
      );
      const lote = lRows[0];
      if (!lote) return { status: 404, body: { error: 'Lote no encontrado' } };

      // punto_id: identificador opcional de un punto del catálogo del
      // corredor (frontend/src/lib/corredor.js) — con él la torre de
      // control ubica el paso en el mapa. Dato declarativo del actor,
      // como punto_control; el servidor solo lo sanea a slug.
      const puntoId = sanearPuntoId(b.punto_id);
      const r = await anexarEslabonTx(client, lote, {
        rol: 'transporte',
        pais: b.pais || 'CL',
        fecha: b.fecha || new Date().toISOString().slice(0, 10),
        nombre_empresa: b.nombre_empresa || tarjeta.portador || null,
        co2e_aportado: 0,
        visibilidad: 'publico',
        datos: {
          punto_control: String(b.punto_control || '').slice(0, 120) || null,
          ...(puntoId ? { punto_id: puntoId } : {}),
          tarjeta_serial: tarjeta.serial,
        },
      });
      if (r.status === 201) {
        await client.query(
          `UPDATE tarjetas_viaje SET pasos_registrados = pasos_registrados + 1, ultima_actividad = now() WHERE id = $1`,
          [tarjeta.id]
        );
      }
      return r;
    });

    if (resultado.status === 201) {
      await logActividad({
        accion: 'tarjeta_paso', entidad: 'lote_eslabon', entidadId: resultado.body.eslabon.id,
        detalle: { eslabon: resultado.body.eslabon.eslabon, punto: b.punto_control || null }, ip: req.ip,
      });
    }
    res.status(resultado.status).json(resultado.body);
  } catch (err) { next(err); }
});

// ============================================================
// Router de la CREDENCIAL DE FIRMA DEL PROVEEDOR — montado SIN
// requireAuth de admin en /api/firma-proveedor. NO es firma electrónica
// legal (Ley N° 19.799): es una atestación sellada por hash, con
// identidad FIJADA por quien emitió la credencial — nunca declarada por
// el firmante. Válida para UN SOLO eslabón (firmado_at + eslabon_id,
// migración 038).
// ============================================================
export const firmaProveedorRouter = express.Router();

const MENSAJE_FIRMA = 'Serial o clave incorrectos';

// POST /api/firma-proveedor/auth — login del proveedor (patrón login POS/tarjeta).
firmaProveedorRouter.post('/auth', loginLimiter, async (req, res, next) => {
  try {
    const { serial, clave } = req.body || {};
    if (!serial || !clave) return res.status(401).json({ error: MENSAJE_FIRMA });
    const { rows } = await query(
      `SELECT c.*, l.codigo AS lote_codigo, l.estado AS lote_estado
       FROM credenciales_proveedor c JOIN lotes_minerales l ON l.id = c.lote_id
       WHERE c.serial = $1`,
      [String(serial).trim().toUpperCase()]
    );
    const cred = rows[0];
    if (!cred || !cred.activo) return res.status(401).json({ error: MENSAJE_FIRMA });
    const ok = await bcrypt.compare(String(clave), cred.clave_hash);
    if (!ok) return res.status(401).json({ error: MENSAJE_FIRMA });
    if (cred.firmado_at) return res.status(409).json({ error: 'Esta credencial ya firmó un documento: es de un solo uso.' });
    if (cred.lote_estado !== 'abierto') return res.status(409).json({ error: 'El lote ya está cerrado.' });

    await logActividad({ accion: 'firma_proveedor_login', entidad: 'credencial_proveedor', entidadId: cred.id, ip: req.ip });
    res.json({
      credencial: { serial: cred.serial, nombre_empresa: cred.nombre_empresa, lote_codigo: cred.lote_codigo },
      token: signAccess({ id: cred.id, rol: 'firma_proveedor', email: null }),
    });
  } catch (err) { next(err); }
});

// POST /api/firma-proveedor/firmar — la atestación en sí: crea el eslabón
// (rol 'proveedor' o 'puerto', según lo fijado al emitir la credencial)
// con la identidad de la CREDENCIAL (nunca del body) y agota la
// credencial en la misma transacción.
firmaProveedorRouter.post('/firmar', requireAuth, requireRole('firma_proveedor'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const resultado = await withTx(async (client) => {
      const { rows: cRows } = await client.query(
        `SELECT * FROM credenciales_proveedor WHERE id = $1 AND activo = true FOR UPDATE`, [req.user.sub]
      );
      const cred = cRows[0];
      if (!cred) return { status: 404, body: { error: 'Credencial inválida o inactiva' } };
      if (cred.firmado_at) return { status: 409, body: { error: 'Esta credencial ya firmó un documento: es de un solo uso.' } };

      const { rows: lRows } = await client.query(
        `SELECT * FROM lotes_minerales WHERE id = $1 FOR UPDATE`, [cred.lote_id]
      );
      const lote = lRows[0];
      if (!lote) return { status: 404, body: { error: 'Lote no encontrado' } };

      const r = await anexarEslabonTx(client, lote, {
        rol: cred.rol,                        // 'proveedor' | 'puerto' — fijado al emitir la credencial
        rut_empresa: cred.rut_empresa,        // identidad de la CREDENCIAL, no del body
        nombre_empresa: cred.nombre_empresa,  // ídem
        pais: b.pais || 'CL',
        fecha: b.fecha || new Date().toISOString().slice(0, 10),
        cantidad: b.cantidad,
        co2e_aportado: b.co2e_aportado ?? 0,
        visibilidad: b.visibilidad || 'publico',
        datos: {
          ...(b.datos || {}),
          credencial_serial: cred.serial,
          atestacion: true,
          // punto_id viene SOLO de la credencial (fijado por el emisor) —
          // nunca del body del firmante — así el actor Puerto puede
          // encontrar este eslabón por su propio punto (routes/puerto.js).
          ...(cred.rol === 'puerto' && cred.punto_id ? { punto_id: cred.punto_id } : {}),
        },
      });
      if (r.status === 201) {
        await client.query(
          `UPDATE credenciales_proveedor SET firmado_at = now(), eslabon_id = $2 WHERE id = $1`,
          [cred.id, r.body.eslabon.id]
        );
      }
      return r;
    });

    if (resultado.status === 201) {
      await logActividad({
        accion: 'firma_proveedor_firmar', entidad: 'lote_eslabon', entidadId: resultado.body.eslabon.id,
        detalle: { eslabon: resultado.body.eslabon.eslabon }, ip: req.ip,
      });
    }
    res.status(resultado.status).json(resultado.body);
  } catch (err) { next(err); }
});

// ============================================================
// Router del PANEL DE PROVEEDOR PERSISTENTE — montado en
// /api/panel-proveedor con requireAuth + requireHomePanel('proveedor')
// (migración 062, login FIDO2 de la Fase 1). A diferencia de
// firmaProveedorRouter (arriba: credencial serial+clave de un solo uso),
// acá el proveedor es una cuenta estable que puede tener varias
// asignaciones (proveedor_lotes) vivas a la vez, una por lote. Ambos
// caminos convergen en el mismo anexarEslabonTx.
// ============================================================
export const proveedorPanelRouter = express.Router();
proveedorPanelRouter.use(requireAuth, requireHomePanel('proveedor'));

// GET /api/panel-proveedor/lotes — asignaciones del proveedor logueado,
// separadas en pendientes (aún no firma) y firmadas.
proveedorPanelRouter.get('/lotes', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT pl.id AS asignacion_id, pl.activo, pl.firmado_at, pl.eslabon_id, pl.created_at,
              l.id AS lote_id, l.codigo, l.tipo, l.material, l.cantidad, l.unidad, l.estado
       FROM proveedor_lotes pl JOIN lotes_minerales l ON l.id = pl.lote_id
       WHERE pl.proveedor_id = $1
       ORDER BY pl.created_at DESC`,
      [req.user.proveedor_id]
    );
    res.json({
      pendientes: rows.filter((r) => !r.firmado_at),
      firmadas: rows.filter((r) => r.firmado_at),
    });
  } catch (err) { next(err); }
});

// POST /api/panel-proveedor/lotes/:asignacionId/firmar — la identidad
// SIEMPRE sale de la fila `proveedores` (rut/nombre_empresa), nunca del
// body: el firmante no puede declarar quién es, igual que el camino viejo.
proveedorPanelRouter.post('/lotes/:asignacionId/firmar', requireNivelOperador, async (req, res, next) => {
  try {
    const b = req.body || {};
    const resultado = await withTx(async (client) => {
      const { rows: aRows } = await client.query(
        `SELECT * FROM proveedor_lotes WHERE id = $1 AND proveedor_id = $2 FOR UPDATE`,
        [req.params.asignacionId, req.user.proveedor_id]
      );
      const asignacion = aRows[0];
      if (!asignacion) return { status: 404, body: { error: 'Asignación no encontrada' } };
      if (!asignacion.activo) return { status: 409, body: { error: 'Esta asignación está inactiva.' } };
      if (asignacion.firmado_at) return { status: 409, body: { error: 'Ya firmaste este lote.' } };

      const { rows: pRows } = await client.query(`SELECT * FROM proveedores WHERE id = $1`, [req.user.proveedor_id]);
      const proveedor = pRows[0];
      if (!proveedor || !proveedor.activo) return { status: 403, body: { error: 'Cuenta de proveedor inactiva.' } };

      const { rows: lRows } = await client.query(
        `SELECT * FROM lotes_minerales WHERE id = $1 FOR UPDATE`, [asignacion.lote_id]
      );
      const lote = lRows[0];
      if (!lote) return { status: 404, body: { error: 'Lote no encontrado' } };
      if (lote.estado !== 'abierto') return { status: 409, body: { error: 'El lote está cerrado.' } };

      const r = await anexarEslabonTx(client, lote, {
        rol: 'proveedor',
        rut_empresa: proveedor.rut,           // identidad de PROVEEDORES, nunca del body
        nombre_empresa: proveedor.nombre_empresa,
        pais: b.pais || 'CL',
        fecha: b.fecha || new Date().toISOString().slice(0, 10),
        cantidad: b.cantidad,
        co2e_aportado: b.co2e_aportado ?? 0,
        visibilidad: b.visibilidad || 'publico',
        datos: { ...(b.datos || {}), proveedor_id: proveedor.id },
      });
      if (r.status === 201) {
        await client.query(
          `UPDATE proveedor_lotes SET firmado_at = now(), eslabon_id = $2 WHERE id = $1`,
          [asignacion.id, r.body.eslabon.id]
        );
        await client.query(`UPDATE proveedores SET ultimo_uso = now() WHERE id = $1`, [proveedor.id]);
      }
      return r;
    });

    if (resultado.status === 201) {
      await logActividad({
        usuarioId: req.user.sub, accion: 'proveedor_firmar', entidad: 'lote_eslabon',
        entidadId: resultado.body.eslabon.id,
        detalle: { eslabon: resultado.body.eslabon.eslabon, asignacion_id: req.params.asignacionId }, ip: req.ip,
      });
    }
    res.status(resultado.status).json(resultado.body);
  } catch (err) { next(err); }
});

export default router;
