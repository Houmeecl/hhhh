import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { config } from '../config.js';
import { queryCorredor, withTxCorredor } from '../lib/dbCorredor.js';
import { loginLimiter } from '../middleware/rateLimit.js';
import {
  requireCorredorActivo, requireAuthCorredor, requireClaveDefinida,
  requireAdminCorredor, exportadorDeLaSesion, firmarTokenCorredor, logCorredor,
} from '../middleware/authCorredor.js';
import {
  generarCodigoCarga, validarParcela, nivelConfianzaParcela, resumenParcela, puntoDe,
  EXIGE_POLIGONO_HA, TOLERANCIA_AREA_PCT, NOMBRE_NIVEL_PARCELA,
} from '../services/corredor.js';
import { listoParaExportar, semaforoExportacion, glosaExportacion, urgenciaExportacion } from '../services/exportacion.js';

// ============================================================
// API del Corredor Bioceánico — sobre su PROPIA base.
//
// Todo lo de acá consulta con queryCorredor, nunca con query: son bases
// distintas y no se mezclan. Un `query(...)` en este archivo iría contra
// sicr3p y sería un error silencioso —la consulta correría, contra la
// tabla equivocada—, así que ese import no está a propósito.
//
// Se llama corredorApi.js y no corredor.js porque ese nombre ya lo ocupan
// las rutas del Corredor del panel ADMIN (metodologías por país,
// documentos, puntos de control), que viven en la base de sicr3p y no
// tienen nada que ver con esto.
//
// EL AISLAMIENTO ENTRE EMPRESAS. El exportador de un operador sale del
// TOKEN, nunca del request (`exportadorDeLaSesion`). Es lo que impide que
// alguien vea las cargas de otra empresa cambiando un id en la URL, y es
// la garantía sobre la que se apoya todo lo demás.
// ============================================================

const router = express.Router();

// Nada del Corredor responde si el Corredor no está configurado. Va
// primero: si falta la base, el problema no es que falte el token.
router.use(requireCorredorActivo);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- Sesión ----------

router.post('/auth/login', loginLimiter, async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').toLowerCase().trim();
    const password = String(req.body?.password || '');
    if (!email || !password) return res.status(400).json({ error: 'Correo y contraseña son obligatorios.' });

    const { rows } = await queryCorredor(
      `SELECT u.*, e.nombre_empresa, e.onboarding_completado_at
         FROM usuarios_corredor u
         LEFT JOIN exportadores e ON e.id = u.exportador_id
        WHERE u.email = $1`,
      [email]
    );
    const u = rows[0];
    // Mismo mensaje para "no existe" y "clave mala": distinguirlos le
    // confirma a quien prueba correos cuáles están registrados.
    const ok = u && u.estado === 'activo' && await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });

    await queryCorredor('UPDATE usuarios_corredor SET ultimo_acceso = now() WHERE id = $1', [u.id]);
    await logCorredor({ usuarioId: u.id, email, accion: 'login', ip: req.ip });

    res.json({
      access: firmarTokenCorredor(u),
      usuario: {
        id: u.id, email: u.email, nombre: u.nombre, rol: u.rol,
        exportador_id: u.exportador_id, nombre_empresa: u.nombre_empresa,
        must_reset_password: u.must_reset_password,
        onboarding_completado: u.onboarding_completado_at != null,
      },
    });
  } catch (err) { next(err); }
});

router.get('/me', requireAuthCorredor, async (req, res, next) => {
  try {
    const { rows } = await queryCorredor(
      `SELECT u.id, u.email, u.nombre, u.rol, u.exportador_id, u.must_reset_password,
              e.nombre_empresa, e.rut, e.eori, e.onboarding_completado_at
         FROM usuarios_corredor u
         LEFT JOIN exportadores e ON e.id = u.exportador_id
        WHERE u.id = $1`,
      [req.usuario.sub]
    );
    if (!rows[0]) return res.status(401).json({ error: 'Sesión inválida.' });
    const u = rows[0];
    res.json({ usuario: { ...u, onboarding_completado: u.onboarding_completado_at != null } });
  } catch (err) { next(err); }
});

