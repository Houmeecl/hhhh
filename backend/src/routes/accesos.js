import express from 'express';
import crypto from 'crypto';
import { query } from '../lib/db.js';
import { requireAuth, requireRole, requireHomePanel, requireSeccion, logActividad } from '../middleware/auth.js';
import { hashApiKey, normalizarRut, webhookUrlValida } from '../services/mandante.js';
import { sanearPuntoId, validarIdentidadProveedor } from '../services/pasaporteOrigen.js';
import { crearCuentaEntidad, enviarActivacion } from '../services/cuentas.js';
import { qrBufferDe, reciclarUrl } from '../services/qr.js';

// ============================================================
// Administración de accesos externos:
//  - MANDANTES (API keys para consultar proveedores)
//  - CÓDIGOS DE ACCESO con créditos (mini sitio de prueba)
// ============================================================

const router = express.Router();
router.use(requireAuth, requireHomePanel('sicrep'));
const adminOnly = requireRole('admin');
const hashToken = hashApiKey; // misma función que verifica routes/mandante.js — no pueden desincronizarse

// crearCuentaEntidad(): ver services/cuentas.js — compartida con
// admin.js POST /usuarios (alta unificada de cuentas de los 5 paneles
// externos).

// ---------- MANDANTES ----------
router.get('/mandantes', requireSeccion('accesos_externos'), async (req, res, next) => {
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
// Nace como OPERADOR, igual que puerto/trazador/agencia/proveedor: el alta
// ya no deja cuentas a medias que después hay que habilitar a mano desde
// «Usuarios y roles». Bajar una cuenta a solo lectura sigue disponible ahí.
router.post('/mandantes/:id/crear-cuenta', requireSeccion('accesos_externos'), adminOnly, (req, res, next) =>
  crearCuentaEntidad({ req, res, panel: 'mandante', columnaFk: 'mandante_id', entidadId: req.params.id, nivelAcceso: 'operador' }).catch(next)
);

router.post('/mandantes', requireSeccion('accesos_externos'), adminOnly, async (req, res, next) => {
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

router.put('/mandantes/:id', requireSeccion('accesos_externos'), adminOnly, async (req, res, next) => {
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
router.get('/mandantes/:id/proveedores', requireSeccion('accesos_externos'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM mandante_proveedores WHERE mandante_id = $1 ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json({ proveedores: rows });
  } catch (err) { next(err); }
});

router.post('/mandantes/:id/proveedores', requireSeccion('accesos_externos'), adminOnly, async (req, res, next) => {
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

router.delete('/mandantes/:id/proveedores/:proveedorId', requireSeccion('accesos_externos'), adminOnly, async (req, res, next) => {
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
router.get('/puertos', requireSeccion('accesos_externos'), async (req, res, next) => {
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
router.post('/puertos/:id/crear-cuenta', requireSeccion('accesos_externos'), adminOnly, (req, res, next) =>
  crearCuentaEntidad({ req, res, panel: 'puerto', columnaFk: 'puerto_id', entidadId: req.params.id, nivelAcceso: 'operador' }).catch(next)
);

router.post('/puertos', requireSeccion('accesos_externos'), adminOnly, async (req, res, next) => {
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

router.put('/puertos/:id', requireSeccion('accesos_externos'), adminOnly, async (req, res, next) => {
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
router.get('/agencias', requireSeccion('accesos_externos'), async (req, res, next) => {
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
router.post('/agencias/:id/crear-cuenta', requireSeccion('accesos_externos'), adminOnly, (req, res, next) =>
  crearCuentaEntidad({ req, res, panel: 'agencia', columnaFk: 'agencia_id', entidadId: req.params.id }).catch(next)
);

router.post('/agencias', requireSeccion('accesos_externos'), adminOnly, async (req, res, next) => {
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

router.put('/agencias/:id', requireSeccion('accesos_externos'), adminOnly, async (req, res, next) => {
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

// ---------- TRAZADORES (panel /panel-trazador — búsqueda de RUT en lista blanca) ----------
// Dos caminos de acceso, igual que puerto/mandante/agencia (migración 060):
// login humano (cuenta web) o X-Api-Key para un socio cuyo propio sistema
// integra (ej. Kontax). A diferencia de puerto/agencia, la key es OPCIONAL:
// un trazador puede seguir existiendo solo como cuenta humana. Su acceso a
// datos SIEMPRE depende de trazador_ruts — sin filas ahí, no ve ningún RUT
// (nunca "todos").
router.get('/trazadores', requireSeccion('accesos_externos'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT t.id, t.nombre, t.activo, t.ultimo_uso, t.created_at,
              (t.token_hash IS NOT NULL) AS tiene_api_key,
              (u.id IS NOT NULL) AS tiene_cuenta_web
       FROM trazadores t LEFT JOIN usuarios u ON u.trazador_id = t.id
       ORDER BY t.created_at DESC`
    );
    res.json({ trazadores: rows });
  } catch (err) { next(err); }
});

// Acceso web propio del trazador (panel /panel-trazador).
router.post('/trazadores/:id/crear-cuenta', requireSeccion('accesos_externos'), adminOnly, (req, res, next) =>
  crearCuentaEntidad({ req, res, panel: 'trazador', columnaFk: 'trazador_id', entidadId: req.params.id, nivelAcceso: 'operador' }).catch(next)
);

// Genera (o rota) la API key del trazador — se muestra UNA sola vez. Solo
// se usa cuando el trazador integra un sistema propio (ej. Kontax); no es
// obligatoria para el resto, que sigue entrando solo con su cuenta web.
router.post('/trazadores/:id/generar-api-key', requireSeccion('accesos_externos'), adminOnly, async (req, res, next) => {
  try {
    const token = `trz_${crypto.randomBytes(24).toString('base64url')}`;
    const { rows } = await query(
      `UPDATE trazadores SET token_hash = $1 WHERE id = $2 RETURNING id, nombre`,
      [hashToken(token), req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Trazador no encontrado' });
    await logActividad({ usuarioId: req.user.sub, accion: 'generar_api_key_trazador', entidad: 'trazador', entidadId: rows[0].id, ip: req.ip });
    res.json({ trazador: rows[0], token });
  } catch (err) { next(err); }
});

router.post('/trazadores', requireSeccion('accesos_externos'), adminOnly, async (req, res, next) => {
  try {
    const { nombre } = req.body || {};
    if (!nombre) return res.status(400).json({ error: 'Nombre es obligatorio.' });
    const { rows } = await query(
      `INSERT INTO trazadores (nombre) VALUES ($1)
       RETURNING id, nombre, activo, created_at`,
      [nombre]
    );
    await logActividad({ usuarioId: req.user.sub, accion: 'crear_trazador', entidad: 'trazador', entidadId: rows[0].id, ip: req.ip });
    res.status(201).json({ trazador: rows[0] });
  } catch (err) { next(err); }
});

router.put('/trazadores/:id', requireSeccion('accesos_externos'), adminOnly, async (req, res, next) => {
  try {
    const { activo } = req.body || {};
    const { rows } = await query(
      `UPDATE trazadores SET activo = COALESCE($2, activo) WHERE id = $1
       RETURNING id, nombre, activo`,
      [req.params.id, typeof activo === 'boolean' ? activo : null]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Trazador no encontrado' });
    res.json({ trazador: rows[0] });
  } catch (err) { next(err); }
});

// ---------- Lista blanca de RUT del trazador ----------
router.get('/trazadores/:id/ruts', requireSeccion('accesos_externos'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM trazador_ruts WHERE trazador_id = $1 ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json({ ruts: rows });
  } catch (err) { next(err); }
});

router.post('/trazadores/:id/ruts', requireSeccion('accesos_externos'), adminOnly, async (req, res, next) => {
  try {
    const rut = normalizarRut(req.body.rut);
    if (!rut) return res.status(400).json({ error: 'RUT obligatorio.' });
    const { rows } = await query(
      `INSERT INTO trazador_ruts (trazador_id, rut)
       VALUES ($1,$2)
       ON CONFLICT (trazador_id, rut) DO UPDATE SET activo = true
       RETURNING *`,
      [req.params.id, rut]
    );
    await logActividad({ usuarioId: req.user.sub, accion: 'agregar_rut_trazador', entidad: 'trazador_rut', entidadId: rows[0].id, ip: req.ip });
    res.status(201).json({ rut: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/trazadores/:id/ruts/:rutId', requireSeccion('accesos_externos'), adminOnly, async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `DELETE FROM trazador_ruts WHERE id = $1 AND trazador_id = $2`,
      [req.params.rutId, req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'RUT no encontrado' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------- PROVEEDORES (panel /panel-proveedor — firma FIDO2 de lotes tipo 'producto') ----------
// Entidad persistente (migración 062): a diferencia de credenciales_proveedor
// (serial+clave de un solo uso, migración 038, que sigue viva sin cambios),
// un proveedor acá tiene una identidad estable contra la cual registrar su
// llave FIDO2 y firmar N lotes en el tiempo. La autorización de qué lote
// puede firmar vive en proveedor_lotes (routes/origen.js), no acá.
router.get('/proveedores', requireSeccion('accesos_externos', 'proveedores'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT p.id, p.nombre_empresa, p.rut, p.activo, p.ultimo_uso, p.created_at,
              (u.id IS NOT NULL) AS tiene_cuenta_web
       FROM proveedores p LEFT JOIN usuarios u ON u.proveedor_id = p.id
       ORDER BY p.created_at DESC`
    );
    res.json({ proveedores: rows });
  } catch (err) { next(err); }
});

// Acceso web propio del proveedor (panel /panel-proveedor). enviarCorreo:
// al proveedor le llega un mail con enlace para ingresar y definir su clave
// (además del password temporal que ve el admin como respaldo).
//
// El enrolamiento en un paso (admin/Enrolar.jsx) manda solo el correo: el
// nombre de la PERSONA de contacto todavía no se conoce — la empresa lo
// completa después en su onboarding (representante). Como respaldo se usa la
// razón social, que sí está desde que se creó la empresa; sin esto el
// enrolamiento moría con "Email y nombre son obligatorios" y la invitación
// nunca salía.
router.post('/proveedores/:id/crear-cuenta', requireSeccion('accesos_externos', 'enrolar', 'proveedores'), adminOnly, async (req, res, next) => {
  try {
    const { rows } = await query('SELECT nombre_empresa FROM proveedores WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Proveedor no encontrado.' });
    await crearCuentaEntidad({
      req, res, panel: 'proveedor', columnaFk: 'proveedor_id', entidadId: req.params.id,
      enviarCorreo: true, nombrePorDefecto: rows[0].nombre_empresa,
    });
  } catch (err) { next(err); }
});

// Reenvía la invitación a una empresa que YA tiene su acceso web creado —
// el caso más común en la práctica: el correo se perdió, cayó en spam o la
// persona que lo recibió ya no está. Sin esto, enrolar de nuevo devolvía
// "Esta entidad ya tiene un acceso web creado" y el admin quedaba sin salida.
//
// El enlace se manda SIEMPRE al correo registrado de la cuenta, nunca al que
// venga en el request: reenviar no puede ser una forma de redirigir el acceso
// de una empresa a otra casilla.
router.post('/proveedores/:id/reenviar-invitacion', requireSeccion('accesos_externos', 'enrolar', 'proveedores'), adminOnly, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, email, nombre, estado FROM usuarios WHERE proveedor_id = $1 AND panel = 'proveedor'`,
      [req.params.id]
    );
    const usuario = rows[0];
    if (!usuario) return res.status(404).json({ error: 'Esta empresa todavía no tiene un acceso web creado.' });
    // Una cuenta suspendida NO se reactiva por esta vía: activar define
    // contraseña y deja `estado='activo'` (routes/auth.js), así que reenviar
    // sería deshacer la suspensión de rebote. Se rechaza diciendo lo que
    // realmente pasa — antes el filtro por estado vivía en el WHERE y esto
    // caía en el 404 de arriba, que le mentía al admin.
    if (usuario.estado !== 'activo') {
      return res.status(409).json({
        codigo: 'cuenta_no_activa',
        error: `El acceso de esta empresa está en estado "${usuario.estado}". Reactívalo antes de reenviarle la invitación.`,
      });
    }

    const correo = await enviarActivacion({
      usuarioId: usuario.id, email: usuario.email, nombre: usuario.nombre, panel: 'proveedor',
    });
    await logActividad({
      usuarioId: req.user.sub, accion: 'reenviar_invitacion_proveedor', entidad: 'usuario',
      entidadId: usuario.id, detalle: { email: usuario.email }, ip: req.ip,
    });
    res.json({
      ok: true, email: usuario.email,
      correo_enviado: correo.correoEnviado, dev_activation_link: correo.dev_activation_link,
    });
  } catch (err) { next(err); }
});

router.post('/proveedores', requireSeccion('accesos_externos', 'proveedores'), adminOnly, async (req, res, next) => {
  try {
    // El formulario de esta pestaña usa el mismo nombre de campo que
    // Mandantes/Agencias/Trazadores más arriba en este archivo (`rut`,
    // no `rut_empresa`) — validarIdentidadProveedor se escribió para el
    // flujo de credenciales_proveedor, que sí usa `rut_empresa`.
    const val = validarIdentidadProveedor({ rut_empresa: req.body.rut, nombre_empresa: req.body.nombre_empresa });
    if (!val.ok) return res.status(400).json({ error: val.errores.join(' ') });
    const nombreEmpresa = String(req.body.nombre_empresa || '').trim();
    let proveedor;
    try {
      const { rows } = await query(
        `INSERT INTO proveedores (nombre_empresa, rut) VALUES ($1,$2)
         RETURNING id, nombre_empresa, rut, activo, created_at`,
        [nombreEmpresa, val.rut_normalizado]
      );
      proveedor = rows[0];
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'Ya existe un proveedor con ese RUT.' });
      throw e;
    }
    await logActividad({ usuarioId: req.user.sub, accion: 'crear_proveedor', entidad: 'proveedor', entidadId: proveedor.id, ip: req.ip });
    res.status(201).json({ proveedor });
  } catch (err) { next(err); }
});

router.put('/proveedores/:id', requireSeccion('accesos_externos', 'proveedores'), adminOnly, async (req, res, next) => {
  try {
    const { activo } = req.body || {};
    const { rows } = await query(
      `UPDATE proveedores SET activo = COALESCE($2, activo) WHERE id = $1
       RETURNING id, nombre_empresa, rut, activo`,
      [req.params.id, typeof activo === 'boolean' ? activo : null]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Proveedor no encontrado' });
    res.json({ proveedor: rows[0] });
  } catch (err) { next(err); }
});

// ---------- CÓDIGOS DE ACCESO (créditos) ----------
router.get('/codigos', requireSeccion('accesos_externos'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM codigos_acceso ORDER BY created_at DESC LIMIT 300`
    );
    res.json({ codigos: rows });
  } catch (err) { next(err); }
});

router.post('/codigos', requireSeccion('accesos_externos'), adminOnly, async (req, res, next) => {
  try {
    const n = Math.min(50, Math.max(1, Number(req.body.cantidad) || 1));
    const creditos = Math.min(100, Math.max(1, Number(req.body.creditos) || 5));
    const { empresa, email } = req.body;
    // "Sube y Suma": un código de campaña gamificada es un codigos_acceso
    // normal (mismo cupo/validación de créditos) con este flag en true —
    // habilita el magic link con rol 'jugador' (ver auth.js).
    const modoJuego = req.body.modo_juego === true;
    const creados = [];
    for (let i = 0; i < n; i++) {
      const codigo = `SICR3P-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const { rows } = await query(
        `INSERT INTO codigos_acceso (codigo, creditos, empresa, email, modo_juego)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [codigo, creditos, empresa || null, email || null, modoJuego]
      );
      creados.push(rows[0]);
    }
    await logActividad({ usuarioId: req.user.sub, accion: 'crear_codigos', entidad: 'codigo_acceso', entidadId: String(n), ip: req.ip });
    res.status(201).json({ codigos: creados });
  } catch (err) { next(err); }
});

router.put('/codigos/:id', requireSeccion('accesos_externos'), adminOnly, async (req, res, next) => {
  try {
    const { activo, creditos, modo_juego: modoJuego } = req.body;
    const { rows } = await query(
      `UPDATE codigos_acceso SET
         activo = COALESCE($2, activo),
         creditos = COALESCE($3, creditos),
         modo_juego = COALESCE($4, modo_juego)
       WHERE id = $1 RETURNING *`,
      [req.params.id, typeof activo === 'boolean' ? activo : null,
       creditos != null ? Number(creditos) : null,
       typeof modoJuego === 'boolean' ? modoJuego : null]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Código no encontrado' });
    res.json({ codigo: rows[0] });
  } catch (err) { next(err); }
});

// ---------- PUNTOS LIMPIOS ("Sube y Suma" — reciclaje de envases) ----------
// Lugares de entrega de envases con cartel QR imprimible. codigo_id NULL =
// el punto vale para todas las campañas; con valor, solo para los jugadores
// de esa campaña. lat/lng opcionales: con coordenadas el registro exige
// cercanía; sin ellas, solo el QR.

// Coordenadas del formulario admin: vienen en pareja o no vienen.
function parLatLng(lat, lng) {
  if (lat == null || lat === '' || lng == null || lng === '') return { lat: null, lng: null };
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
  return { lat: la, lng: ln };
}

router.get('/puntos-limpios', requireSeccion('accesos_externos'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT pl.*, ca.codigo AS campana_codigo, ca.empresa AS campana_empresa,
              (SELECT COUNT(*)::int FROM reciclajes r WHERE r.punto_limpio_id = pl.id) AS n_entregas
       FROM puntos_limpios pl LEFT JOIN codigos_acceso ca ON ca.id = pl.codigo_id
       ORDER BY pl.created_at DESC`
    );
    res.json({ puntos: rows });
  } catch (err) { next(err); }
});

router.post('/puntos-limpios', requireSeccion('accesos_externos'), adminOnly, async (req, res, next) => {
  try {
    const { nombre, direccion, lat, lng, codigo_id } = req.body || {};
    if (!nombre || !String(nombre).trim()) return res.status(400).json({ error: 'Nombre es obligatorio.' });
    const coords = parLatLng(lat, lng);
    if (!coords) return res.status(400).json({ error: 'Latitud/longitud inválidas (van en pareja, en grados decimales).' });
    const token = `pl_${crypto.randomBytes(9).toString('base64url')}`;
    const { rows } = await query(
      `INSERT INTO puntos_limpios (nombre, direccion, lat, lng, token, codigo_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [String(nombre).trim(), direccion || null, coords.lat, coords.lng, token, codigo_id || null]
    );
    await logActividad({ usuarioId: req.user.sub, accion: 'crear_punto_limpio', entidad: 'punto_limpio', entidadId: rows[0].id, ip: req.ip });
    res.status(201).json({ punto: rows[0] });
  } catch (err) { next(err); }
});

router.put('/puntos-limpios/:id', requireSeccion('accesos_externos'), adminOnly, async (req, res, next) => {
  try {
    const { nombre, direccion, lat, lng, activo } = req.body || {};
    const coords = lat !== undefined || lng !== undefined ? parLatLng(lat, lng) : undefined;
    if (coords === null) return res.status(400).json({ error: 'Latitud/longitud inválidas (van en pareja, en grados decimales).' });
    const { rows } = await query(
      `UPDATE puntos_limpios SET
         nombre = COALESCE($2, nombre),
         direccion = COALESCE($3, direccion),
         lat = CASE WHEN $4::boolean THEN $5 ELSE lat END,
         lng = CASE WHEN $4::boolean THEN $6 ELSE lng END,
         activo = COALESCE($7, activo)
       WHERE id = $1 RETURNING *`,
      [req.params.id, nombre || null, direccion || null,
       coords !== undefined, coords?.lat ?? null, coords?.lng ?? null,
       typeof activo === 'boolean' ? activo : null]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Punto limpio no encontrado' });
    res.json({ punto: rows[0] });
  } catch (err) { next(err); }
});

// Cartel QR imprimible (PNG grande). El QR codifica la URL de la pantalla
// Reciclar con el punto pre-seleccionado.
router.get('/puntos-limpios/:id/qr.png', requireSeccion('accesos_externos'), async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT token FROM puntos_limpios WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Punto limpio no encontrado' });
    res.type('png').send(await qrBufferDe(reciclarUrl(rows[0].token), 1024));
  } catch (err) { next(err); }
});

export default router;
