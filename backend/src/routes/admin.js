import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { config } from '../config.js';
import { query } from '../lib/db.js';
import { requireAuth, requireRole, logActividad } from '../middleware/auth.js';
import { simpleApi } from '../services/simpleApi.js';
import { sendMail, activationEmail } from '../services/mailer.js';

const router = express.Router();
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

// Todas las rutas de admin requieren sesión.
router.use(requireAuth);
const adminOnly = requireRole('admin');

// ============================================================
// DASHBOARD
// ============================================================
router.get('/dashboard', async (req, res, next) => {
  try {
    const [clientes, sesionesMes, facturasMes, co2eAcum, ping, uso] = await Promise.all([
      query(`SELECT estado_contrato, count(*)::int AS n FROM clientes GROUP BY estado_contrato`),
      query(`SELECT count(*)::int AS n FROM sesiones WHERE date_trunc('month', created_at) = date_trunc('month', now())`),
      query(`SELECT count(*)::int AS n FROM facturas WHERE date_trunc('month', created_at) = date_trunc('month', now())`),
      query(`SELECT COALESCE(sum(total_co2e),0)::float AS total FROM sesiones`),
      simpleApi.ping(),
      query(`SELECT count(*)::int AS llamadas, COALESCE(sum(costo_estimado),0)::float AS costo
             FROM simple_api_uso WHERE date_trunc('month', created_at) = date_trunc('month', now())`),
    ]);
    const porEstado = { piloto: 0, activo: 0, vencido: 0 };
    for (const r of clientes.rows) porEstado[r.estado_contrato] = r.n;
    res.json({
      clientes_por_estado: porEstado,
      sesiones_mes: sesionesMes.rows[0].n,
      facturas_mes: facturasMes.rows[0].n,
      co2e_acumulado: co2eAcum.rows[0].total,
      simple_api: { ...ping, mock: simpleApi.mock },
      consumo_api_mes: uso.rows[0],
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// PERFIL — cambio de contraseña del usuario logueado
// ============================================================
router.put('/perfil/password', async (req, res, next) => {
  try {
    const { actual, nueva } = req.body;
    if (!actual || !nueva) return res.status(400).json({ error: 'Contraseña actual y nueva son obligatorias.' });
    if (String(nueva).length < 10) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 10 caracteres.' });

    const { rows } = await query(`SELECT * FROM usuarios WHERE id = $1`, [req.user.sub]);
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
    const ok = await bcrypt.compare(actual, user.password_hash || '');
    if (!ok) return res.status(401).json({ error: 'La contraseña actual no es correcta.' });

    const hash = await bcrypt.hash(nueva, config.bcryptRounds);
    await query(`UPDATE usuarios SET password_hash = $1, must_reset_password = false WHERE id = $2`, [hash, user.id]);
    await logActividad({ usuarioId: user.id, accion: 'cambio_password', entidad: 'usuario', entidadId: user.id, ip: req.ip });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ============================================================
// CLIENTES (CRUD + contratos)
// ============================================================
router.get('/clientes', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM clientes ORDER BY created_at DESC`);
    res.json({ clientes: rows });
  } catch (err) { next(err); }
});

router.post('/clientes', adminOnly, async (req, res, next) => {
  try {
    const { rut, nombre_empresa, contacto_email, estado_contrato, fecha_inicio, fecha_fin, plan } = req.body;
    if (!rut || !nombre_empresa) return res.status(400).json({ error: 'RUT y nombre de empresa son obligatorios' });
    const { rows } = await query(
      `INSERT INTO clientes (rut, nombre_empresa, contacto_email, estado_contrato, fecha_inicio, fecha_fin, plan)
       VALUES ($1,$2,$3,COALESCE($4,'piloto'),$5,$6,$7) RETURNING *`,
      [rut, nombre_empresa, contacto_email || null, estado_contrato, fecha_inicio || null, fecha_fin || null, plan || 'piloto']
    );
    await logActividad({ usuarioId: req.user.sub, accion: 'crear_cliente', entidad: 'cliente', entidadId: rows[0].id, ip: req.ip });
    res.status(201).json({ cliente: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe un cliente con ese RUT' });
    next(err);
  }
});

router.put('/clientes/:id', adminOnly, async (req, res, next) => {
  try {
    const { nombre_empresa, contacto_email, estado_contrato, fecha_inicio, fecha_fin, plan } = req.body;
    const { rows } = await query(
      `UPDATE clientes SET
         nombre_empresa = COALESCE($2,nombre_empresa),
         contacto_email = COALESCE($3,contacto_email),
         estado_contrato = COALESCE($4,estado_contrato),
         fecha_inicio = $5, fecha_fin = $6,
         plan = COALESCE($7,plan)
       WHERE id = $1 RETURNING *`,
      [req.params.id, nombre_empresa, contacto_email, estado_contrato, fecha_inicio || null, fecha_fin || null, plan]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Cliente no encontrado' });
    await logActividad({ usuarioId: req.user.sub, accion: 'editar_cliente', entidad: 'cliente', entidadId: req.params.id, ip: req.ip });
    res.json({ cliente: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/clientes/:id', adminOnly, async (req, res, next) => {
  try {
    await query(`DELETE FROM clientes WHERE id = $1`, [req.params.id]);
    await logActividad({ usuarioId: req.user.sub, accion: 'eliminar_cliente', entidad: 'cliente', entidadId: req.params.id, ip: req.ip });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Envía (o reenvía) el correo de activación para un usuario ya insertado.
// No lanza si el correo falla: registra el error y avisa al llamador, para
// que la cuenta no quede "atascada" sin ningún enlace visible en ninguna parte.
async function enviarActivacion({ usuarioId, email, nombre }) {
  const raw = crypto.randomBytes(32).toString('hex');
  const expira = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48h
  await query(
    `INSERT INTO tokens_password (usuario_id, token_hash, tipo, expira_at) VALUES ($1,$2,'activacion',$3)`,
    [usuarioId, hashToken(raw), expira]
  );
  const link = `${config.publicAppUrl}/admin/activar?token=${raw}`;
  let correoEnviado = true;
  try {
    await sendMail({ to: email, ...activationEmail({ nombre, link }) });
  } catch (err) {
    correoEnviado = false;
    console.error('[activacion] no se pudo enviar el correo:', err.message);
  }
  // Sin Resend (dev) o si el envío real falló: devolvemos el link para que
  // el admin lo pueda compartir a mano en vez de perderlo.
  const mostrarLink = !config.resend.apiKey || !correoEnviado;
  return { link, correoEnviado, dev_activation_link: mostrarLink ? link : undefined };
}

// CREAR CUENTA: genera usuario + envía link de activación (must_reset_password=true).
// Si ya existe un usuario "pendiente" con ese correo (p.ej. porque el envío
// anterior falló), reintenta el envío en vez de bloquear con un 409.
router.post('/clientes/:id/crear-cuenta', adminOnly, async (req, res, next) => {
  try {
    const { rows: cRows } = await query(`SELECT * FROM clientes WHERE id = $1`, [req.params.id]);
    const cliente = cRows[0];
    if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });
    const email = String(req.body.email || cliente.contacto_email || '').toLowerCase();
    if (!email) return res.status(400).json({ error: 'Se requiere un correo de contacto' });

    const nombre = req.body.nombre || cliente.nombre_empresa;
    let { rows: uRows } = await query(
      `INSERT INTO usuarios (email, nombre, rol, cliente_id, estado, must_reset_password)
       VALUES ($1,$2,'cliente',$3,'pendiente',true)
       ON CONFLICT (email) DO NOTHING RETURNING *`,
      [email, nombre, cliente.id]
    );
    if (!uRows[0]) {
      const { rows: existentes } = await query(`SELECT * FROM usuarios WHERE email = $1`, [email]);
      const existente = existentes[0];
      if (!existente || existente.estado !== 'pendiente') {
        return res.status(409).json({ error: 'Ya existe un usuario con ese correo' });
      }
      uRows = [existente]; // pendiente: reintenta el envío en vez de bloquear.
    }

    const { correoEnviado, dev_activation_link } = await enviarActivacion({ usuarioId: uRows[0].id, email, nombre });
    await logActividad({ usuarioId: req.user.sub, accion: 'crear_cuenta', entidad: 'usuario', entidadId: uRows[0].id, detalle: { email, correo_enviado: correoEnviado }, ip: req.ip });

    res.status(201).json({ ok: true, usuario_id: uRows[0].id, correo_enviado: correoEnviado, dev_activation_link });
  } catch (err) { next(err); }
});

// Alerta de contratos por vencer (próximos 30 días) o vencidos.
router.get('/contratos/alertas', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, nombre_empresa, rut, estado_contrato, fecha_fin,
              (fecha_fin - CURRENT_DATE) AS dias_restantes
       FROM clientes
       WHERE fecha_fin IS NOT NULL
         AND (fecha_fin < CURRENT_DATE + INTERVAL '30 days')
       ORDER BY fecha_fin ASC`
    );
    res.json({ alertas: rows });
  } catch (err) { next(err); }
});

// ============================================================
// SESIONES E INFORMES
// ============================================================
router.get('/sesiones', async (req, res, next) => {
  try {
    const { q, desde, hasta } = req.query;
    const cond = [];
    const params = [];
    if (q) { params.push(`%${q}%`); cond.push(`(nombre_cliente ILIKE $${params.length} OR rut_cliente ILIKE $${params.length})`); }
    if (desde) { params.push(desde); cond.push(`created_at >= $${params.length}`); }
    if (hasta) { params.push(hasta); cond.push(`created_at <= $${params.length}`); }
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
    const { rows } = await query(
      `SELECT s.*, (SELECT count(*)::int FROM facturas f WHERE f.sesion_id = s.id) AS n_facturas
       FROM sesiones s ${where} ORDER BY s.created_at DESC LIMIT 200`,
      params
    );
    res.json({ sesiones: rows });
  } catch (err) { next(err); }
});

router.get('/sesiones/:id', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM sesiones WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Sesión no encontrada' });
    const { rows: facturas } = await query(`SELECT * FROM facturas WHERE sesion_id = $1 ORDER BY created_at`, [req.params.id]);
    for (const f of facturas) {
      const { rows: items } = await query(`SELECT * FROM line_items WHERE factura_id = $1`, [f.id]);
      f.items = items;
    }
    res.json({ sesion: rows[0], facturas });
  } catch (err) { next(err); }
});

// ============================================================
// MÉTRICAS
// ============================================================
router.get('/metricas', async (req, res, next) => {
  try {
    const [porCliente, serie, porCategoria] = await Promise.all([
      query(`SELECT nombre_cliente, count(*)::int AS sesiones,
                    COALESCE(sum(total_co2e),0)::float AS co2e
             FROM sesiones GROUP BY nombre_cliente ORDER BY co2e DESC LIMIT 20`),
      query(`SELECT to_char(date_trunc('month', created_at),'YYYY-MM') AS mes,
                    count(*)::int AS facturas,
                    COALESCE(sum(total_co2e),0)::float AS co2e
             FROM facturas GROUP BY 1 ORDER BY 1`),
      query(`SELECT COALESCE(categoria,'Sin categoría') AS categoria,
                    count(*)::int AS n, COALESCE(sum(total_co2e),0)::float AS co2e
             FROM facturas GROUP BY 1 ORDER BY co2e DESC`),
    ]);
    res.json({
      co2e_por_cliente: porCliente.rows,
      serie_mensual: serie.rows,
      por_categoria: porCategoria.rows,
    });
  } catch (err) { next(err); }
});

// ============================================================
// PROSPECTOS (pipeline comercial)
// ============================================================
router.get('/prospectos', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM prospectos ORDER BY created_at DESC`);
    res.json({ prospectos: rows });
  } catch (err) { next(err); }
});
router.post('/prospectos', async (req, res, next) => {
  try {
    const { nombre_empresa, rut, contacto, etapa, origen, notas, proxima_accion } = req.body;
    if (!nombre_empresa) return res.status(400).json({ error: 'El nombre de la empresa es obligatorio' });
    const { rows } = await query(
      `INSERT INTO prospectos (nombre_empresa, rut, contacto, etapa, origen, notas, proxima_accion)
       VALUES ($1,$2,$3,COALESCE($4,'nuevo'),$5,$6,$7) RETURNING *`,
      [nombre_empresa, rut || null, contacto || null, etapa, origen || null, notas || null, proxima_accion || null]
    );
    res.status(201).json({ prospecto: rows[0] });
  } catch (err) { next(err); }
});
router.put('/prospectos/:id', async (req, res, next) => {
  try {
    const { nombre_empresa, rut, contacto, etapa, origen, notas, proxima_accion } = req.body;
    const { rows } = await query(
      `UPDATE prospectos SET
         nombre_empresa = COALESCE($2,nombre_empresa), rut = $3, contacto = $4,
         etapa = COALESCE($5,etapa), origen = $6, notas = $7, proxima_accion = $8
       WHERE id = $1 RETURNING *`,
      [req.params.id, nombre_empresa, rut, contacto, etapa, origen, notas, proxima_accion || null]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Prospecto no encontrado' });
    res.json({ prospecto: rows[0] });
  } catch (err) { next(err); }
});
router.delete('/prospectos/:id', async (req, res, next) => {
  try {
    await query(`DELETE FROM prospectos WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ============================================================
// SIMPLE API — consumo por endpoint / latencia / errores
// ============================================================
router.get('/simple-api', async (req, res, next) => {
  try {
    const [ping, porEndpoint, errores] = await Promise.all([
      simpleApi.ping(),
      query(`SELECT endpoint, metodo, count(*)::int AS llamadas,
                    round(avg(latencia_ms))::int AS latencia_prom,
                    COALESCE(sum(costo_estimado),0)::float AS costo
             FROM simple_api_uso GROUP BY endpoint, metodo ORDER BY llamadas DESC`),
      query(`SELECT count(*)::int AS n FROM simple_api_uso WHERE status_code >= 400`),
    ]);
    res.json({
      estado: { ...ping, mock: simpleApi.mock },
      por_endpoint: porEndpoint.rows,
      errores: errores.rows[0].n,
    });
  } catch (err) { next(err); }
});

// ============================================================
// USUARIOS Y ROLES
// ============================================================
router.get('/usuarios', adminOnly, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT u.id, u.email, u.nombre, u.rol, u.estado, u.must_reset_password, u.ultimo_login,
              u.created_at, c.nombre_empresa AS cliente
       FROM usuarios u LEFT JOIN clientes c ON c.id = u.cliente_id
       ORDER BY u.created_at DESC`
    );
    res.json({ usuarios: rows });
  } catch (err) { next(err); }
});

router.post('/usuarios', adminOnly, async (req, res, next) => {
  try {
    const { email, nombre, rol, cliente_id } = req.body;
    if (!email || !nombre) return res.status(400).json({ error: 'Email y nombre son obligatorios' });
    const emailNorm = String(email).toLowerCase();
    let { rows } = await query(
      `INSERT INTO usuarios (email, nombre, rol, cliente_id, estado, must_reset_password)
       VALUES ($1,$2,COALESCE($3,'operador'),$4,'pendiente',true)
       ON CONFLICT (email) DO NOTHING RETURNING *`,
      [emailNorm, nombre, rol, cliente_id || null]
    );
    if (!rows[0]) {
      const { rows: existentes } = await query(`SELECT * FROM usuarios WHERE email = $1`, [emailNorm]);
      const existente = existentes[0];
      if (!existente || existente.estado !== 'pendiente') {
        return res.status(409).json({ error: 'Ya existe un usuario con ese correo' });
      }
      rows = [existente]; // pendiente: reintenta el envío en vez de bloquear.
    }

    const { correoEnviado, dev_activation_link } = await enviarActivacion({ usuarioId: rows[0].id, email: rows[0].email, nombre });
    await logActividad({ usuarioId: req.user.sub, accion: 'crear_usuario', entidad: 'usuario', entidadId: rows[0].id, detalle: { correo_enviado: correoEnviado }, ip: req.ip });

    res.status(201).json({
      usuario: { id: rows[0].id, email: rows[0].email, nombre, rol: rows[0].rol },
      correo_enviado: correoEnviado,
      dev_activation_link,
    });
  } catch (err) { next(err); }
});

// Reenvía el correo de activación a un usuario "pendiente" (invitación creada
// pero el envío falló o se perdió) — sin esto quedaba un usuario atascado
// sin ningún enlace visible para activarlo.
router.post('/usuarios/:id/reenviar-activacion', adminOnly, async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM usuarios WHERE id = $1`, [req.params.id]);
    const usuario = rows[0];
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (usuario.estado !== 'pendiente') {
      return res.status(400).json({ error: 'Este usuario ya activó su cuenta.' });
    }
    const { correoEnviado, dev_activation_link } = await enviarActivacion({
      usuarioId: usuario.id, email: usuario.email, nombre: usuario.nombre,
    });
    await logActividad({ usuarioId: req.user.sub, accion: 'reenviar_activacion', entidad: 'usuario', entidadId: usuario.id, detalle: { correo_enviado: correoEnviado }, ip: req.ip });
    res.json({ ok: true, correo_enviado: correoEnviado, dev_activation_link });
  } catch (err) { next(err); }
});

router.put('/usuarios/:id', adminOnly, async (req, res, next) => {
  try {
    const { rol, estado, nombre } = req.body;
    const { rows } = await query(
      `UPDATE usuarios SET rol = COALESCE($2,rol), estado = COALESCE($3,estado), nombre = COALESCE($4,nombre)
       WHERE id = $1 RETURNING id, email, nombre, rol, estado`,
      [req.params.id, rol, estado, nombre]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Usuario no encontrado' });
    await logActividad({ usuarioId: req.user.sub, accion: 'editar_usuario', entidad: 'usuario', entidadId: req.params.id, ip: req.ip });
    res.json({ usuario: rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// LOG DE ACTIVIDAD
// ============================================================
router.get('/actividad', adminOnly, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT a.*, u.email AS usuario_email
       FROM actividad_log a LEFT JOIN usuarios u ON u.id = a.usuario_id
       ORDER BY a.created_at DESC LIMIT 200`
    );
    res.json({ actividad: rows });
  } catch (err) { next(err); }
});

export default router;
