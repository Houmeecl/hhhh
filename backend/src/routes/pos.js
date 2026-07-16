import express from 'express';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { query } from '../lib/db.js';
import { signAccess, requireAuth, requireRole, logActividad } from '../middleware/auth.js';
import { generarSerial, generarClave, clampDocumentos } from '../services/posTerminal.js';
import { loginLimiter } from '../middleware/rateLimit.js';

// ============================================================
// Terminales POS "Aduana Verde" — patrón pos_devices de NotaryPro:
// el DISPOSITIVO inicia sesión con serial + clave (no una persona).
//  - Router público: /auth (login del terminal) y /actividad (contador).
//  - adminRouter: gestión de terminales (crear, listar, activar,
//    regenerar clave). La clave viaja UNA sola vez, como los mandantes.
// ============================================================

const router = express.Router();

// Mensaje único para cualquier fallo de login: no filtra si el serial
// existe ni si el terminal está inactivo.
const MENSAJE_GENERICO = 'Serial o clave incorrectos';

// Campos que se exponen al admin (nunca clave_hash).
const CAMPOS_TERMINAL =
  'id, nombre, ubicacion, serial, activo, ultima_actividad, documentos_procesados, created_at';

// ---------- POST /api/pos/auth — login del dispositivo ----------
// Mismo límite anti fuerza bruta que el login de personas (backend.md).
router.post('/auth', loginLimiter, async (req, res, next) => {
  try {
    const { serial, clave } = req.body;
    if (!serial || !clave) return res.status(401).json({ error: MENSAJE_GENERICO });

    const { rows } = await query(
      `SELECT * FROM pos_terminales WHERE serial = $1`,
      [String(serial).trim().toUpperCase()]
    );
    const terminal = rows[0];
    if (!terminal) return res.status(401).json({ error: MENSAJE_GENERICO });
    if (!terminal.activo) return res.status(403).json({ error: MENSAJE_GENERICO });

    const ok = await bcrypt.compare(String(clave), terminal.clave_hash);
    if (!ok) return res.status(401).json({ error: MENSAJE_GENERICO });

    await query(`UPDATE pos_terminales SET ultima_actividad = now() WHERE id = $1`, [terminal.id]);
    await logActividad({ accion: 'pos_login', entidad: 'pos_terminal', entidadId: terminal.id, ip: req.ip });

    res.json({
      terminal: {
        id: terminal.id,
        serial: terminal.serial,
        nombre: terminal.nombre,
        ubicacion: terminal.ubicacion,
      },
      token: signAccess({ id: terminal.id, rol: 'pos', email: null }),
    });
  } catch (err) { next(err); }
});

// ---------- POST /api/pos/actividad — el terminal reporta un documento ----------
router.post('/actividad', requireAuth, requireRole('pos'), async (req, res, next) => {
  try {
    // El terminal reporta cuántos documentos tuvo el trámite (1..5);
    // antes se sumaba siempre 1 y un trámite de 5 facturas contaba como 1.
    const n = clampDocumentos(req.body?.documentos_procesados);
    const { rows } = await query(
      `UPDATE pos_terminales
       SET documentos_procesados = documentos_procesados + $2, ultima_actividad = now()
       WHERE id = $1
       RETURNING documentos_procesados`,
      [req.user.sub, n]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Terminal no encontrado' });
    res.json({ ok: true, documentos_procesados: rows[0].documentos_procesados });
  } catch (err) { next(err); }
});

// ============================================================
// Administración (solo admin) — montado en /api/admin/pos
// ============================================================
export const adminRouter = express.Router();
adminRouter.use(requireAuth, requireRole('admin'));

// ---------- GET /terminales ----------
adminRouter.get('/terminales', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT ${CAMPOS_TERMINAL} FROM pos_terminales ORDER BY created_at DESC`
    );
    res.json({ terminales: rows });
  } catch (err) { next(err); }
});

// ---------- POST /terminales — crea terminal; la clave viaja UNA vez ----------
adminRouter.post('/terminales', async (req, res, next) => {
  try {
    const { nombre, ubicacion } = req.body;
    if (!nombre || !String(nombre).trim()) {
      return res.status(400).json({ error: 'El nombre del terminal es obligatorio.' });
    }

    const clave = generarClave();
    const claveHash = await bcrypt.hash(clave, config.bcryptRounds);

    // El serial es corto (AV-XXXX): si colisiona con uno existente,
    // se reintenta con otro serial (máx 5 intentos).
    let terminal = null;
    for (let intento = 0; intento < 5 && !terminal; intento++) {
      try {
        const { rows } = await query(
          `INSERT INTO pos_terminales (nombre, ubicacion, serial, clave_hash)
           VALUES ($1,$2,$3,$4) RETURNING ${CAMPOS_TERMINAL}`,
          [String(nombre).trim(), ubicacion ? String(ubicacion).trim() : null, generarSerial(), claveHash]
        );
        terminal = rows[0];
      } catch (e) {
        if (e.code !== '23505') throw e; // solo se reintenta la colisión de serial
      }
    }
    if (!terminal) {
      return res.status(500).json({ error: 'No se pudo generar un serial único. Intenta de nuevo.' });
    }

    await logActividad({ usuarioId: req.user.sub, accion: 'crear_pos_terminal', entidad: 'pos_terminal', entidadId: terminal.id, ip: req.ip });
    // La clave SOLO viaja en esta respuesta (patrón mandantes).
    res.status(201).json({ terminal, clave });
  } catch (err) { next(err); }
});

// ---------- PUT /terminales/:id — activar/desactivar y regenerar clave ----------
adminRouter.put('/terminales/:id', async (req, res, next) => {
  try {
    const { activo, regenerar_clave } = req.body;

    let clave = null;
    let claveHash = null;
    if (regenerar_clave === true) {
      clave = generarClave();
      claveHash = await bcrypt.hash(clave, config.bcryptRounds);
    }

    const { rows } = await query(
      `UPDATE pos_terminales SET
         activo = COALESCE($2, activo),
         clave_hash = COALESCE($3, clave_hash)
       WHERE id = $1
       RETURNING ${CAMPOS_TERMINAL}`,
      [req.params.id, typeof activo === 'boolean' ? activo : null, claveHash]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Terminal no encontrado' });

    await logActividad({
      usuarioId: req.user.sub,
      accion: 'editar_pos_terminal',
      entidad: 'pos_terminal',
      entidadId: rows[0].id,
      detalle: { regenerar_clave: regenerar_clave === true, activo: typeof activo === 'boolean' ? activo : undefined },
      ip: req.ip,
    });

    // Si se regeneró la clave, se devuelve UNA sola vez.
    res.json(clave ? { terminal: rows[0], clave } : { terminal: rows[0] });
  } catch (err) { next(err); }
});

export default router;
