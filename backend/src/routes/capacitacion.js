import express from 'express';
import { query, withTx } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { calcularPuntaje, generarSerialConstancia, hashConstancia } from '../services/capacitacion.js';

// ============================================================
// Capacitación interna — /api/admin/capacitacion.
//
// Deliberadamente SIN requireHomePanel: el personal de AMBOS paneles
// (sicrep y aduana_verde) toma la misma capacitación — es transversal
// a los dos, no un dato de negocio propio de uno solo. Esta es la
// única excepción documentada a la convención de aislar paneles (ver
// requireHomePanel en middleware/auth.js) en todo el proyecto.
// ============================================================

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'operador'));

async function cursoActivoPorSlug(slug) {
  const { rows } = await query(`SELECT * FROM cursos WHERE slug = $1 AND activo = true`, [slug]);
  return rows[0] || null;
}

async function inscripcionDe(usuarioId, cursoId) {
  const { rows } = await query(
    `SELECT * FROM inscripciones WHERE usuario_id = $1 AND curso_id = $2`,
    [usuarioId, cursoId]
  );
  return rows[0] || null;
}

async function leccionesDe(cursoId) {
  const { rows } = await query(
    `SELECT id, titulo, tipo, contenido, url_video, orden FROM lecciones WHERE curso_id = $1 ORDER BY orden`,
    [cursoId]
  );
  return rows;
}

// Preguntas con TODAS sus opciones (incluida cuál es correcta) — solo
// para uso interno del servidor al calificar. Nunca se envía tal cual
// al cliente (ver GET /cursos/:slug/quiz, que la limpia).
async function bancoPreguntas(cursoId) {
  const { rows: preguntas } = await query(
    `SELECT id, enunciado, orden FROM preguntas WHERE curso_id = $1 ORDER BY orden`,
    [cursoId]
  );
  for (const p of preguntas) {
    const { rows: opciones } = await query(
      `SELECT id, texto, correcta, orden FROM opciones WHERE pregunta_id = $1 ORDER BY orden`,
      [p.id]
    );
    p.opciones = opciones;
  }
  return preguntas;
}

