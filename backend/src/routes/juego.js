import express from 'express';
import multer from 'multer';
import { query, withTx } from '../lib/db.js';
import { requireAuth, requireRole, logActividad } from '../middleware/auth.js';
import {
  nivelDePuntos, calcularPuntosTrayecto, esModoBajoCarbono,
  generarSerialCanje, hashCanje, otorgarPuntos, evaluarMisionesContador,
  impactoDeJugador, calcularPuntosReciclaje, distanciaHaversineM,
  coordenadasValidas, RADIO_PUNTO_LIMPIO_M, TOPE_RECICLAJES_POR_DIA,
} from '../services/juego.js';
import { analisisIA } from '../services/analisisIA.js';
import { bigquery } from '../services/bigquery.js';

// ============================================================
// "Sube y Suma" — /api/juego, rol 'jugador' (magic link con código de
// campaña de una empresa cliente, ver auth.js). El jugador queda ligado a
// un codigo_id: ranking y misiones nunca cruzan de una empresa a otra.
// ============================================================

const router = express.Router();
router.use(requireAuth, requireRole('jugador'));

async function jugadorDe(req) {
  const { rows } = await query(`SELECT * FROM jugadores WHERE id = $1`, [req.user.jugadorId]);
  return rows[0] || null;
}

function enmascararEmail(email) {
  const [usuario, dominio] = String(email || '').split('@');
  if (!usuario || !dominio) return 'Jugador';
  const visible = usuario.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(1, usuario.length - 2))}@${dominio}`;
}

// ---------- GET /perfil ----------
router.get('/perfil', async (req, res, next) => {
  try {
    const jugador = await jugadorDe(req);
    if (!jugador) return res.status(404).json({ error: 'Jugador no encontrado' });
    const nivel = nivelDePuntos(jugador.puntos_totales);
    const { rows: misiones } = await query(
      `SELECT m.codigo, m.nombre, m.descripcion, m.tipo, m.meta_valor, m.puntos_recompensa,
              COALESCE(mp.progreso, 0) AS progreso, mp.completada_at
       FROM misiones m
       LEFT JOIN misiones_progreso mp ON mp.mision_id = m.id AND mp.jugador_id = $1
       WHERE m.activo = true ORDER BY m.meta_valor`,
      [jugador.id]
    );
    // El código de campaña (no el id) — el frontend lo reenvía en cada
    // escaneo para consumir créditos, igual que un código normal (ver
    // POST /api/sesiones en public.js).
    const { rows: codRows } = await query(`SELECT codigo FROM codigos_acceso WHERE id = $1`, [jugador.codigo_id]);
    res.json({
      jugador: {
        email: jugador.email, nombre: jugador.nombre, empresa: jugador.empresa,
        puntos_totales: jugador.puntos_totales, codigo: codRows[0]?.codigo || null,
      },
      nivel,
      misiones,
    });
  } catch (err) { next(err); }
});

// ---------- GET /impacto — CO2e real detrás de los puntos del jugador ----------
router.get('/impacto', async (req, res, next) => {
  try {
    const jugador = await jugadorDe(req);
    if (!jugador) return res.status(404).json({ error: 'Jugador no encontrado' });
    const impacto = await impactoDeJugador(jugador.id);
    res.json(impacto);
  } catch (err) { next(err); }
});

// ---------- Reciclaje en punto limpio ----------
// La foto va en memoria y se descarta tras el análisis: nunca se persiste
// (solo el conteo validado). Una sola imagen por registro.
const multerFoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|png|webp)$/i.test(file.mimetype);
    cb(ok ? null : new Error('Formato de foto no permitido (usa JPG, PNG o WebP).'), ok);
  },
});

// Envuelve multer para responder 400 con mensaje propio: sin esto, tanto
// el MulterError (foto muy pesada) como el rechazo del fileFilter caen al
// handler global como 500 genérico (mismo patrón que uploadArchivos en
// public.js).
function uploadFoto(req, res, next) {
  multerFoto.single('foto')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'La foto no puede superar los 10 MB.' });
      }
      return res.status(400).json({ error: 'No se pudo procesar la foto. Inténtalo de nuevo.' });
    }
    if (err) return res.status(400).json({ error: err.message || 'Formato de foto no permitido.' });
    next();
  });
}

// Resuelve el token de un cartel QR a su punto limpio, respetando la
// campaña del jugador (codigo_id NULL = vale para todas).
async function puntoLimpioDe(token, jugador) {
  const { rows } = await query(
    `SELECT * FROM puntos_limpios
     WHERE token = $1 AND activo = true AND (codigo_id IS NULL OR codigo_id = $2)`,
    [String(token || ''), jugador.codigo_id]
  );
  return rows[0] || null;
}

// GET /puntos-limpios/:token — el frontend valida el QR antes de pedir la
// foto. Nunca expone lat/lng ni el id interno: la cercanía la verifica el
// servidor, no hay que regalarle el objetivo a un cliente malicioso.
router.get('/puntos-limpios/:token', async (req, res, next) => {
  try {
    const jugador = await jugadorDe(req);
    if (!jugador) return res.status(404).json({ error: 'Jugador no encontrado' });
    const punto = await puntoLimpioDe(req.params.token, jugador);
    if (!punto) return res.status(404).json({ error: 'Este punto limpio no está disponible para tu campaña.' });
    res.json({
      punto: {
        nombre: punto.nombre,
        direccion: punto.direccion,
        tiene_coordenadas: punto.lat != null && punto.lng != null,
      },
    });
  } catch (err) { next(err); }
});

// POST /reciclajes — registra una entrega de envases: GPS obligatorio,
// cercanía al punto si tiene coordenadas, foto contada por la IA (visión).
// Sin IA disponible se rechaza con mensaje de reintentar — nunca hay
// declaración manual de cantidades. Todo lo barato se valida ANTES de
// gastar en la llamada de visión.
router.post('/reciclajes', uploadFoto, async (req, res, next) => {
  try {
    const jugador = await jugadorDe(req);
    if (!jugador) return res.status(404).json({ error: 'Jugador no encontrado' });

    const { lat, lng } = req.body || {};
    if (!coordenadasValidas(lat, lng)) {
      return res.status(400).json({ error: 'Necesitamos tu ubicación para registrar el reciclaje. Activa el GPS y vuelve a intentar.' });
    }
    const punto = await puntoLimpioDe(req.body?.punto, jugador);
    if (!punto) return res.status(404).json({ error: 'Este punto limpio no está disponible para tu campaña.' });

    let distanciaM = null;
    if (punto.lat != null && punto.lng != null) {
      distanciaM = Math.round(distanciaHaversineM(Number(punto.lat), Number(punto.lng), Number(lat), Number(lng)));
      if (distanciaM > RADIO_PUNTO_LIMPIO_M) {
        return res.status(400).json({ error: `Estás a ${distanciaM.toLocaleString('es-CL')} m del punto limpio. Acércate y vuelve a intentar.` });
      }
    }

    // Tope diario por jugador (día calendario de Chile, mismo corte que el
    // presupuesto de la IA) — hace caro el abuso de un premio simbólico.
    const { rows: hoy } = await query(
      `SELECT COUNT(*)::int AS n FROM reciclajes
       WHERE jugador_id = $1
         AND created_at >= date_trunc('day', now() AT TIME ZONE 'America/Santiago') AT TIME ZONE 'America/Santiago'`,
      [jugador.id]
    );
    if (hoy[0].n >= TOPE_RECICLAJES_POR_DIA) {
      return res.status(429).json({ error: `Ya registraste ${TOPE_RECICLAJES_POR_DIA} reciclajes hoy. Vuelve mañana.` });
    }

    if (!req.file) return res.status(400).json({ error: 'Adjunta la foto de los envases.' });

    const conteo = await analisisIA.contarEnvases({
      imagenBase64: req.file.buffer.toString('base64'),
      mediaType: req.file.mimetype,
    });
    if (!conteo) {
      return res.status(422).json({ error: 'No pudimos analizar la foto en este momento. Inténtalo de nuevo en unos minutos.' });
    }
    const { envases, totalEnvases, puntos } = calcularPuntosReciclaje(conteo.fotoValida ? conteo.envases : []);
    if (!conteo.fotoValida || totalEnvases === 0) {
      return res.status(422).json({ error: 'No pudimos reconocer envases en la foto. Toma otra con los envases visibles y buena luz, y vuelve a intentar.' });
    }

    const { reciclaje, eventos, puntosGanados } = await withTx(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO reciclajes (jugador_id, punto_limpio_id, lat, lng, distancia_m, envases, total_envases, puntos)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [jugador.id, punto.id, Number(lat), Number(lng), distanciaM, JSON.stringify(envases), totalEnvases, puntos]
      );
      const fila = rows[0];
      const eventos = [];
      let puntosGanados = 0;
      const eventoReciclaje = await otorgarPuntos(client, {
        jugadorId: jugador.id, tipo: 'envase_reciclado', puntos, reciclajeId: fila.id,
      });
      if (eventoReciclaje) { eventos.push(eventoReciclaje); puntosGanados += puntos; }
      const eventosMision = await evaluarMisionesContador(client, {
        jugadorId: jugador.id, tipoMision: 'contar_envases', incremento: totalEnvases,
      });
      eventos.push(...eventosMision);
      puntosGanados += eventosMision.reduce((a, e) => a + e.puntos, 0);
      return { reciclaje: fila, eventos, puntosGanados };
    });

    await logActividad({ accion: 'juego_reciclaje', entidad: 'reciclaje', entidadId: reciclaje.id, ip: req.ip });
    res.status(201).json({
      reciclaje: {
        id: reciclaje.id, envases, total_envases: totalEnvases,
        puntos: reciclaje.puntos, distancia_m: distanciaM,
      },
      puntos_ganados: puntosGanados,
    });
    // Export al data warehouse (no bloqueante; apagado por defecto).
    bigquery.exportReciclaje(reciclaje);
    eventos.forEach((e) => bigquery.exportPuntosEvento(e));
  } catch (err) { next(err); }
});

// ---------- GET /ranking — top de la MISMA empresa, nunca cruza códigos ----------
router.get('/ranking', async (req, res, next) => {
  try {
    const jugador = await jugadorDe(req);
    if (!jugador) return res.status(404).json({ error: 'Jugador no encontrado' });
    const { rows } = await query(
      `SELECT id, nombre, email, puntos_totales,
              row_number() OVER (ORDER BY puntos_totales DESC, created_at ASC) AS posicion
       FROM jugadores WHERE codigo_id = $1
       ORDER BY puntos_totales DESC, created_at ASC LIMIT 20`,
      [jugador.codigo_id]
    );
    const ranking = rows.map((r) => ({
      posicion: Number(r.posicion),
      nombre: r.nombre || enmascararEmail(r.email),
      puntos_totales: r.puntos_totales,
      tu: r.id === jugador.id,
    }));
    res.json({ ranking });
  } catch (err) { next(err); }
});

// ---------- GET /recompensas ----------
router.get('/recompensas', async (req, res, next) => {
  try {
    const jugador = await jugadorDe(req);
    const { rows } = await query(
      `SELECT id, codigo, nombre, descripcion, costo_puntos, tipo FROM recompensas
       WHERE activo = true ORDER BY costo_puntos`
    );
    res.json({ recompensas: rows, puntos_totales: jugador?.puntos_totales ?? 0 });
  } catch (err) { next(err); }
});

// ---------- POST /recompensas/:id/canjear ----------
router.post('/recompensas/:id/canjear', async (req, res, next) => {
  try {
    const canje = await withTx(async (client) => {
      const { rows: jRows } = await client.query(
        `SELECT * FROM jugadores WHERE id = $1 FOR UPDATE`, [req.user.jugadorId]
      );
      const jugador = jRows[0];
      if (!jugador) { const e = new Error('Jugador no encontrado'); e.status = 404; throw e; }

      const { rows: rRows } = await client.query(
        `SELECT * FROM recompensas WHERE id = $1 AND activo = true`, [req.params.id]
      );
      const recompensa = rRows[0];
      if (!recompensa) { const e = new Error('Recompensa no encontrada'); e.status = 404; throw e; }

      if (jugador.puntos_totales < recompensa.costo_puntos) {
        const e = new Error('No tienes puntos suficientes para este canje.'); e.status = 400; throw e;
      }

      await client.query(
        `UPDATE jugadores SET puntos_totales = puntos_totales - $2 WHERE id = $1`,
        [jugador.id, recompensa.costo_puntos]
      );

      // Serial/hash solo si la recompensa es una constancia (mismo patrón
      // de reintento por colisión que capacitacion.js).
      let fila = null;
      const emitidaAt = new Date();
      for (let intento = 0; intento < 5 && !fila; intento++) {
        const s = recompensa.tipo === 'constancia' ? generarSerialCanje() : null;
        const h = s ? hashCanje({
          serial: s, jugador_id: jugador.id, recompensa_codigo: recompensa.codigo,
          puntos_gastados: recompensa.costo_puntos, emitida_at: emitidaAt,
        }) : null;
        try {
          const { rows } = await client.query(
            `INSERT INTO canjes (jugador_id, recompensa_id, puntos_gastados, serial, hash, created_at)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [jugador.id, recompensa.id, recompensa.costo_puntos, s, h, emitidaAt]
          );
          fila = rows[0];
        } catch (e) {
          if (e.code !== '23505') throw e;
        }
      }
      if (!fila) { const e = new Error('No se pudo generar el canje, intenta de nuevo.'); e.status = 500; throw e; }
      return { ...fila, recompensa_nombre: recompensa.nombre, recompensa_tipo: recompensa.tipo };
    });
    await logActividad({ accion: 'juego_canje', entidad: 'canje', entidadId: canje.id, ip: req.ip });
    res.status(201).json({ canje });
    // Export al data warehouse (no bloqueante; apagado por defecto).
    bigquery.exportCanje(canje);
  } catch (err) { next(err); }
});