router.post('/auth/cambiar-password', requireAuthCorredor, async (req, res, next) => {
  try {
    const nueva = String(req.body?.password || '');
    if (nueva.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
    const hash = await bcrypt.hash(nueva, config.bcryptRounds);
    await queryCorredor(
      'UPDATE usuarios_corredor SET password_hash = $2, must_reset_password = false WHERE id = $1',
      [req.usuario.sub, hash]
    );
    await logCorredor({ usuarioId: req.usuario.sub, email: req.usuario.email, accion: 'cambiar_password', ip: req.ip });
    // Token nuevo: el viejo lleva must_reset_password=true y seguiría
    // bloqueando todo lo demás hasta que expire.
    const { rows } = await queryCorredor('SELECT * FROM usuarios_corredor WHERE id = $1', [req.usuario.sub]);
    res.json({ ok: true, access: firmarTokenCorredor(rows[0]) });
  } catch (err) { next(err); }
});

// ---------- Alta de exportadores (administración del Corredor) ----------

router.post('/exportadores', requireAuthCorredor, requireClaveDefinida, requireAdminCorredor, async (req, res, next) => {
  try {
    const b = req.body || {};
    const nombre = String(b.nombre_empresa || '').trim();
    const rut = String(b.rut || '').replace(/[^0-9kK]/g, '').toUpperCase();
    const email = String(b.contacto_email || '').toLowerCase().trim();
    if (!nombre) return res.status(400).json({ error: 'La razón social es obligatoria.' });
    if (!rut) return res.status(400).json({ error: 'El identificador tributario es obligatorio.' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Ingresa un correo válido.' });

    // Alfabeto sin caracteres ambiguos (sin 0/O, 1/l/I): esta clave se
    // dicta por teléfono cuando el correo no llega.
    const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const bytes = crypto.randomBytes(12);
    let temporal = '';
    for (let i = 0; i < 12; i++) temporal += ALFABETO[bytes[i] % ALFABETO.length];

    const salida = await withTxCorredor(async (client) => {
      const { rows: ex } = await client.query(
        `INSERT INTO exportadores (nombre_empresa, rut, pais, eori, contacto_email, contacto_nombre)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (rut) DO NOTHING
         RETURNING *`,
        [nombre, rut, String(b.pais || 'CL').toUpperCase(), b.eori || null, email, b.contacto_nombre || null]
      );
      if (!ex[0]) { const e = new Error('Ya existe un exportador con ese identificador.'); e.status = 409; throw e; }
      const hash = await bcrypt.hash(temporal, config.bcryptRounds);
      const { rows: us } = await client.query(
        `INSERT INTO usuarios_corredor (email, nombre, password_hash, exportador_id, rol, must_reset_password)
         VALUES ($1,$2,$3,$4,'operador',true) RETURNING id, email`,
        [email, b.contacto_nombre || nombre, hash, ex[0].id]
      );
      return { exportador: ex[0], usuario: us[0] };
    });

    await logCorredor({
      usuarioId: req.usuario.sub, email: req.usuario.email, accion: 'crear_exportador',
      entidad: 'exportador', entidadId: salida.exportador.id, detalle: { rut }, ip: req.ip,
    });
    // La clave temporal viaja UNA sola vez, en este response, y no queda
    // en la bitácora.
    res.status(201).json({ ...salida, password_temporal: temporal });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.code === '23505') return res.status(409).json({ error: 'Ese correo ya tiene una cuenta en el Corredor.' });
    next(err);
  }
});

// ---------- Parcelas ----------

router.get('/parcelas', requireAuthCorredor, requireClaveDefinida, async (req, res, next) => {
  try {
    const exportador = exportadorDeLaSesion(req);
    if (!exportador) return res.json({ parcelas: [] });
    const { rows } = await queryCorredor(
      `SELECT * FROM parcelas WHERE exportador_id = $1 ORDER BY created_at DESC`, [exportador]
    );
    res.json({
      parcelas: rows.map((p) => ({ ...p, ...resumenParcela(p) })),
      umbral_poligono_ha: EXIGE_POLIGONO_HA,
      tolerancia_area_pct: TOLERANCIA_AREA_PCT,
      niveles: NOMBRE_NIVEL_PARCELA,
    });
  } catch (err) { next(err); }
});

router.post('/parcelas', requireAuthCorredor, requireClaveDefinida, async (req, res, next) => {
  try {
    const exportador = exportadorDeLaSesion(req);
    if (!exportador) return res.status(403).json({ error: 'Tu cuenta no tiene una empresa asociada.' });

    const b = req.body || {};
    const val = validarParcela(b);
    if (!val.ok) return res.status(400).json({ error: val.error });

    // EL NIVEL SE CALCULA, NUNCA SE RECIBE. Si `b.nivel_confianza` llegara
    // a la base, cualquiera se pondría en 4 con un curl. Lo mismo con los
    // campos de validación: un exportador no puede certificarse a sí mismo
    // contra un registro público — eso lo escribe el servidor cuando de
    // verdad contrasta, en otra ruta.
    const nivel = nivelConfianzaParcela({ ...b, validado_por: null, validado_fuente: null, validado_at: null });

    const { rows } = await queryCorredor(
      `INSERT INTO parcelas
         (exportador_id, nombre, pais, region, area_ha, lat, lng, poligono,
          origen_coordenada, precision_declarada_m, nivel_confianza)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [exportador, String(b.nombre).trim(), String(b.pais).toUpperCase(), b.region || null,
       b.area_ha ?? null, b.lat ?? null, b.lng ?? null,
       b.poligono ? JSON.stringify(b.poligono) : null,
       b.origen_coordenada || 'archivo', b.precision_declarada_m ?? null, nivel]
    );
    const p = rows[0];
    await logCorredor({
      usuarioId: req.usuario.sub, email: req.usuario.email, accion: 'crear_parcela',
      entidad: 'parcela', entidadId: p.id, detalle: { nivel, origen: p.origen_coordenada }, ip: req.ip,
    });
    res.status(201).json({ parcela: { ...p, ...resumenParcela(p) } });
  } catch (err) { next(err); }
});

// ---------- Cargas ----------

// Arma lo que `listoParaExportar` necesita: la carga MÁS sus predios y su
// producción. Sin esto una carga de soya siempre diría que le falta la
// geolocalización, aunque tenga sus predios declarados.
function paraEvaluar(carga, parcelas = [], produccion = null) {
  return {
    ...carga,
    // `puntoDe` resuelve el centroide cuando el predio se declaró solo con
    // polígono, que es el caso obligatorio sobre 4 ha.
    parcelas: parcelas.map((p) => ({ ...puntoDe(p), poligono: p.poligono })),
    fecha_produccion: produccion?.desde || null,
    libre_deforestacion: produccion?.libre_deforestacion_declarado === true,
    legalidad: produccion?.legalidad_declarada === true,
  };
}

const conEstado = (carga, parcelas, produccion) => {
  const estado = listoParaExportar(paraEvaluar(carga, parcelas, produccion));
  return {
    ...estado,
    semaforo: semaforoExportacion(estado),
    glosa: glosaExportacion(estado),
    urgencia: urgenciaExportacion(estado),
  };
};

router.get('/cargas', requireAuthCorredor, requireClaveDefinida, async (req, res, next) => {
  try {
    const exportador = exportadorDeLaSesion(req);
    if (!exportador) return res.json({ cargas: [] });
    const { rows } = await queryCorredor(
      `SELECT * FROM cargas WHERE exportador_id = $1 ORDER BY created_at DESC LIMIT 300`, [exportador]
    );
    const ids = rows.map((c) => c.id);

    // Dos consultas para todas las cargas, no dos POR carga: con 300
    // cargas, el N+1 serían 600 idas a la base para pintar una tabla.
    //
    // Y se traen SIEMPRE, aunque cueste: evaluar el listado solo con la
    // carga —como estaba— hacía que la lista dijera "faltan 4 datos" de
    // una carga que el detalle mostraba completa. Dos pantallas del mismo
    // producto contradiciéndose sobre si algo cumple o no es peor que
    // cualquier consulta de más.
    const [{ rows: vinculos }, { rows: producciones }] = ids.length
      ? await Promise.all([
        queryCorredor(
          `SELECT cp.carga_id, p.lat, p.lng, p.poligono
             FROM carga_parcelas cp JOIN parcelas p ON p.id = cp.parcela_id
            WHERE cp.carga_id = ANY($1::uuid[])`, [ids]),
        queryCorredor('SELECT * FROM carga_produccion WHERE carga_id = ANY($1::uuid[])', [ids]),
      ])
      : [{ rows: [] }, { rows: [] }];

    const porCarga = new Map();
    for (const v of vinculos) {
      if (!porCarga.has(v.carga_id)) porCarga.set(v.carga_id, []);
      porCarga.get(v.carga_id).push(v);
    }
    const prodPorCarga = new Map(producciones.map((p) => [p.carga_id, p]));

    res.json({
      cargas: rows.map((c) => ({
        ...c,
        exportacion: conEstado(c, porCarga.get(c.id) || [], prodPorCarga.get(c.id) || null),
      })),
    });
  } catch (err) { next(err); }
});

router.post('/cargas', requireAuthCorredor, requireClaveDefinida, async (req, res, next) => {
  try {
    const exportador = exportadorDeLaSesion(req);
    if (!exportador) return res.status(403).json({ error: 'Tu cuenta no tiene una empresa asociada.' });

    const b = req.body || {};
    const descripcion = String(b.descripcion || '').trim();
    if (!descripcion) return res.status(400).json({ error: 'La carga necesita una descripción.' });
    const cantidad = Number(b.cantidad);
    if (!Number.isFinite(cantidad) || cantidad <= 0) return res.status(400).json({ error: 'La cantidad tiene que ser mayor que 0.' });
    if (!/^[A-Z]{2}$/.test(String(b.pais_origen || '').toUpperCase())) {
      return res.status(400).json({ error: 'El país de origen va en ISO-2.' });
    }

    const carga = await withTxCorredor(async (client) => {
      await client.query('SAVEPOINT antes_de_insertar');
      const anio = new Date().getFullYear();
      // El correlativo sale de un count(), y un count() NO bloquea nada:
      // dos altas simultáneas se llevan el mismo número y la segunda choca
      // contra el UNIQUE del código. Estar dentro de la transacción no lo
      // evita —eso fue un error del comentario anterior, no una defensa—.
      // Se reintenta, igual que emitirContrato() en la base de sicr3p, y
      // solo ante la colisión del código: cualquier otro 23505 es un error
      // real que tiene que subir.
      for (let intento = 0; intento < 5; intento += 1) {
        const { rows: n } = await client.query(
          `SELECT count(*)::int + 1 + $2 AS n FROM cargas WHERE codigo LIKE $1`,
          [`CB-${anio}-%`, intento]
        );
        try {
          const { rows } = await client.query(
            `INSERT INTO cargas
               (codigo, exportador_id, codigo_nc, descripcion, cantidad, unidad, pais_origen,
                region_origen, instalacion, emisiones_directas_tco2e_t, emisiones_indirectas_tco2e_t, metodo_emisiones)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
            [generarCodigoCarga(anio, n[0].n), exportador, b.codigo_nc || null, descripcion, cantidad,
             b.unidad || 't', String(b.pais_origen).toUpperCase(), b.region_origen || null,
             b.instalacion || null, b.emisiones_directas_tco2e_t ?? null,
             b.emisiones_indirectas_tco2e_t ?? null, b.metodo_emisiones || null]
          );
          return rows[0];
        } catch (err) {
          // Postgres aborta la transacción entera ante cualquier error, así
          // que hay que soltar el savepoint para poder reintentar adentro.
          if (err.code === '23505' && String(err.constraint || '').includes('codigo')) {
            await client.query('ROLLBACK TO SAVEPOINT antes_de_insertar').catch(() => {});
            continue;
          }
          throw err;
        }
      }
      throw new Error('No se pudo generar un código de carga único.');
    });

    await logCorredor({
      usuarioId: req.usuario.sub, email: req.usuario.email, accion: 'crear_carga',
      entidad: 'carga', entidadId: carga.id, detalle: { codigo: carga.codigo }, ip: req.ip,
    });
    const estado = listoParaExportar(carga);
    res.status(201).json({
      carga,
      exportacion: { ...estado, semaforo: semaforoExportacion(estado), glosa: glosaExportacion(estado), urgencia: urgenciaExportacion(estado) },
    });
  } catch (err) { next(err); }
});