// ---------- GET /cursos ----------
router.get('/cursos', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.id, c.slug, c.titulo, c.descripcion, c.orden,
              i.estado AS mi_estado, i.completado_at AS mi_completado_at
       FROM cursos c
       LEFT JOIN inscripciones i ON i.curso_id = c.id AND i.usuario_id = $1
       WHERE c.activo = true
       ORDER BY c.orden`,
      [req.user.sub]
    );
    res.json({ cursos: rows });
  } catch (err) { next(err); }
});

// ---------- GET /cursos/:slug ----------
router.get('/cursos/:slug', async (req, res, next) => {
  try {
    const curso = await cursoActivoPorSlug(req.params.slug);
    if (!curso) return res.status(404).json({ error: 'Curso no encontrado' });
    const lecciones = await leccionesDe(curso.id);
    const inscripcion = await inscripcionDe(req.user.sub, curso.id);
    let progreso = [];
    if (inscripcion) {
      const { rows } = await query(
        `SELECT leccion_id FROM progreso_lecciones WHERE inscripcion_id = $1`,
        [inscripcion.id]
      );
      progreso = rows.map((r) => r.leccion_id);
    }
    res.json({ curso, lecciones, inscripcion, progreso });
  } catch (err) { next(err); }
});

// ---------- POST /cursos/:slug/inscribir ----------
router.post('/cursos/:slug/inscribir', async (req, res, next) => {
  try {
    const curso = await cursoActivoPorSlug(req.params.slug);
    if (!curso) return res.status(404).json({ error: 'Curso no encontrado' });
    await query(
      `INSERT INTO inscripciones (usuario_id, curso_id) VALUES ($1, $2)
       ON CONFLICT (usuario_id, curso_id) DO NOTHING`,
      [req.user.sub, curso.id]
    );
    const inscripcion = await inscripcionDe(req.user.sub, curso.id);
    res.status(201).json({ inscripcion });
  } catch (err) { next(err); }
});

// ---------- POST /cursos/:slug/lecciones/:leccionId/completar ----------
router.post('/cursos/:slug/lecciones/:leccionId/completar', async (req, res, next) => {
  try {
    const curso = await cursoActivoPorSlug(req.params.slug);
    if (!curso) return res.status(404).json({ error: 'Curso no encontrado' });
    const inscripcion = await inscripcionDe(req.user.sub, curso.id);
    if (!inscripcion) return res.status(403).json({ error: 'Debes inscribirte en el curso primero' });
    const { rows: lRows } = await query(
      `SELECT id FROM lecciones WHERE id = $1 AND curso_id = $2`,
      [req.params.leccionId, curso.id]
    );
    if (!lRows[0]) return res.status(404).json({ error: 'Lección no encontrada en este curso' });
    await query(
      `INSERT INTO progreso_lecciones (inscripcion_id, leccion_id) VALUES ($1, $2)
       ON CONFLICT (inscripcion_id, leccion_id) DO NOTHING`,
      [inscripcion.id, req.params.leccionId]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Confirma que la inscripción completó TODAS las lecciones del curso.
async function leccionesCompletas(cursoId, inscripcionId) {
  const { rows: totalRows } = await query(`SELECT count(*)::int AS n FROM lecciones WHERE curso_id = $1`, [cursoId]);
  const { rows: hechasRows } = await query(
    `SELECT count(*)::int AS n FROM progreso_lecciones WHERE inscripcion_id = $1`,
    [inscripcionId]
  );
  return totalRows[0].n > 0 && hechasRows[0].n >= totalRows[0].n;
}

// ---------- GET /cursos/:slug/quiz ----------
router.get('/cursos/:slug/quiz', async (req, res, next) => {
  try {
    const curso = await cursoActivoPorSlug(req.params.slug);
    if (!curso) return res.status(404).json({ error: 'Curso no encontrado' });
    const inscripcion = await inscripcionDe(req.user.sub, curso.id);
    if (!inscripcion) return res.status(403).json({ error: 'Debes inscribirte en el curso primero' });
    if (!(await leccionesCompletas(curso.id, inscripcion.id))) {
      return res.status(409).json({ error: 'Debes completar todas las lecciones antes de rendir la evaluación' });
    }
    const preguntas = await bancoPreguntas(curso.id);
    // Nunca se envía cuál opción es correcta.
    const preguntasPublicas = preguntas.map((p) => ({
      id: p.id, enunciado: p.enunciado,
      opciones: p.opciones.map((o) => ({ id: o.id, texto: o.texto })),
    }));
    res.json({ preguntas: preguntasPublicas });
  } catch (err) { next(err); }
});

// ---------- POST /cursos/:slug/quiz/responder ----------
router.post('/cursos/:slug/quiz/responder', async (req, res, next) => {
  try {
    const curso = await cursoActivoPorSlug(req.params.slug);
    if (!curso) return res.status(404).json({ error: 'Curso no encontrado' });
    const inscripcion = await inscripcionDe(req.user.sub, curso.id);
    if (!inscripcion) return res.status(403).json({ error: 'Debes inscribirte en el curso primero' });
    if (!(await leccionesCompletas(curso.id, inscripcion.id))) {
      return res.status(409).json({ error: 'Debes completar todas las lecciones antes de rendir la evaluación' });
    }
    const respuestas = Array.isArray(req.body?.respuestas) ? req.body.respuestas : [];
    const preguntas = await bancoPreguntas(curso.id);
    const resultado = calcularPuntaje(preguntas, respuestas);

    let constancia = null;
    await withTx(async (client) => {
      await client.query(
        `INSERT INTO intentos_quiz (inscripcion_id, respuestas, puntaje_pct, aprobado)
         VALUES ($1, $2, $3, $4)`,
        [inscripcion.id, JSON.stringify(respuestas), resultado.puntaje_pct, resultado.aprobado]
      );

      if (!resultado.aprobado) return;

      await client.query(
        `UPDATE inscripciones SET estado = 'aprobado', completado_at = now()
         WHERE id = $1 AND estado != 'aprobado'`,
        [inscripcion.id]
      );

      const { rows: existente } = await client.query(
        `SELECT * FROM constancias WHERE inscripcion_id = $1`,
        [inscripcion.id]
      );
      if (existente[0]) { constancia = existente[0]; return; }

      const { rows: userRows } = await client.query(`SELECT nombre FROM usuarios WHERE id = $1`, [req.user.sub]);
      const emitidaAt = new Date();
      for (let intento = 0; intento < 5 && !constancia; intento++) {
        const serial = generarSerialConstancia();
        const hash = hashConstancia({
          serial, usuario_nombre: userRows[0]?.nombre, curso_titulo: curso.titulo,
          puntaje_pct: resultado.puntaje_pct, emitida_at: emitidaAt,
        });
        try {
          const { rows } = await client.query(
            `INSERT INTO constancias (inscripcion_id, serial, puntaje_pct, hash_documento, emitida_at)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [inscripcion.id, serial, resultado.puntaje_pct, hash, emitidaAt]
          );
          constancia = rows[0];
        } catch (e) {
          if (e.code !== '23505') throw e;
        }
      }
    });

    res.json({ ...resultado, constancia });
  } catch (err) { next(err); }
});

export default router;