const MODOS_TRANSPORTE = ['caminando', 'bicicleta', 'transporte_publico', 'auto', 'moto', 'otro'];

// ---------- POST /trayecto/salida ----------
// GPS obligatorio: la coordenada de salida es la que permite calcular la
// distancia del traslado al cerrar el trayecto.
router.post('/trayecto/salida', async (req, res, next) => {
  try {
    const modo = String(req.body?.modo_transporte || '');
    if (!MODOS_TRANSPORTE.includes(modo)) {
      return res.status(400).json({ error: 'Indica un medio de transporte válido.' });
    }
    const { lat, lng } = req.body || {};
    if (!coordenadasValidas(lat, lng)) {
      return res.status(400).json({ error: 'Activa la ubicación para registrar el trayecto.' });
    }
    const { rows } = await query(
      `INSERT INTO trayectos (jugador_id, modo_transporte, salida_lat, salida_lng) VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.jugadorId, modo, Number(lat), Number(lng)]
    );
    res.status(201).json({ trayecto: rows[0] });
  } catch (err) { next(err); }
});

// ---------- POST /trayecto/:id/llegada ----------
// GPS obligatorio también al llegar: con ambas coordenadas se calcula la
// distancia del traslado (haversine). Solo informativa — los puntos siguen
// saliendo de calcularPuntosTrayecto, sin cambios.
router.post('/trayecto/:id/llegada', async (req, res, next) => {
  try {
    const { lat, lng } = req.body || {};
    if (!coordenadasValidas(lat, lng)) {
      return res.status(400).json({ error: 'Activa la ubicación para registrar el trayecto.' });
    }
    const { trayecto, eventos } = await withTx(async (client) => {
      const { rows: tRows } = await client.query(
        `SELECT * FROM trayectos WHERE id = $1 AND jugador_id = $2 FOR UPDATE`,
        [req.params.id, req.user.jugadorId]
      );
      const t = tRows[0];
      if (!t) { const e = new Error('Trayecto no encontrado'); e.status = 404; throw e; }
      if (t.llegada_at) { const e = new Error('Este trayecto ya fue cerrado.'); e.status = 400; throw e; }

      const llegadaAt = new Date();
      const puntos = calcularPuntosTrayecto({
        modoTransporte: t.modo_transporte, salidaAt: t.salida_at, llegadaAt,
      });
      // Un trayecto abierto antes de este deploy no tiene coordenada de
      // salida: se cierra igual, solo que sin distancia.
      const distanciaM = t.salida_lat != null && t.salida_lng != null
        ? Math.round(distanciaHaversineM(Number(t.salida_lat), Number(t.salida_lng), Number(lat), Number(lng)))
        : null;
      const { rows } = await client.query(
        `UPDATE trayectos SET llegada_at = $2, puntos = $3, llegada_lat = $4, llegada_lng = $5, distancia_m = $6
         WHERE id = $1 RETURNING *`,
        [t.id, llegadaAt, puntos, Number(lat), Number(lng), distanciaM]
      );
      const eventos = [];
      const eventoTrayecto = await otorgarPuntos(client, {
        jugadorId: req.user.jugadorId, tipo: 'trayecto_registrado', puntos, trayectoId: t.id,
      });
      if (eventoTrayecto) eventos.push(eventoTrayecto);
      // Solo un trayecto de bajo carbono avanza la misión 'primer_trayecto_verde'
      // (su descripción exige caminando/bicicleta/transporte público).
      if (esModoBajoCarbono(t.modo_transporte)) {
        const eventosMision = await evaluarMisionesContador(client, {
          jugadorId: req.user.jugadorId, tipoMision: 'contar_trayectos', incremento: 1,
        });
        eventos.push(...eventosMision);
      }
      return { trayecto: rows[0], eventos };
    });
    res.json({ trayecto });
    // Export al data warehouse (no bloqueante; apagado por defecto).
    bigquery.exportTrayecto(trayecto);
    eventos.forEach((e) => bigquery.exportPuntosEvento(e));
  } catch (err) { next(err); }
});

export default router;
