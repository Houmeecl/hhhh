import express from 'express';
import crypto from 'crypto';
import { query } from '../lib/db.js';
import { requireAuth, requireRole, requireHomePanel, logActividad } from '../middleware/auth.js';
import { hashApiKey, normalizarRut, webhookUrlValida } from '../services/mandante.js';
import { sanearPuntoId } from '../services/pasaporteOrigen.js';
import { enviarActivacion } from '../services/cuentas.js';

// ============================================================
// Administración de accesos externos:
//  - MANDANTES (API keys para consultar proveedores)
//  - CÓDIGOS DE ACCESO con créditos (mini sitio de prueba)
// ============================================================

const router = express.Router();
router.use(requireAuth, requireHomePanel('sicrep'));
const adminOnly = requireRole('admin');
const hashToken = hashApiKey; // misma función que verifica routes/mandante.js — no pueden desincronizarse

// Crea (o reintenta el envío de) el login web de un actor externo (puerto o
// mandante): una fila de `usuarios` atada a SU entidad vía puerto_id/
// mandante_id (migración 042) — reusa el mismo flujo de activación por
// correo que ya usan las cuentas sicrep/aduana_verde. Un solo login por
// entidad (UNIQUE parcial en la migración): reintentar con el mismo correo
// mientras siga "pendiente" no falla; un email distinto para una entidad
// que ya tiene cuenta sí falla con 409.
async function crearCuentaEntidad({ req, res, panel, columnaFk, entidadId }) {
  const email = String(req.body.email || '').toLowerCase().trim();
  const nombre = String(req.body.nombre || '').trim();
  if (!email || !nombre) return res.status(400).json({ error: 'Email y nombre son obligatorios.' });

  let rows;
  try {
    ({ rows } = await query(
      `INSERT INTO usuarios (email, nombre, rol, panel, ${columnaFk}, estado, must_reset_password)
       VALUES ($1,$2,'operador',$3,$4,'pendiente',true)
       ON CONFLICT (email) DO NOTHING RETURNING *`,
      [email, nombre, panel, entidadId]
    ));
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Esta entidad ya tiene un acceso web creado.' });
    throw e;
  }
  if (!rows[0]) {
    const { rows: existentes } = await query(`SELECT * FROM usuarios WHERE email = $1`, [email]);
    const existente = existentes[0];
    if (!existente || existente.estado !== 'pendiente' || existente[columnaFk] !== entidadId) {
      return res.status(409).json({ error: 'Ya existe un usuario con ese correo.' });
    }
    rows = [existente]; // pendiente: reintenta el envío en vez de bloquear.
  }

  const { correoEnviado, dev_activation_link } = await enviarActivacion({ usuarioId: rows[0].id, email, nombre, panel });
  await logActividad({
    usuarioId: req.user.sub, accion: `crear_cuenta_${panel}`, entidad: 'usuario',
    entidadId: rows[0].id, detalle: { correo_enviado: correoEnviado }, ip: req.ip,
  });
  res.status(201).json({ ok: true, usuario_id: rows[0].id, correo_enviado: correoEnviado, dev_activation_link });
}

