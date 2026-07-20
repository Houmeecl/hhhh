import express from 'express';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { query } from '../lib/db.js';
import { signAccess, requireAuth, requireRole, logActividad } from '../middleware/auth.js';
import { generarSerial, generarClave, clampDocumentos } from '../services/posTerminal.js';
import { validarTarifa, validarTipoCambio } from '../services/compensacion.js';
import { actualizarDolar } from '../services/tipoCambio.js';
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

// ---------- GET /api/pos/config — tarifa vigente de compensación ----------
// Sin auth: el POS necesita la tarifa ANTES de cobrar (pantalla pública).
// No expone nada sensible: tarifa CLP/t CO2e, su fuente y el tipo de
// cambio USD→CLP (null = sin fijar → no se muestra USD), sea fijado a
// mano o actualizado solo (modo auto, migración 020).
// Defensivo: si las columnas nuevas (018/020) aún no existen, degrada a
// la consulta anterior; solo el último intento propaga error real de BD.
async function leerConfig() {
  const intentos = [
    `SELECT tarifa_clp_tco2e, fuente, updated_at, tipo_cambio_usd_clp,
            tipo_cambio_auto, tipo_cambio_fuente, tipo_cambio_actualizado
     FROM config_pos WHERE id = 1`,
    `SELECT tarifa_clp_tco2e, fuente, updated_at, tipo_cambio_usd_clp FROM config_pos WHERE id = 1`,
    `SELECT tarifa_clp_tco2e, fuente, updated_at FROM config_pos WHERE id = 1`,
  ];
  for (let i = 0; i < intentos.length; i++) {
    try {
      const { rows } = await query(intentos[i]);
      return rows[0] || null;
    } catch (e) {
      if (i === intentos.length - 1) throw e;
    }
  }
  return null;
}

function formatearConfig(c) {
  c = c || { tarifa_clp_tco2e: 5000, fuente: null, updated_at: null };
  return {
    tarifa_clp_tco2e: Number(c.tarifa_clp_tco2e),
    fuente: c.fuente ?? null,
    updated_at: c.updated_at ?? null,
    tipo_cambio_usd_clp: c.tipo_cambio_usd_clp != null ? Number(c.tipo_cambio_usd_clp) : null,
    tipo_cambio_auto: c.tipo_cambio_auto === true,
    tipo_cambio_fuente: c.tipo_cambio_fuente ?? null,
    tipo_cambio_actualizado: c.tipo_cambio_actualizado ?? null,
  };
}