router.get('/cargas/:id', requireAuthCorredor, requireClaveDefinida, async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Carga no encontrada.' });
    const exportador = exportadorDeLaSesion(req);
    // El exportador va en el WHERE: "no existe" cubre también "no es
    // tuya", que es lo que hay que responder — decir "existe pero no es
    // tuya" ya confirma que existe.
    const { rows } = await queryCorredor(
      `SELECT * FROM cargas WHERE id = $1 AND exportador_id = $2`, [req.params.id, exportador]
    );
    const carga = rows[0];
    if (!carga) return res.status(404).json({ error: 'Carga no encontrada.' });

    const [{ rows: parcelas }, { rows: produccion }, { rows: pasos }] = await Promise.all([
      queryCorredor(
        `SELECT p.*, cp.aporte_pct FROM carga_parcelas cp
           JOIN parcelas p ON p.id = cp.parcela_id
          WHERE cp.carga_id = $1`, [carga.id]),
      queryCorredor('SELECT * FROM carga_produccion WHERE carga_id = $1', [carga.id]),
      queryCorredor(
        `SELECT cp.*, pc.nombre AS punto_nombre, pc.pais AS punto_pais
           FROM carga_pasos cp JOIN puntos_corredor pc ON pc.id = cp.punto_id
          WHERE cp.carga_id = $1 ORDER BY cp.registrado_at`, [carga.id]),
    ]);

    res.json({
      carga,
      parcelas: parcelas.map((p) => ({ ...p, ...resumenParcela(p) })),
      produccion: produccion[0] || null,
      pasos,
      // Mismo helper que el listado. Cuando cada pantalla armaba su propia
      // evaluación, la lista y el detalle terminaron diciendo cosas
      // distintas de la misma carga.
      exportacion: conEstado(carga, parcelas, produccion[0] || null),
    });
  } catch (err) { next(err); }
});