// ---------- MANDANTES ----------
router.get('/mandantes', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT m.id, m.nombre_empresa, m.rut, m.email, m.activo, m.webhook_url, m.ultimo_uso, m.created_at,
              (u.id IS NOT NULL) AS tiene_cuenta_web
       FROM mandantes m LEFT JOIN usuarios u ON u.mandante_id = m.id
       ORDER BY m.created_at DESC`
    );
    res.json({ mandantes: rows });
  } catch (err) { next(err); }
});

// Acceso web propio del mandante (panel /panel-mandante) — distinto de la
// API key (X-Api-Key, integración de sistemas): esto es un login humano.
router.post('/mandantes/:id/crear-cuenta', adminOnly, (req, res, next) =>
  crearCuentaEntidad({ req, res, panel: 'mandante', columnaFk: 'mandante_id', entidadId: req.params.id }).catch(next)
);

router.post('/mandantes', adminOnly, async (req, res, next) => {
  try {
    const { nombre_empresa, rut, email } = req.body;
    if (!nombre_empresa || !rut) return res.status(400).json({ error: 'Empresa y RUT son obligatorios.' });
    // El token se muestra UNA sola vez; solo se guarda su hash.
    const token = `smk_${crypto.randomBytes(24).toString('base64url')}`;
    const { rows } = await query(
      `INSERT INTO mandantes (nombre_empresa, rut, email, token_hash)
       VALUES ($1,$2,$3,$4) RETURNING id, nombre_empresa, rut, email, activo, created_at`,
      [nombre_empresa, rut, email || null, hashToken(token)]
    );
    await logActividad({ usuarioId: req.user.sub, accion: 'crear_mandante', entidad: 'mandante', entidadId: rows[0].id, ip: req.ip });
    res.status(201).json({ mandante: rows[0], token });
  } catch (err) { next(err); }
});

router.put('/mandantes/:id', adminOnly, async (req, res, next) => {
  try {
    const { activo, webhook_url } = req.body;
    if (webhook_url && !webhookUrlValida(webhook_url)) {
      return res.status(400).json({ error: 'URL de webhook inválida (debe ser http/https pública).' });
    }
    const { rows } = await query(
      `UPDATE mandantes SET
         activo = COALESCE($2, activo),
         webhook_url = CASE WHEN $3::text IS NULL THEN webhook_url WHEN $3::text = '' THEN NULL ELSE $3 END
       WHERE id = $1
       RETURNING id, nombre_empresa, rut, activo, webhook_url`,
      [req.params.id, typeof activo === 'boolean' ? activo : null, webhook_url !== undefined ? webhook_url : null]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Mandante no encontrado' });
    res.json({ mandante: rows[0] });
  } catch (err) { next(err); }
});

// ---------- Permisos finos: proveedores permitidos por mandante ----------
// Lista blanca opcional: sin filas = el mandante ve todos los proveedores
// que le facturaron (comportamiento actual, sin cambios).
router.get('/mandantes/:id/proveedores', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM mandante_proveedores WHERE mandante_id = $1 ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json({ proveedores: rows });
  } catch (err) { next(err); }
});

router.post('/mandantes/:id/proveedores', adminOnly, async (req, res, next) => {
  try {
    const rut = normalizarRut(req.body.rut_proveedor);
    if (!rut) return res.status(400).json({ error: 'RUT de proveedor obligatorio.' });
    const { rows } = await query(
      `INSERT INTO mandante_proveedores (mandante_id, rut_proveedor)
       VALUES ($1,$2)
       ON CONFLICT (mandante_id, rut_proveedor) DO UPDATE SET activo = true
       RETURNING *`,
      [req.params.id, rut]
    );
    await logActividad({ usuarioId: req.user.sub, accion: 'agregar_proveedor_mandante', entidad: 'mandante_proveedor', entidadId: rows[0].id, ip: req.ip });
    res.status(201).json({ proveedor: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/mandantes/:id/proveedores/:proveedorId', adminOnly, async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `DELETE FROM mandante_proveedores WHERE id = $1 AND mandante_id = $2`,
      [req.params.proveedorId, req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Proveedor no encontrado' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------- PUERTOS (acceso de lectura completa por punto del Corredor) ----------
// A diferencia de mandantes (RUT receptor sobre facturas nacionales), un
// puerto se ancla a un punto_id del Corredor (catálogo PUNTOS_CORREDOR del
// frontend) — ver routes/puerto.js.
router.get('/puertos', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT p.id, p.nombre, p.punto_id, p.activo, p.ultimo_uso, p.created_at,
              (u.id IS NOT NULL) AS tiene_cuenta_web
       FROM puertos p LEFT JOIN usuarios u ON u.puerto_id = p.id
       ORDER BY p.created_at DESC`
    );
    res.json({ puertos: rows });
  } catch (err) { next(err); }
});

// Acceso web propio del puerto (panel /panel-puerto) — distinto de la API
// key (X-Api-Key, integración de sistemas): esto es un login humano.
router.post('/puertos/:id/crear-cuenta', adminOnly, (req, res, next) =>
  crearCuentaEntidad({ req, res, panel: 'puerto', columnaFk: 'puerto_id', entidadId: req.params.id }).catch(next)
);

router.post('/puertos', adminOnly, async (req, res, next) => {
  try {
    const { nombre, punto_id } = req.body || {};
    const puntoLimpio = sanearPuntoId(punto_id);
    if (!nombre || !puntoLimpio) return res.status(400).json({ error: 'Nombre y punto_id son obligatorios.' });
    // El token se muestra UNA sola vez; solo se guarda su hash (mismo patrón que mandantes).
    const token = `pto_${crypto.randomBytes(24).toString('base64url')}`;
    const { rows } = await query(
      `INSERT INTO puertos (nombre, punto_id, token_hash) VALUES ($1,$2,$3)
       RETURNING id, nombre, punto_id, activo, created_at`,
      [nombre, puntoLimpio, hashToken(token)]
    );
    await logActividad({ usuarioId: req.user.sub, accion: 'crear_puerto', entidad: 'puerto', entidadId: rows[0].id, ip: req.ip });
    res.status(201).json({ puerto: rows[0], token });
  } catch (err) { next(err); }
});

