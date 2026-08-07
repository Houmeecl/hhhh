import express from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../lib/db.js';
import { signAccess, requireAuth, requireRole, requireHomePanel, requireNivelOperador, logActividad } from '../middleware/auth.js';
import { validarTarifa, validarTipoCambio } from '../services/compensacion.js';
import { actualizarDolar } from '../services/tipoCambio.js';
import { loginLimiter } from '../middleware/rateLimit.js';

// ============================================================
// Login por dispositivo (serial + clave) de la tabla `pos_terminales` —
// patrón pos_devices de NotaryPro. El terminal físico de mostrador que
// originalmente usaba este login (PosTerminal.jsx, /pos) fue descontinuado:
// el mostrador presencial opera 100% vía /panel-verde con un operador
// humano logueado. Este endpoint /auth SIGUE VIVO porque la torre de
// control (routes/origen.js, torreRouter) reusa la misma tabla y el mismo
// login para el terminal del operador de flota — no tocar sin revisar Torre.
//  - Router público: /auth (login del dispositivo) y /config (tarifa).
//  - adminRouter: configuración de tarifa y reportes de solo lectura de
//    compensaciones/REP (usados por /panel-verde).
// ============================================================

const router = express.Router();

// Mensaje único para cualquier fallo de login: no filtra si el serial
// existe ni si el terminal está inactivo.
const MENSAJE_GENERICO = 'Serial o clave incorrectos';

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

// ============================================================
// Administración (solo admin) — montado en /api/admin/pos
// ============================================================
export const adminRouter = express.Router();
adminRouter.use(requireAuth, requireRole('admin'), requireHomePanel('aduana_verde'));

// ---------- PUT /config — editar la tarifa de compensación ----------
// La fila 1 es única (CHECK id = 1); el upsert cubre bases donde la
// migración corrió pero alguien borró la fila a mano.
// tipo_cambio_usd_clp (migración 018) solo se toca si el body trae la
// llave: un número lo fija, null lo LIMPIA (el frontend deja de mostrar
// USD). tipo_cambio_auto (migración 020) activa el dólar automático: el
// servidor consulta el observado BCCh (mindicador.cl) al activarlo y
// luego cada 6 h; en manual, el valor sigue siendo el que fija el admin.
adminRouter.put('/config', requireNivelOperador, async (req, res, next) => {
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

// ---------- GET /embalaje — declaraciones REP recientes (solo lectura) ----------
adminRouter.get('/embalaje', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const { rows } = await query(
      `SELECT de.id, de.sesion_id, de.peso_total_gr, de.peso_reciclable_gr,
              de.porcentaje, de.nivel, de.created_at,
              s.rut_cliente, s.nombre_cliente, s.fecha
       FROM declaraciones_embalaje de
       JOIN sesiones s ON s.id = de.sesion_id
       ORDER BY de.created_at DESC
       LIMIT $1`,
      [limit]
    );
    res.json({ declaraciones: rows });
  } catch (err) { next(err); }
});

// ---------- GET /embalaje/resumen — conteo por nivel de reciclabilidad ----------
adminRouter.get('/embalaje/resumen', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT nivel, COUNT(*)::int AS n FROM declaraciones_embalaje GROUP BY nivel`
    );
    const porNivel = { Alto: 0, Medio: 0, Bajo: 0 };
    for (const r of rows) porNivel[r.nivel] = r.n;
    const total = porNivel.Alto + porNivel.Medio + porNivel.Bajo;
    res.json({ total, por_nivel: porNivel });
  } catch (err) { next(err); }
});

// ---------- GET /compensaciones — últimas compensaciones (solo lectura) ----------
adminRouter.get('/compensaciones', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const { rows } = await query(
      `SELECT c.id, c.sesion_id, c.t_co2e, c.tarifa_clp_tco2e, c.monto_clp, c.metodo, c.estado, c.created_at,
              s.rut_cliente, s.nombre_cliente
       FROM compensaciones c
       JOIN sesiones s ON s.id = c.sesion_id
       ORDER BY c.created_at DESC
       LIMIT $1`,
      [limit]
    );
    res.json({ compensaciones: rows });
  } catch (err) { next(err); }
});

export default router;