router.get('/config', async (req, res, next) => {
  try {
    res.json(formatearConfig(await leerConfig()));
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

// ---------- PUT /config — editar la tarifa de compensación ----------
// La fila 1 es única (CHECK id = 1); el upsert cubre bases donde la
// migración corrió pero alguien borró la fila a mano.
// tipo_cambio_usd_clp (migración 018) solo se toca si el body trae la
// llave: un número lo fija, null lo LIMPIA (el frontend deja de mostrar
// USD). tipo_cambio_auto (migración 020) activa el dólar automático: el
// servidor consulta el observado BCCh (mindicador.cl) al activarlo y
// luego cada 6 h; en manual, el valor sigue siendo el que fija el admin.
adminRouter.put('/config', async (req, res, next) => {
  try {
    const body = req.body || {};
    const { tarifa_clp_tco2e, fuente } = body;
    const val = validarTarifa(tarifa_clp_tco2e);
    if (!val.ok) return res.status(400).json({ error: val.error });

    const fuenteVal = fuente !== undefined && fuente !== null ? String(fuente).trim() : null;
    const tieneTipoCambio = Object.prototype.hasOwnProperty.call(body, 'tipo_cambio_usd_clp');
    const tieneAuto = Object.prototype.hasOwnProperty.call(body, 'tipo_cambio_auto');
    if (tieneAuto && typeof body.tipo_cambio_auto !== 'boolean') {
      return res.status(400).json({ error: 'tipo_cambio_auto debe ser true o false.' });
    }

    if (tieneTipoCambio) {
      const tc = validarTipoCambio(body.tipo_cambio_usd_clp);
      if (!tc.ok) return res.status(400).json({ error: tc.error });
      await query(
        `INSERT INTO config_pos (id, tarifa_clp_tco2e, fuente, tipo_cambio_usd_clp, updated_at)
         VALUES (1, $1, $2, $3, now())
         ON CONFLICT (id) DO UPDATE SET
           tarifa_clp_tco2e    = EXCLUDED.tarifa_clp_tco2e,
           fuente              = COALESCE($2, config_pos.fuente),
           tipo_cambio_usd_clp = $3,
           updated_at          = now()`,
        [val.tarifa, fuenteVal, tc.tipo_cambio]
      );
    } else {
      // Consulta original: sigue funcionando aunque la columna nueva no exista.
      await query(
        `INSERT INTO config_pos (id, tarifa_clp_tco2e, fuente, updated_at)
         VALUES (1, $1, $2, now())
         ON CONFLICT (id) DO UPDATE SET
           tarifa_clp_tco2e = EXCLUDED.tarifa_clp_tco2e,
           fuente           = COALESCE($2, config_pos.fuente),
           updated_at       = now()`,
        [val.tarifa, fuenteVal]
      );
    }

    // Modo del dólar: al pasar a auto se intenta traer el observado al
    // tiro (si la fuente falla, el timer de 6 h reintenta solo); al pasar
    // a manual se limpia la trazabilidad auto para no atribuirle a la
    // fuente automática un valor puesto a mano.
    let aviso = null;
    if (tieneAuto) {
      if (body.tipo_cambio_auto) {
        await query(`UPDATE config_pos SET tipo_cambio_auto = true WHERE id = 1`);
        const r = await actualizarDolar();
        if (!r.actualizado) {
          aviso = 'Dólar automático activado, pero no se pudo obtener el valor en este momento; el servidor reintentará solo (cada 6 h).';
        }
      } else {
        await query(
          `UPDATE config_pos
           SET tipo_cambio_auto = false, tipo_cambio_fuente = NULL, tipo_cambio_actualizado = NULL
           WHERE id = 1`
        );
      }
    }

    await logActividad({
      usuarioId: req.user.sub,
      accion: 'editar_tarifa_pos',
      entidad: 'config_pos',
      detalle: {
        tarifa_clp_tco2e: val.tarifa,
        ...(tieneAuto ? { tipo_cambio_auto: body.tipo_cambio_auto } : {}),
      },
      ip: req.ip,
    });

    res.json({
      config: formatearConfig(await leerConfig()),
      ...(aviso ? { aviso } : {}),
    });
  } catch (err) { next(err); }
});

// ---------- GET /compensaciones/resumen — métricas del cobro simulado ----------
// El total "principal" solo considera 'simulado' (los omitidos registran
// la decisión pero no suman monto); el desglose por estado va aparte.
adminRouter.get('/compensaciones/resumen', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT estado,
              COUNT(*)::int              AS n,
              COALESCE(SUM(t_co2e), 0)   AS total_t_co2e,
              COALESCE(SUM(monto_clp), 0) AS total_monto_clp
       FROM compensaciones
       GROUP BY estado`
    );
    const porEstado = {};
    for (const r of rows) {
      porEstado[r.estado] = {
        n: r.n,
        total_t_co2e: Number(r.total_t_co2e),
        total_monto_clp: Number(r.total_monto_clp),
      };
    }
    const sim = porEstado.simulado || { n: 0, total_t_co2e: 0, total_monto_clp: 0 };
    res.json({
      n: sim.n,
      total_t_co2e: sim.total_t_co2e,
      total_monto_clp: sim.total_monto_clp,
      por_estado: porEstado,
    });
  } catch (err) { next(err); }
});

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