router.put('/puertos/:id', adminOnly, async (req, res, next) => {
  try {
    const { activo } = req.body || {};
    const { rows } = await query(
      `UPDATE puertos SET activo = COALESCE($2, activo) WHERE id = $1
       RETURNING id, nombre, punto_id, activo`,
      [req.params.id, typeof activo === 'boolean' ? activo : null]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Puerto no encontrado' });
    res.json({ puerto: rows[0] });
  } catch (err) { next(err); }
});

// ---------- AGENCIAS DE ADUANA (panel /panel-agencia — Pasaporte Bioceánico) ----------
// La agencia sigue realizando la tramitación oficial; sicr3p es su
// infraestructura documental/de trazabilidad — nunca se presenta como
// agencia de aduanas. Acceso por lotes tipo 'documental' scopeados a SU
// lotes_minerales.agencia_id (migración 046), no por punto_id como puerto.
router.get('/agencias', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT a.id, a.nombre, a.rut, a.activo, a.ultimo_uso, a.created_at,
              (u.id IS NOT NULL) AS tiene_cuenta_web
       FROM agencias_aduana a LEFT JOIN usuarios u ON u.agencia_id = a.id
       ORDER BY a.created_at DESC`
    );
    res.json({ agencias: rows });
  } catch (err) { next(err); }
});

// Acceso web propio de la agencia (panel /panel-agencia) — distinto de la
// API key (X-Api-Key, integración de sistemas): esto es un login humano.
router.post('/agencias/:id/crear-cuenta', adminOnly, (req, res, next) =>
  crearCuentaEntidad({ req, res, panel: 'agencia', columnaFk: 'agencia_id', entidadId: req.params.id }).catch(next)
);

router.post('/agencias', adminOnly, async (req, res, next) => {
  try {
    const { nombre, rut } = req.body || {};
    if (!nombre) return res.status(400).json({ error: 'Nombre es obligatorio.' });
    // El token se muestra UNA sola vez; solo se guarda su hash (mismo patrón que puertos/mandantes).
    const token = `agn_${crypto.randomBytes(24).toString('base64url')}`;
    const { rows } = await query(
      `INSERT INTO agencias_aduana (nombre, rut, token_hash) VALUES ($1,$2,$3)
       RETURNING id, nombre, rut, activo, created_at`,
      [nombre, rut || null, hashToken(token)]
    );
    await logActividad({ usuarioId: req.user.sub, accion: 'crear_agencia', entidad: 'agencia_aduana', entidadId: rows[0].id, ip: req.ip });
    res.status(201).json({ agencia: rows[0], token });
  } catch (err) { next(err); }
});

router.put('/agencias/:id', adminOnly, async (req, res, next) => {
  try {
    const { activo } = req.body || {};
    const { rows } = await query(
      `UPDATE agencias_aduana SET activo = COALESCE($2, activo) WHERE id = $1
       RETURNING id, nombre, rut, activo`,
      [req.params.id, typeof activo === 'boolean' ? activo : null]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Agencia no encontrada' });
    res.json({ agencia: rows[0] });
  } catch (err) { next(err); }
});

// ---------- CÓDIGOS DE ACCESO (créditos) ----------
router.get('/codigos', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM codigos_acceso ORDER BY created_at DESC LIMIT 300`
    );
    res.json({ codigos: rows });
  } catch (err) { next(err); }
});

router.post('/codigos', adminOnly, async (req, res, next) => {
  try {
    const n = Math.min(50, Math.max(1, Number(req.body.cantidad) || 1));
    const creditos = Math.min(100, Math.max(1, Number(req.body.creditos) || 5));
    const { empresa, email } = req.body;
    const creados = [];
    for (let i = 0; i < n; i++) {
      const codigo = `SICR3P-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const { rows } = await query(
        `INSERT INTO codigos_acceso (codigo, creditos, empresa, email)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [codigo, creditos, empresa || null, email || null]
      );
      creados.push(rows[0]);
    }
    await logActividad({ usuarioId: req.user.sub, accion: 'crear_codigos', entidad: 'codigo_acceso', entidadId: String(n), ip: req.ip });
    res.status(201).json({ codigos: creados });
  } catch (err) { next(err); }
});

router.put('/codigos/:id', adminOnly, async (req, res, next) => {
  try {
    const { activo, creditos } = req.body;
    const { rows } = await query(
      `UPDATE codigos_acceso SET
         activo = COALESCE($2, activo),
         creditos = COALESCE($3, creditos)
       WHERE id = $1 RETURNING *`,
      [req.params.id, typeof activo === 'boolean' ? activo : null,
       creditos != null ? Number(creditos) : null]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Código no encontrado' });
    res.json({ codigo: rows[0] });
  } catch (err) { next(err); }
});

export default router;