// ---------- Enlazar predios a una carga ----------
//
// Sin esto, `carga_parcelas` era una tabla que solo se leía: el exportador
// podía registrar predios y crear cargas, y no había forma de conectarlos.
// O sea que el EUDR no se podía cumplir desde el producto, que es lo único
// para lo que existe este panel.
router.post('/cargas/:id/parcelas', requireAuthCorredor, requireClaveDefinida, async (req, res, next) => {
  try {
    const exportador = exportadorDeLaSesion(req);
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Carga no encontrada.' });
    const parcelaId = String(req.body?.parcela_id || '');
    if (!UUID_RE.test(parcelaId)) return res.status(400).json({ error: 'Falta el predio a enlazar.' });

    const aporte = req.body?.aporte_pct === undefined ? 100 : Number(req.body.aporte_pct);
    if (!Number.isFinite(aporte) || aporte <= 0 || aporte > 100) {
      // Mayor que 0, no "entre 0 y 100": un predio que aporta 0% no es un
      // origen, y registrarlo diría lo contrario de lo que significa.
      return res.status(400).json({ error: 'El aporte del predio debe ser mayor que 0 y hasta 100.' });
    }

    // Las DOS puntas se verifican contra el exportador de la sesión. Sin
    // el chequeo del predio, alguien enlazaría el de otra empresa y su
    // carga quedaría "geolocalizada" con coordenadas ajenas.
    const [{ rows: c }, { rows: p }] = await Promise.all([
      queryCorredor('SELECT id FROM cargas WHERE id = $1 AND exportador_id = $2', [req.params.id, exportador]),
      queryCorredor('SELECT id FROM parcelas WHERE id = $1 AND exportador_id = $2', [parcelaId, exportador]),
    ]);
    if (!c[0]) return res.status(404).json({ error: 'Carga no encontrada.' });
    if (!p[0]) return res.status(400).json({ error: 'Ese predio no existe entre los tuyos.' });

    await queryCorredor(
      `INSERT INTO carga_parcelas (carga_id, parcela_id, aporte_pct) VALUES ($1,$2,$3)
       ON CONFLICT (carga_id, parcela_id) DO UPDATE SET aporte_pct = EXCLUDED.aporte_pct`,
      [req.params.id, parcelaId, aporte]
    );
    await logCorredor({
      usuarioId: req.usuario.sub, email: req.usuario.email, accion: 'enlazar_predio',
      entidad: 'carga', entidadId: req.params.id, detalle: { parcela_id: parcelaId, aporte_pct: aporte }, ip: req.ip,
    });
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/cargas/:id/parcelas/:parcelaId', requireAuthCorredor, requireClaveDefinida, async (req, res, next) => {
  try {
    const exportador = exportadorDeLaSesion(req);
    if (!UUID_RE.test(req.params.id) || !UUID_RE.test(req.params.parcelaId)) {
      return res.status(404).json({ error: 'No encontrado.' });
    }
    const { rowCount } = await queryCorredor(
      `DELETE FROM carga_parcelas cp USING cargas c
        WHERE cp.carga_id = c.id AND c.exportador_id = $3
          AND cp.carga_id = $1 AND cp.parcela_id = $2`,
      [req.params.id, req.params.parcelaId, exportador]
    );
    if (!rowCount) return res.status(404).json({ error: 'Ese predio no estaba enlazado a esta carga.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------- Datos de producción (los otros requisitos del EUDR) ----------
router.put('/cargas/:id/produccion', requireAuthCorredor, requireClaveDefinida, async (req, res, next) => {
  try {
    const exportador = exportadorDeLaSesion(req);
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Carga no encontrada.' });
    const { rows: c } = await queryCorredor(
      'SELECT id FROM cargas WHERE id = $1 AND exportador_id = $2', [req.params.id, exportador]
    );
    if (!c[0]) return res.status(404).json({ error: 'Carga no encontrada.' });

    const b = req.body || {};
    const fecha = (v) => (v ? String(v).slice(0, 10) : null);
    const desde = fecha(b.desde);
    const hasta = fecha(b.hasta);
    if (desde && hasta && desde > hasta) {
      return res.status(400).json({ error: 'La fecha de inicio de producción no puede ser posterior al término.' });
    }

    // "Libre de deforestación" es una afirmación que alguien tiene que
    // hacer: se exige el true explícito, no cualquier valor con verdad.
    // Y no se acepta declararlo SIN decir quién lo determinó: sicr3p no
    // hace análisis satelital, registra la determinación de un tercero.
    // Un "sí" suelto sería exactamente la declaración sin respaldo que
    // este producto existe para evitar.
    const libre = b.libre_deforestacion_declarado === true;
    const emisor = String(b.determinacion_emisor || '').trim();
    if (libre && !emisor) {
      return res.status(400).json({
        error: 'Para declarar el predio libre de deforestación hay que decir quién hizo la determinación. '
          + 'sicr3p no analiza imágenes satelitales: registra la de un tercero.',
        codigo: 'falta_emisor_determinacion',
      });
    }

    const { rows } = await queryCorredor(
      `INSERT INTO carga_produccion
         (carga_id, desde, hasta, libre_deforestacion_declarado, legalidad_declarada,
          determinacion_emisor, determinacion_linea_base, determinacion_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
       ON CONFLICT (carga_id) DO UPDATE SET
         desde = EXCLUDED.desde, hasta = EXCLUDED.hasta,
         libre_deforestacion_declarado = EXCLUDED.libre_deforestacion_declarado,
         legalidad_declarada = EXCLUDED.legalidad_declarada,
         determinacion_emisor = EXCLUDED.determinacion_emisor,
         determinacion_linea_base = EXCLUDED.determinacion_linea_base,
         determinacion_at = EXCLUDED.determinacion_at,
         updated_at = now()
       RETURNING *`,
      [req.params.id, desde, hasta, libre, b.legalidad_declarada === true,
       emisor || null, b.determinacion_linea_base || null, fecha(b.determinacion_at)]
    );
    await logCorredor({
      usuarioId: req.usuario.sub, email: req.usuario.email, accion: 'declarar_produccion',
      entidad: 'carga', entidadId: req.params.id, detalle: { libre_deforestacion: libre, emisor }, ip: req.ip,
    });
    res.json({ produccion: rows[0] });
  } catch (err) { next(err); }
});

export default router;
