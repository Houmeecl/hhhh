import express from 'express';
import bcrypt from 'bcryptjs';
import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server';
import { config } from '../config.js';
import { query, withTx } from '../lib/db.js';
import { requireAuth, requireRole, requireHomePanel, logActividad } from '../middleware/auth.js';
import { simpleApi } from '../services/simpleApi.js';
import { generarPasswordTemporal } from '../services/cuentas.js';
import {
  PLANTILLA_VERSION, PUNTOS_PENDIENTES, TIPOS, TIPOS_DE, TIPO_POR_DEFECTO, tipoValido,
  generarNumeroContrato, snapshotCliente, snapshotDe, hashContrato, clausulas, clausulasPendientes,
} from '../services/contrato.js';
import { generateContrato } from '../services/pdf.js';
import { empresa as clayEmpresa, dtes as clayDtes, productosPorDocumento as clayProductos } from '../services/clay.js';
import { auspiciadorDesdeSolicitud } from '../services/auspicio.js';
import { prospectoDesdeInscripcion } from '../services/inscripcion.js';
import {
  MOTOR_CLAY, SII_EXCLUIDOS, datosDeDte, admiteDte, itemsDeDte,
  agruparLineas, resumirImportacion,
} from '../services/clayCarbono.js';
import { cargarCategorias, calcularFactura } from '../services/motorPropio.js';
import { cargarCuentas, registrarMovimientos } from '../services/capitalNatural.js';
import { hashDocumento, siguienteEslabon } from '../services/cadenaHash.js';
import { PLAZOS, purgar, nombresDeTareas } from '../services/retencion.js';
import { INVENTARIO, retenidoPorLey } from '../services/inventarioDatos.js';
import { consultarRut } from '../services/baseapi.js';
import { siiLimiterAdmin } from '../middleware/rateLimit.js';
import { generarSerialLlave, generarToken, generarPin, hashToken } from '../services/llaveArchivo.js';

const router = express.Router();

// Todas las rutas de admin requieren sesión.
router.use(requireAuth, requireHomePanel('sicrep'));
const adminOnly = requireRole('admin');

// ============================================================
// DASHBOARD
// ============================================================
router.get('/dashboard', async (req, res, next) => {
  try {
    const [
      clientes, sesionesMes, sesionesMesAnt, facturasMes, facturasMesAnt,
      co2eAcum, co2eMes, co2eMesAnt, ping, uso, serieSesiones, serieFacturas, actividadReciente,
    ] = await Promise.all([
      query(`SELECT estado_contrato, count(*)::int AS n FROM clientes GROUP BY estado_contrato`),
      query(`SELECT count(*)::int AS n FROM sesiones WHERE date_trunc('month', created_at) = date_trunc('month', now())`),
      query(`SELECT count(*)::int AS n FROM sesiones WHERE date_trunc('month', created_at) = date_trunc('month', now()) - interval '1 month'`),
      query(`SELECT count(*)::int AS n FROM facturas WHERE date_trunc('month', created_at) = date_trunc('month', now())`),
      query(`SELECT count(*)::int AS n FROM facturas WHERE date_trunc('month', created_at) = date_trunc('month', now()) - interval '1 month'`),
      query(`SELECT COALESCE(sum(total_co2e),0)::float AS total FROM sesiones`),
      query(`SELECT COALESCE(sum(total_co2e),0)::float AS total FROM sesiones WHERE date_trunc('month', created_at) = date_trunc('month', now())`),
      query(`SELECT COALESCE(sum(total_co2e),0)::float AS total FROM sesiones WHERE date_trunc('month', created_at) = date_trunc('month', now()) - interval '1 month'`),
      simpleApi.ping(),
      query(`SELECT count(*)::int AS llamadas, COALESCE(sum(costo_estimado),0)::float AS costo
             FROM simple_api_uso WHERE date_trunc('month', created_at) = date_trunc('month', now())`),
      query(`SELECT date_trunc('month', created_at) AS mes, count(*)::int AS n, COALESCE(sum(total_co2e),0)::float AS co2e
             FROM sesiones WHERE created_at >= date_trunc('month', now()) - interval '5 months' GROUP BY 1`),
      query(`SELECT date_trunc('month', created_at) AS mes, count(*)::int AS n
             FROM facturas WHERE created_at >= date_trunc('month', now()) - interval '5 months' GROUP BY 1`),
      query(`SELECT a.accion, a.entidad, a.entidad_id, a.created_at, u.email AS usuario_email
             FROM actividad_log a LEFT JOIN usuarios u ON u.id = a.usuario_id
             ORDER BY a.created_at DESC LIMIT 6`),
    ]);
    const porEstado = { piloto: 0, activo: 0, vencido: 0 };
    for (const r of clientes.rows) porEstado[r.estado_contrato] = r.n;

    // Serie de los últimos 6 meses (incluido el actual), rellenando con 0
    // los meses sin datos — para que el gráfico siempre tenga 6 puntos.
    const mapaSesiones = new Map(serieSesiones.rows.map((r) => [r.mes.toISOString().slice(0, 7), r]));
    const mapaFacturas = new Map(serieFacturas.rows.map((r) => [r.mes.toISOString().slice(0, 7), r.n]));
    const serieMensual = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - i, 1));
      const clave = d.toISOString().slice(0, 7);
      const s = mapaSesiones.get(clave);
      serieMensual.push({
        mes: clave,
        sesiones: s?.n || 0,
        co2e: s?.co2e || 0,
        facturas: mapaFacturas.get(clave) || 0,
      });
    }

    // Variación % vs. mes anterior (null si el mes anterior fue 0, para no
    // mostrar un falso "+infinito%").
    const variacion = (actual, anterior) => (anterior > 0 ? Math.round(((actual - anterior) / anterior) * 1000) / 10 : null);

    res.json({
      clientes_por_estado: porEstado,
      sesiones_mes: sesionesMes.rows[0].n,
      sesiones_mes_var: variacion(sesionesMes.rows[0].n, sesionesMesAnt.rows[0].n),
      facturas_mes: facturasMes.rows[0].n,
      facturas_mes_var: variacion(facturasMes.rows[0].n, facturasMesAnt.rows[0].n),
      co2e_acumulado: co2eAcum.rows[0].total,
      co2e_mes: co2eMes.rows[0].total,
      co2e_mes_var: variacion(co2eMes.rows[0].total, co2eMesAnt.rows[0].total),
      simple_api: { ...ping, mock: simpleApi.mock },
      consumo_api_mes: uso.rows[0],
      serie_mensual: serieMensual,
      actividad_reciente: actividadReciente.rows,
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

// Situación tributaria pública del SII por RUT (vía BaseAPI), para
// autocompletar el alta de clientes. Va ANTES de las rutas /clientes/:id
// en orden de lectura, pero Express igual la distingue por el prefijo
// fijo /clientes/sii/. Apagado limpio (503) si no hay BASEAPI_API_KEY.
router.get('/clientes/sii/:rut', adminOnly, siiLimiterAdmin, async (req, res, next) => {
  try {
    if (!config.baseapi.enabled) {
      return res.status(503).json({ error: 'Consulta SII no configurada (BASEAPI_API_KEY).' });
    }
    const situacion = await consultarRut(req.params.rut);
    await logActividad({ usuarioId: req.user.sub, accion: 'sii_consulta', entidad: 'cliente', entidadId: null, detalle: { rut: req.params.rut }, ip: req.ip });
    res.json({ situacion });
  } catch (err) {
    if (err.sinRegistro) return res.status(404).json({ error: 'RUT sin registro en el SII.' });
    if (err.message === 'RUT inválido') return res.status(400).json({ error: 'RUT inválido.' });
    next(err);
  }
});

// Dar de alta una empresa emite además SU CONTRATO, en la misma
// transacción: una empresa sin contrato no debería poder existir. Sale en
// estado 'borrador' porque la plantilla todavía tiene puntos pendientes de
// revisión legal (ver services/contrato.js) — el documento se genera solo,
// pero no se firma hasta que un abogado cierre esos puntos.
router.post('/clientes', adminOnly, async (req, res, next) => {
  try {
    const { rut, nombre_empresa, contacto_email, estado_contrato, fecha_inicio, fecha_fin, plan } = req.body;
    if (!rut || !nombre_empresa) return res.status(400).json({ error: 'RUT y nombre de empresa son obligatorios' });

    const { cliente, contrato } = await withTx(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO clientes (rut, nombre_empresa, contacto_email, estado_contrato, fecha_inicio, fecha_fin, plan)
         VALUES ($1,$2,$3,COALESCE($4,'piloto'),$5,$6,$7) RETURNING *`,
        [rut, nombre_empresa, contacto_email || null, estado_contrato, fecha_inicio || null, fecha_fin || null, plan || 'piloto']
      );
      return { cliente: rows[0], contrato: await emitirContrato(client, rows[0], req.body.tipo_contrato) };
    });

    await logActividad({ usuarioId: req.user.sub, accion: 'crear_cliente', entidad: 'cliente', entidadId: cliente.id, detalle: { contrato: contrato.numero }, ip: req.ip });
    res.status(201).json({ cliente, contrato });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe un cliente con ese RUT' });
    next(err);
  }
});

// Inserta el contrato de un cliente dentro de la transacción del llamador.
// El número es aleatorio; ante una colisión (improbable pero posible) se
// reintenta en vez de tumbar el alta de la empresa.
async function emitirContrato(client, entidad, tipoPedido, sujeto = 'cliente') {
  const permitidos = TIPOS_DE(sujeto);
  const tipo = tipoValido(tipoPedido) && permitidos.includes(tipoPedido)
    ? tipoPedido
    : (sujeto === 'auspiciador' ? 'auspicio' : TIPO_POR_DEFECTO);
  const datos = snapshotDe(entidad, tipo);
  const columna = sujeto === 'auspiciador' ? 'auspiciador_id' : 'cliente_id';
  for (let intento = 0; intento < 5; intento += 1) {
    const numero = generarNumeroContrato();
    const created_at = new Date().toISOString();
    const hash = hashContrato({ numero, plantilla_version: PLANTILLA_VERSION, tipo, datos, created_at });
    try {
      const { rows } = await client.query(
        `INSERT INTO contratos (${columna}, numero, plantilla_version, tipo, estado, datos, hash_documento, created_at)
         VALUES ($1,$2,$3,$4,'borrador',$5,$6,$7) RETURNING *`,
        [entidad.id, numero, PLANTILLA_VERSION, tipo, JSON.stringify(datos), hash, created_at]
      );
      return rows[0];
    } catch (err) {
      // 23505 en `numero` = colisión del aleatorio: reintentar. Cualquier
      // otra violación (p. ej. uq_contratos_vigente) es un error real.
      if (err.code === '23505' && String(err.constraint || '').includes('numero')) continue;
      throw err;
    }
  }
  throw new Error('No se pudo generar un número de contrato único');
}

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

// CREAR CUENTA: el correo no se envía (correo saliente no confiable). Se
// genera aquí una contraseña temporal que se muestra UNA sola vez en este
// response; la cuenta queda activa de inmediato con must_reset_password=true
// (mismo criterio que crearCuentaEntidad de routes/accesos.js).
router.post('/clientes/:id/crear-cuenta', adminOnly, async (req, res, next) => {
  try {
    const { rows: cRows } = await query(`SELECT * FROM clientes WHERE id = $1`, [req.params.id]);
    const cliente = cRows[0];
    if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });
    const email = String(req.body.email || cliente.contacto_email || '').toLowerCase();
    if (!email) return res.status(400).json({ error: 'Se requiere un correo de contacto' });

    const nombre = req.body.nombre || cliente.nombre_empresa;
    const password = generarPasswordTemporal();
    const hash = await bcrypt.hash(password, config.bcryptRounds);
    const { rows: uRows } = await query(
      `INSERT INTO usuarios (email, nombre, rol, cliente_id, estado, password_hash, must_reset_password)
       VALUES ($1,$2,'cliente',$3,'activo',$4,true)
       ON CONFLICT (email) DO NOTHING RETURNING id`,
      [email, nombre, cliente.id, hash]
    );
    if (!uRows[0]) return res.status(409).json({ error: 'Ya existe un usuario con ese correo' });

    await logActividad({ usuarioId: req.user.sub, accion: 'crear_cuenta', entidad: 'usuario', entidadId: uRows[0].id, detalle: { email }, ip: req.ip });

    res.status(201).json({ ok: true, usuario_id: uRows[0].id, email, password });
  } catch (err) { next(err); }
});

// Consulta los datos de una empresa en Clay para prellenar el alta. Solo
// LEE: nunca escribe en `clientes`. Quien da de alta decide si acepta lo que
// viene o corrige — el dato que quede es el que se congela en el contrato,
// así que no se pisa nada en silencio.
router.get('/clientes/consultar-rut/:rut', adminOnly, async (req, res, next) => {
  try {
    const { datos, limites } = await clayEmpresa(req.params.rut);
    const nombre = datos?.name || null;
    if (!nombre) return res.status(404).json({ error: 'Clay no devolvió el nombre de esa empresa' });
    res.json({
      empresa: {
        nombre_empresa: nombre,
        rut: datos?.dv ? `${datos.rut}-${datos.dv}` : (datos?.rut || null),
      },
      solicitudes_restantes: limites.restantes,
    });
  } catch (err) {
    // Que Clay esté apagado, sin token o caído no puede tumbar el panel: el
    // alta manual sigue siendo el camino principal, esto es una ayuda.
    if (err.status) return res.status(err.status === 404 ? 404 : 502).json({ error: err.message });
    return res.status(503).json({ error: err.message });
  }
});

// ---------- Importar la contabilidad de carbono desde Clay ----------
// El flujo de siempre es un documento a la vez. Cuando son cientos de
// facturas de un período eso no escala, y es exactamente el caso de un
// cliente con contabilidad ya llevada en Clay: los DTE están ahí,
// sincronizados desde el SII.
//
// Se trae el LIBRO DE COMPRAS del período (lo que la empresa compró = sus
// emisiones aguas arriba) y se arma una sesión con todas sus facturas,
// encadenadas contra la misma cadena global que el resto.
//
// El método sale POR GASTO: Clay no entrega unidad de medida en el detalle
// de línea. Cargar el XML del documento sí habilita además el método
// físico. Se informa en la respuesta, no se esconde.
router.post('/clientes/:id/importar-clay', adminOnly, async (req, res, next) => {
  const { desde, hasta } = req.body || {};
  if (!desde) return res.status(400).json({ error: 'Indica la fecha `desde` (YYYY-MM-DD) del período a importar' });

  try {
    const { rows: cRows } = await query(`SELECT * FROM clientes WHERE id = $1`, [req.params.id]);
    const cliente = cRows[0];
    if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });

    // 1. Traer de Clay FUERA de la transacción: la red puede tardar y no
    //    puede tener bloqueada la fila de cadena_estado mientras tanto —
    //    ese lock serializa a todos los que estén subiendo documentos.
    const { datos: dteRes } = await clayDtes({ rut: cliente.rut, recibidos: true, desde, hasta, excluirTipos: SII_EXCLUIDOS, limite: 500 });
    const documentos = dteRes?.items || (Array.isArray(dteRes) ? dteRes : []);
    if (!documentos.length) return res.status(404).json({ error: 'Clay no devolvió documentos de compra en ese período' });

    let lineas = [];
    try {
      const { datos: prodRes } = await clayProductos({ rut: cliente.rut, recibidos: true, desde, hasta, limite: 500 });
      lineas = prodRes?.items || (Array.isArray(prodRes) ? prodRes : []);
    } catch {
      // Sin detalle de líneas se calcula igual, con un ítem único por el
      // neto de cada documento. Menos resolución, mismo total.
    }
    const porDocumento = agruparLineas(lineas);

    const admitidos = [];
    const omitidos = [];
    for (const dte of documentos) {
      const { admite, motivo } = admiteDte(dte);
      if (admite) admitidos.push(dte); else omitidos.push({ clay_id: dte?.id, motivo });
    }
    if (!admitidos.length) {
      return res.status(422).json({ error: 'Ningún documento del período entra al cálculo', ...resumirImportacion({ admitidos, omitidos }) });
    }

    // 2. Calcular y persistir en una transacción, encadenando cada factura.
    const resultado = await withTx(async (client) => {
      const categorias = await cargarCategorias((sql) => client.query(sql));
      const cuentasNaturales = await cargarCuentas((sql) => client.query(sql));

      const { rows: sRows } = await client.query(
        `INSERT INTO sesiones (rut_cliente, nombre_cliente, email_cliente) VALUES ($1,$2,$3) RETURNING *`,
        [cliente.rut, cliente.nombre_empresa, cliente.contacto_email || null]
      );
      const sesion = sRows[0];

      // Qué documentos ya se importaron antes. Se consulta ANTES de
      // insertar: si se dejara que reviente el índice único, el error
      // aborta la transacción completa en Postgres y las facturas
      // siguientes del lote fallarían todas con "transaction is aborted".
      // El índice queda igual, como red de seguridad ante una carrera.
      const idsClay = admitidos.map((d) => d?.id).filter(Boolean);
      const { rows: yaRows } = await client.query(
        `SELECT clay_id FROM facturas WHERE clay_id = ANY($1::text[])`, [idsClay]
      );
      const yaImportados = new Set(yaRows.map((r) => r.clay_id));

      const { rows: eRows } = await client.query(`SELECT * FROM cadena_estado WHERE id = 1 FOR UPDATE`);
      let estado = eRows[0];
      let total = 0;
      let importadas = 0;
      let repetidas = 0;

      for (const dte of admitidos) {
        const d = datosDeDte(dte);
        if (yaImportados.has(d.clay_id)) { repetidas += 1; continue; }
        const items = itemsDeDte(dte, porDocumento);
        if (!items.length) { omitidos.push({ clay_id: d.clay_id, motivo: 'sin ítems calculables' }); continue; }

        // `origen` queda en el valor por defecto ('texto'): sin unidad de
        // medida el método físico no aplica, y forzar otro origen diría
        // que sí sin poder sostenerlo.
        const calc = calcularFactura(items, categorias);
        const hDoc = hashDocumento({
          numero_venta: d.numero_venta, rut_emisor: d.rut_emisor, rut_receptor: d.rut_receptor,
          total_co2e: calc.total_co2e, categoria: calc.categoria, archivo_original: `clay:${d.clay_id}`,
        });
        const { hash_cadena: hCad, eslabon } = siguienteEslabon(estado, hDoc);

        const { rows: fRows } = await client.query(
            `INSERT INTO facturas
               (sesion_id, numero_venta, archivo_original, rut_emisor, rut_receptor,
                total_co2e, categoria, status, motor, clay_id,
                hash_documento, hash_anterior, hash_cadena, eslabon)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'procesada',$8,$9,$10,$11,$12,$13) RETURNING *`,
            [sesion.id, d.numero_venta, `clay:${d.clay_id}`, d.rut_emisor, d.rut_receptor,
             calc.total_co2e, calc.categoria, MOTOR_CLAY, d.clay_id,
             hDoc, estado.ultimo_hash, hCad, eslabon]
        );
        const factura = fRows[0];

        estado = { ...estado, ultimo_hash: hCad, n_eslabones: eslabon };
        for (const it of calc.items) {
          await client.query(
            `INSERT INTO line_items (factura_id, descripcion, cantidad, co2e, porcentaje_total, metodo)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [factura.id, it.descripcion, it.cantidad, it.co2e, it.porcentaje_total, it.metodo || null]
          );
        }
        await registrarMovimientos({ client, factura, fecha: sesion.fecha, cuentas: cuentasNaturales });
        total += Number(calc.total_co2e || 0);
        importadas += 1;
      }

      if (!importadas) {
        const e = new Error('Todos los documentos del período ya estaban importados');
        e.status = 409; throw e;
      }

      await client.query(
        `UPDATE cadena_estado SET ultimo_hash = $1, n_eslabones = $2, updated_at = now() WHERE id = 1`,
        [estado.ultimo_hash, estado.n_eslabones]
      );
      await client.query(`UPDATE sesiones SET total_co2e = $1 WHERE id = $2`, [total, sesion.id]);
      return { sesion, importadas, repetidas, total_co2e: total };
    });

    await logActividad({
      usuarioId: req.user.sub, accion: 'importar_clay', entidad: 'sesion', entidadId: resultado.sesion.id,
      detalle: { rut: cliente.rut, desde, hasta, documentos: resultado.importadas }, ip: req.ip,
    });

    res.status(201).json({
      sesion_id: resultado.sesion.id,
      total_co2e: resultado.total_co2e,
      ya_importados: resultado.repetidas,
      ...resumirImportacion({ admitidos, omitidos }),
      documentos: resultado.importadas,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
});

// Contrato vigente del cliente. Los clientes dados de alta antes de la
// migración 043 no tienen contrato: se responde 404 y el panel ofrece
// generarlo, en vez de fabricar uno en silencio al leer.
router.get('/clientes/:id/contrato', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM contratos WHERE cliente_id = $1 AND estado <> 'anulado' ORDER BY created_at DESC LIMIT 1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Este cliente todavía no tiene contrato' });
    res.json({ contrato: rows[0], puntos_pendientes: PUNTOS_PENDIENTES });
  } catch (err) { next(err); }
});

// Emite el contrato de un cliente que no lo tiene (alta anterior a la
// migración 043). Si ya hay uno vigente devuelve 409: reemplazarlo es otra
// operación, no un efecto secundario de pedirlo de nuevo.
router.post('/clientes/:id/contrato', adminOnly, async (req, res, next) => {
  try {
    const contrato = await withTx(async (client) => {
      const { rows: cRows } = await client.query(`SELECT * FROM clientes WHERE id = $1 FOR UPDATE`, [req.params.id]);
      if (!cRows[0]) { const e = new Error('Cliente no encontrado'); e.status = 404; throw e; }
      const { rows: yaHay } = await client.query(
        `SELECT id FROM contratos WHERE cliente_id = $1 AND estado <> 'anulado' LIMIT 1`, [req.params.id]
      );
      if (yaHay[0]) { const e = new Error('Este cliente ya tiene un contrato vigente'); e.status = 409; throw e; }
      return emitirContrato(client, cRows[0], req.body?.tipo_contrato);
    });
    await logActividad({ usuarioId: req.user.sub, accion: 'emitir_contrato', entidad: 'contrato', entidadId: contrato.id, ip: req.ip });
    res.status(201).json({ contrato });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.get('/clientes/:id/contrato.pdf', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM contratos WHERE cliente_id = $1 AND estado <> 'anulado' ORDER BY created_at DESC LIMIT 1`,
      [req.params.id]
    );
    const contrato = rows[0];
    if (!contrato) return res.status(404).json({ error: 'Este cliente todavía no tiene contrato' });
    const buf = await pdfDeContrato(contrato);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="contrato-${contrato.numero}.pdf"`);
    res.send(buf);
  } catch (err) { next(err); }
});

// ---------- Postulaciones de auspicio ----------
router.get('/solicitudes-auspicio', async (req, res, next) => {
  try {
    const estado = ['pendiente', 'aceptada', 'rechazada'].includes(req.query.estado) ? req.query.estado : null;
    const { rows } = await query(
      `SELECT s.*, u.nombre AS resuelta_por_nombre
         FROM solicitudes_auspicio s
         LEFT JOIN usuarios u ON u.id = s.resuelta_por
        WHERE ($1::text IS NULL OR s.estado = $1)
        ORDER BY s.created_at DESC LIMIT 200`,
      [estado]
    );
    res.json({ solicitudes: rows });
  } catch (err) { next(err); }
});

// Aceptar crea el auspiciador y emite sus contratos, todo en la misma
// transacción: si algo falla, la postulación sigue pendiente en vez de
// quedar aceptada sin auspiciador detrás.
router.post('/solicitudes-auspicio/:id/aceptar', adminOnly, async (req, res, next) => {
  try {
    const salida = await withTx(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM solicitudes_auspicio WHERE id = $1 FOR UPDATE`, [req.params.id]
      );
      const sol = rows[0];
      if (!sol) { const e = new Error('Postulación no encontrada'); e.status = 404; throw e; }
      if (sol.estado !== 'pendiente') {
        const e = new Error(`Esta postulación ya está ${sol.estado}`); e.status = 409; throw e;
      }

      const base = auspiciadorDesdeSolicitud(sol);
      const { rows: aRows } = await client.query(
        `INSERT INTO auspiciadores (rut, nombre_empresa, contacto_email, aporta_vehiculo, vehiculo, fecha_inicio, fecha_fin)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7) RETURNING *`,
        [base.rut, base.nombre_empresa, base.contacto_email, base.aporta_vehiculo,
         JSON.stringify(base.vehiculo), req.body?.fecha_inicio || null, req.body?.fecha_fin || null]
      );
      const auspiciador = aRows[0];

      const contratos = [await emitirContrato(client, auspiciador, 'auspicio', 'auspiciador')];
      if (auspiciador.aporta_vehiculo) {
        contratos.push(await emitirContrato(client, auspiciador, 'comodato', 'auspiciador'));
      }

      await client.query(
        `UPDATE solicitudes_auspicio
            SET estado = 'aceptada', auspiciador_id = $2, resuelta_por = $3, resuelta_at = now()
          WHERE id = $1`,
        [sol.id, auspiciador.id, req.user.sub]
      );
      return { auspiciador, contratos };
    });

    await logActividad({ usuarioId: req.user.sub, accion: 'aceptar_auspicio', entidad: 'auspiciador', entidadId: salida.auspiciador.id, detalle: { solicitud: req.params.id }, ip: req.ip });
    res.status(201).json(salida);
  } catch (err) {
    // Ya existía un auspiciador con ese RUT: es un caso real (postuló dos
    // veces, o se dio de alta a mano antes), no un error del servidor.
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe un auspiciador con ese RUT' });
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.post('/solicitudes-auspicio/:id/rechazar', adminOnly, async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE solicitudes_auspicio
          SET estado = 'rechazada', motivo_rechazo = $2, resuelta_por = $3, resuelta_at = now()
        WHERE id = $1 AND estado = 'pendiente' RETURNING *`,
      [req.params.id, String(req.body?.motivo || '').slice(0, 500) || null, req.user.sub]
    );
    if (!rows[0]) return res.status(409).json({ error: 'La postulación no existe o ya fue resuelta' });
    await logActividad({ usuarioId: req.user.sub, accion: 'rechazar_auspicio', entidad: 'solicitud_auspicio', entidadId: req.params.id, ip: req.ip });
    res.json({ solicitud: rows[0] });
  } catch (err) { next(err); }
});

// ---------- Inscripciones de empresas (formulario público /inscripcion) ----------
router.get('/solicitudes-inscripcion', async (req, res, next) => {
  try {
    const estado = ['pendiente', 'convertida', 'descartada'].includes(req.query.estado) ? req.query.estado : null;
    const { rows } = await query(
      `SELECT s.*, u.nombre AS resuelta_por_nombre
         FROM solicitudes_inscripcion s
         LEFT JOIN usuarios u ON u.id = s.resuelta_por
        WHERE ($1::text IS NULL OR s.estado = $1)
        ORDER BY s.created_at DESC LIMIT 200`,
      [estado]
    );
    res.json({ solicitudes: rows });
  } catch (err) { next(err); }
});

// Convertir crea el prospecto en el pipeline comercial y marca la
// solicitud, en la misma transacción: si algo falla, la inscripción
// sigue pendiente en vez de quedar convertida sin prospecto detrás.
router.post('/solicitudes-inscripcion/:id/convertir', async (req, res, next) => {
  try {
    const salida = await withTx(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM solicitudes_inscripcion WHERE id = $1 FOR UPDATE`, [req.params.id]
      );
      const sol = rows[0];
      if (!sol) { const e = new Error('Inscripción no encontrada'); e.status = 404; throw e; }
      if (sol.estado !== 'pendiente') {
        const e = new Error(`Esta inscripción ya está ${sol.estado}`); e.status = 409; throw e;
      }

      const base = prospectoDesdeInscripcion(sol);
      const { rows: pRows } = await client.query(
        `INSERT INTO prospectos (nombre_empresa, rut, contacto, etapa, origen, notas)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [base.nombre_empresa, base.rut, base.contacto, base.etapa, base.origen, base.notas]
      );
      const prospecto = pRows[0];

      await client.query(
        `UPDATE solicitudes_inscripcion
            SET estado = 'convertida', prospecto_id = $2, resuelta_por = $3, resuelta_at = now()
          WHERE id = $1`,
        [sol.id, prospecto.id, req.user.sub]
      );
      return { prospecto };
    });

    await logActividad({ usuarioId: req.user.sub, accion: 'convertir_inscripcion', entidad: 'prospecto', entidadId: salida.prospecto.id, detalle: { solicitud: req.params.id }, ip: req.ip });
    res.status(201).json(salida);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.post('/solicitudes-inscripcion/:id/descartar', async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE solicitudes_inscripcion
          SET estado = 'descartada', resuelta_por = $2, resuelta_at = now()
        WHERE id = $1 AND estado = 'pendiente' RETURNING *`,
      [req.params.id, req.user.sub]
    );
    if (!rows[0]) return res.status(409).json({ error: 'La inscripción no existe o ya fue resuelta' });
    await logActividad({ usuarioId: req.user.sub, accion: 'descartar_inscripcion', entidad: 'solicitud_inscripcion', entidadId: req.params.id, ip: req.ip });
    res.json({ solicitud: rows[0] });
  } catch (err) { next(err); }
});

// ---------- Auspiciadores (SICR3P-LEGAL-01 y 06) ----------
// Un auspiciador no es un cliente: aporta recursos al programa Ruta SICR3P
// (vehículo, dinero, difusión) y firma su propio convenio. Se le da de alta
// con el mismo control que a un cliente — registro, contrato generado y
// sellado — porque es exactamente lo que se pidió.
router.get('/auspiciadores', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT a.*, (
         SELECT json_agg(json_build_object('id', c.id, 'numero', c.numero, 'tipo', c.tipo, 'estado', c.estado))
           FROM contratos c WHERE c.auspiciador_id = a.id AND c.estado <> 'anulado'
       ) AS contratos
       FROM auspiciadores a ORDER BY a.created_at DESC`
    );
    res.json({ auspiciadores: rows });
  } catch (err) { next(err); }
});

// El alta emite el Convenio Marco; si además aporta vehículo, emite también
// el comodato. Los dos en la misma transacción que el alta: un auspiciador
// sin convenio no debería existir.
router.post('/auspiciadores', adminOnly, async (req, res, next) => {
  try {
    const { rut, nombre_empresa, contacto_email, aporta_vehiculo, vehiculo, fecha_inicio, fecha_fin } = req.body || {};
    if (!rut || !nombre_empresa) return res.status(400).json({ error: 'RUT y nombre son obligatorios' });

    const salida = await withTx(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO auspiciadores (rut, nombre_empresa, contacto_email, aporta_vehiculo, vehiculo, fecha_inicio, fecha_fin)
         VALUES ($1,$2,$3,COALESCE($4,false),COALESCE($5,'{}')::jsonb,$6,$7) RETURNING *`,
        [rut, nombre_empresa, contacto_email || null, aporta_vehiculo, JSON.stringify(vehiculo || {}), fecha_inicio || null, fecha_fin || null]
      );
      const a = rows[0];
      const contratos = [await emitirContrato(client, a, 'auspicio', 'auspiciador')];
      if (a.aporta_vehiculo) contratos.push(await emitirContrato(client, a, 'comodato', 'auspiciador'));
      return { auspiciador: a, contratos };
    });

    await logActividad({ usuarioId: req.user.sub, accion: 'crear_auspiciador', entidad: 'auspiciador', entidadId: salida.auspiciador.id, detalle: { contratos: salida.contratos.map((c) => c.numero) }, ip: req.ip });
    res.status(201).json(salida);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe un auspiciador con ese RUT' });
    next(err);
  }
});

// Emite un contrato de auspicio que falte (p. ej. el comodato, si el
// vehículo se acordó después del alta).
router.post('/auspiciadores/:id/contrato', adminOnly, async (req, res, next) => {
  try {
    const contrato = await withTx(async (client) => {
      const { rows } = await client.query(`SELECT * FROM auspiciadores WHERE id = $1 FOR UPDATE`, [req.params.id]);
      if (!rows[0]) { const e = new Error('Auspiciador no encontrado'); e.status = 404; throw e; }
      return emitirContrato(client, rows[0], req.body?.tipo, 'auspiciador');
    });
    await logActividad({ usuarioId: req.user.sub, accion: 'emitir_contrato', entidad: 'contrato', entidadId: contrato.id, ip: req.ip });
    res.status(201).json({ contrato });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ese contrato ya está vigente para este auspiciador' });
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.get('/auspiciadores/:id/contrato.pdf', async (req, res, next) => {
  try {
    const tipo = tipoValido(req.query.tipo) ? req.query.tipo : 'auspicio';
    const { rows } = await query(
      `SELECT * FROM contratos WHERE auspiciador_id = $1 AND tipo = $2 AND estado <> 'anulado' ORDER BY created_at DESC LIMIT 1`,
      [req.params.id, tipo]
    );
    const contrato = rows[0];
    if (!contrato) return res.status(404).json({ error: 'Ese contrato no existe para este auspiciador' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="contrato-${contrato.numero}.pdf"`);
    res.send(await pdfDeContrato(contrato));
  } catch (err) { next(err); }
});

// Arma el PDF de un contrato ya emitido, sea de cliente o de auspiciador.
function pdfDeContrato(contrato) {
  const meta = TIPOS[contrato.tipo] || TIPOS[TIPO_POR_DEFECTO];
  return generateContrato({
    contrato,
    titulo: meta.titulo.toUpperCase(),
    codigo: meta.codigo,
    clausulas: clausulas(contrato.datos, contrato.tipo),
    pendientes: clausulasPendientes(contrato.datos, contrato.tipo).length ? PUNTOS_PENDIENTES : [],
  });
}

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
      `SELECT u.id, u.email, u.nombre, u.rol, u.panel, u.estado, u.must_reset_password, u.ultimo_login,
              u.created_at, c.nombre_empresa AS cliente,
              (SELECT count(*) FROM credenciales_webauthn cw WHERE cw.usuario_id = u.id) AS num_llaves_usb,
              (SELECT count(*) FROM credenciales_archivo ca WHERE ca.usuario_id = u.id AND ca.activo) AS num_llaves_archivo
       FROM usuarios u LEFT JOIN clientes c ON c.id = u.cliente_id
       ORDER BY u.created_at DESC`
    );
    res.json({ usuarios: rows });
  } catch (err) { next(err); }
});

// Alta general de usuario interno para cualquier panel. El correo no se
// envía: se genera aquí una contraseña temporal que se muestra UNA sola vez
// en este response; la cuenta queda activa de inmediato con
// must_reset_password=true (mismo criterio que crearCuentaEntidad de
// routes/accesos.js). Para 'puerto'/'mandante'/'agencia'/'trazador' este
// endpoint no resuelve la entidad (puerto_id/mandante_id/agencia_id/
// trazador_id): esos paneles se dan de alta por routes/accesos.js, que ya
// trae la entidad resuelta — si igual se intenta aquí sin ese id, el CHECK
// usuarios_panel_entidad_check de la migración correspondiente rechaza el
// INSERT tal cual lo hacía antes.
router.post('/usuarios', adminOnly, async (req, res, next) => {
  try {
    const { email, nombre, rol, cliente_id, panel } = req.body;
    if (!email || !nombre) return res.status(400).json({ error: 'Email y nombre son obligatorios' });
    const emailNorm = String(email).toLowerCase();
    const password = generarPasswordTemporal();
    const hash = await bcrypt.hash(password, config.bcryptRounds);
    const { rows } = await query(
      `INSERT INTO usuarios (email, nombre, rol, cliente_id, panel, estado, password_hash, must_reset_password)
       VALUES ($1,$2,COALESCE($3,'operador'),$4,COALESCE($5,'sicrep'),'activo',$6,true)
       ON CONFLICT (email) DO NOTHING RETURNING id, email, nombre, rol`,
      [emailNorm, nombre, rol, cliente_id || null, panel, hash]
    );
    if (!rows[0]) return res.status(409).json({ error: 'Ya existe un usuario con ese correo' });

    await logActividad({ usuarioId: req.user.sub, accion: 'crear_usuario', entidad: 'usuario', entidadId: rows[0].id, ip: req.ip });

    res.status(201).json({ usuario: rows[0], password });
  } catch (err) { next(err); }
});

// Genera una contraseña temporal NUEVA para un usuario ya existente (deja
// must_reset_password=true) — reemplaza al antiguo reenvío de correo de
// activación, que perdió sentido: con el alta ya sin estado 'pendiente' no
// hay ninguna cuenta "atascada" esperando un enlace. Sirve también como
// recuperación general, dado que el correo de reset tampoco es confiable.
router.post('/usuarios/:id/reenviar-activacion', adminOnly, async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT id FROM usuarios WHERE id = $1`, [req.params.id]);
    const usuario = rows[0];
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

    const password = generarPasswordTemporal();
    const hash = await bcrypt.hash(password, config.bcryptRounds);
    await query(`UPDATE usuarios SET password_hash = $1, must_reset_password = true WHERE id = $2`, [hash, usuario.id]);
    await logActividad({ usuarioId: req.user.sub, accion: 'regenerar_password', entidad: 'usuario', entidadId: usuario.id, ip: req.ip });
    res.json({ ok: true, password });
  } catch (err) { next(err); }
});

router.put('/usuarios/:id', adminOnly, async (req, res, next) => {
  try {
    const { rol, estado, nombre, panel } = req.body;
    const { rows } = await query(
      `UPDATE usuarios SET rol = COALESCE($2,rol), estado = COALESCE($3,estado), nombre = COALESCE($4,nombre),
              panel = COALESCE($5,panel)
       WHERE id = $1 RETURNING id, email, nombre, rol, panel, estado`,
      [req.params.id, rol, estado, nombre, panel]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Usuario no encontrado' });
    await logActividad({ usuarioId: req.user.sub, accion: 'editar_usuario', entidad: 'usuario', entidadId: req.params.id, ip: req.ip });
    res.json({ usuario: rows[0] });
  } catch (err) { next(err); }
});

// ---------- Llaves USB de huella (WebAuthn/FIDO2) — ver migración 061 ----------
// El registro lo hace un admin, no el propio usuario (autoservicio queda
// pendiente, no es parte de esta ronda). El login con la llave ya
// registrada es público: vive en routes/webauthn.js.
router.get('/usuarios/:id/webauthn', adminOnly, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, nombre_dispositivo, created_at, last_used_at
       FROM credenciales_webauthn WHERE usuario_id = $1 ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json({ llaves: rows });
  } catch (err) { next(err); }
});

router.post('/usuarios/:id/webauthn/opciones', adminOnly, async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT id, email FROM usuarios WHERE id = $1`, [req.params.id]);
    const usuario = rows[0];
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

    const { rows: existentes } = await query(
      `SELECT credential_id, transports FROM credenciales_webauthn WHERE usuario_id = $1`,
      [usuario.id]
    );

    const options = await generateRegistrationOptions({
      rpName: config.webauthn.rpName,
      rpID: config.webauthn.rpID,
      userName: usuario.email,
      userID: Buffer.from(usuario.id),
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
      excludeCredentials: existentes.map((c) => ({ id: c.credential_id, transports: c.transports || undefined })),
    });

    await query(
      `INSERT INTO webauthn_challenges (usuario_id, tipo, challenge, expires_at)
       VALUES ($1,'registro',$2,$3)
       ON CONFLICT (usuario_id, tipo) DO UPDATE SET challenge = EXCLUDED.challenge, expires_at = EXCLUDED.expires_at, created_at = now()`,
      [usuario.id, options.challenge, new Date(Date.now() + config.webauthn.challengeTtlMs)]
    );

    res.json(options);
  } catch (err) { next(err); }
});

router.post('/usuarios/:id/webauthn/verificar', adminOnly, async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT id FROM usuarios WHERE id = $1`, [req.params.id]);
    const usuario = rows[0];
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

    const respuesta = req.body.respuesta;
    const nombreDispositivo = String(req.body.nombre_dispositivo || '').trim() || null;
    if (!respuesta) return res.status(400).json({ error: 'Falta la respuesta de la llave' });

    const { rows: desafios } = await query(
      `SELECT * FROM webauthn_challenges WHERE usuario_id = $1 AND tipo = 'registro'`,
      [usuario.id]
    );
    const desafio = desafios[0];
    if (!desafio || new Date(desafio.expires_at) < new Date()) {
      return res.status(400).json({ error: 'El desafío expiró, intenta nuevamente' });
    }

    let verificacion;
    try {
      verificacion = await verifyRegistrationResponse({
        response: respuesta,
        expectedChallenge: desafio.challenge,
        expectedOrigin: config.webauthn.origin,
        expectedRPID: config.webauthn.rpID,
      });
    } catch {
      return res.status(400).json({ error: 'Respuesta de la llave inválida' });
    }
    if (!verificacion.verified) return res.status(400).json({ error: 'No se pudo verificar la llave' });

    await query(`DELETE FROM webauthn_challenges WHERE id = $1`, [desafio.id]);

    const { credential, credentialDeviceType, credentialBackedUp } = verificacion.registrationInfo;
    const { rows: creadas } = await query(
      `INSERT INTO credenciales_webauthn
         (usuario_id, credential_id, public_key, counter, device_type, backed_up, transports, nombre_dispositivo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, nombre_dispositivo, created_at`,
      [
        usuario.id,
        credential.id,
        Buffer.from(credential.publicKey).toString('base64'),
        credential.counter,
        credentialDeviceType,
        credentialBackedUp,
        JSON.stringify(credential.transports || []),
        nombreDispositivo,
      ]
    );

    await logActividad({ usuarioId: req.user.sub, accion: 'registrar_llave_webauthn', entidad: 'usuario', entidadId: usuario.id, ip: req.ip });
    res.status(201).json({ credencial: creadas[0] });
  } catch (err) { next(err); }
});

router.delete('/usuarios/:id/webauthn/:credencialId', adminOnly, async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `DELETE FROM credenciales_webauthn WHERE id = $1 AND usuario_id = $2`,
      [req.params.credencialId, req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Llave no encontrada' });
    await logActividad({ usuarioId: req.user.sub, accion: 'eliminar_llave_webauthn', entidad: 'usuario', entidadId: req.params.id, ip: req.ip });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------- Llave de archivo (credencial en un .sicr3p-llave) — ver migración 068 ----------
// Tercera vía de acceso junto a la contraseña y la llave USB de huella:
// más simple de repartir, y por eso MÁS DÉBIL — un archivo se puede
// copiar. El PIN que la acompaña se verifica en el servidor (con
// bloqueo tras varios fallos), nunca cifrando el archivo. El registro
// también lo hace un admin; el login ya emitido es público y vive en
// routes/llaveArchivo.js.
router.get('/usuarios/:id/llaves-archivo', adminOnly, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, serial, nombre, activo, intentos_fallidos, bloqueado_hasta, created_at, last_used_at
       FROM credenciales_archivo WHERE usuario_id = $1 ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json({ llaves: rows });
  } catch (err) { next(err); }
});

router.post('/usuarios/:id/llaves-archivo', adminOnly, async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT id, email FROM usuarios WHERE id = $1`, [req.params.id]);
    const usuario = rows[0];
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

    const nombre = String(req.body?.nombre || '').trim() || null;
    const token = generarToken();
    const pin = generarPin();
    const pinHash = await bcrypt.hash(pin, config.bcryptRounds);

    // Reintenta ante una colisión de serial (improbable, 2 bytes de espacio
    // compartido con tarjetas/credenciales de otro prefijo) en vez de fallar.
    let creada;
    for (let intento = 0; intento < 5 && !creada; intento++) {
      try {
        const { rows: ins } = await query(
          `INSERT INTO credenciales_archivo (usuario_id, serial, token_hash, pin_hash, nombre)
           VALUES ($1,$2,$3,$4,$5) RETURNING id, serial, nombre, created_at`,
          [usuario.id, generarSerialLlave(), hashToken(token), pinHash, nombre]
        );
        creada = ins[0];
      } catch (e) {
        if (e.code !== '23505') throw e;
      }
    }
    if (!creada) return res.status(500).json({ error: 'No se pudo generar un serial único, intenta de nuevo' });

    await logActividad({ usuarioId: req.user.sub, accion: 'emitir_llave_archivo', entidad: 'usuario', entidadId: usuario.id, detalle: { serial: creada.serial }, ip: req.ip });

    // El token y el PIN viajan en claro SOLO en esta respuesta — igual que
    // la clave de una tarjeta de viaje o una credencial de proveedor.
    res.status(201).json({
      credencial: creada,
      pin,
      archivo: {
        version: 1,
        tipo: 'llave-archivo',
        serial: creada.serial,
        email: usuario.email,
        emitida: creada.created_at,
        token,
      },
    });
  } catch (err) { next(err); }
});

router.post('/usuarios/:id/llaves-archivo/:credId/revocar', adminOnly, async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `UPDATE credenciales_archivo SET activo = false WHERE id = $1 AND usuario_id = $2 AND activo`,
      [req.params.credId, req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Llave no encontrada o ya revocada' });
    await logActividad({ usuarioId: req.user.sub, accion: 'revocar_llave_archivo', entidad: 'usuario', entidadId: req.params.id, ip: req.ip });
    res.json({ ok: true });
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

// ---------- Retención de datos personales (Ley 21.719) ----------
// La ley no pide tener una política de retención: pide poder demostrar
// que se aplica. Por eso se expone el historial de purgas junto con los
// plazos vigentes y el inventario de qué se conserva y por qué.
router.get('/retencion', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT p.*, u.email AS usuario_email
         FROM purgas p LEFT JOIN usuarios u ON u.id = p.usuario_id
        ORDER BY p.created_at DESC LIMIT 50`
    );
    res.json({
      purgas: rows,
      plazos: PLAZOS,
      tareas: nombresDeTareas(),
      retenido_por_ley: retenidoPorLey(),
      // Los plazos son valores por defecto razonables, no cifras del
      // texto de la ley. Que quien mire el panel lo sepa.
      nota_plazos: 'Los plazos son configurables y están pendientes de confirmación legal.',
    });
  } catch (err) { next(err); }
});

// Correrla a mano, sin esperar al temporizador diario.
router.post('/retencion/purgar', adminOnly, async (req, res, next) => {
  try {
    const r = await purgar({ origen: 'manual', usuarioId: req.user.sub });
    await logActividad({ usuarioId: req.user.sub, accion: 'purgar_datos', entidad: 'retencion', detalle: { filas: r.filas }, ip: req.ip });
    res.json(r);
  } catch (err) { next(err); }
});

// ---------- Derechos del titular (ARCOP) ----------
router.get('/arcop', async (req, res, next) => {
  try {
    const estado = ['pendiente', 'resuelta', 'rechazada'].includes(req.query.estado) ? req.query.estado : null;
    const { rows } = await query(
      `SELECT s.*, u.nombre AS resuelta_por_nombre
         FROM solicitudes_arcop s
         LEFT JOIN usuarios u ON u.id = s.resuelta_por
        WHERE ($1::text IS NULL OR s.estado = $1)
        -- Las pendientes primero y de la más antigua a la más nueva: hay
        -- un plazo de respuesta y lo que lleva más días esperando es lo
        -- que primero se pasa de él.
        ORDER BY (s.estado = 'pendiente') DESC, s.created_at ASC
        LIMIT 200`,
      [estado]
    );
    res.json({
      solicitudes: rows.map((s) => ({
        ...s,
        dias_esperando: diasEsperando(s.created_at),
        fuera_de_plazo: s.estado === 'pendiente' && fueraDePlazo(s.created_at),
      })),
      plazo_dias: PLAZO_RESPUESTA_DIAS,
      derechos: ETIQUETA_DERECHO,
    });
  } catch (err) { next(err); }
});

// Qué hay de este titular. Es la respuesta al derecho de ACCESO y, en el
// mismo contenido, la de PORTABILIDAD — cambia el envase, no el dato.
//
// Las tablas se recorren desde el inventario, así que una tabla nueva con
// datos personales entra sola en cuanto se clasifica (y el test obliga a
// clasificarla).
router.get('/arcop/:id/datos', async (req, res, next) => {
  try {
    const { rows: sRows } = await query(`SELECT * FROM solicitudes_arcop WHERE id = $1`, [req.params.id]);
    const sol = sRows[0];
    if (!sol) return res.status(404).json({ error: 'Solicitud no encontrada' });

    const hallazgos = [];
    for (const destino of dondeBuscar(sol)) {
      // Nombres de tabla y columna vienen del inventario, que es código
      // del repositorio, no de la petición: no hay inyección posible por
      // acá. Aun así se validan contra el catálogo real de Postgres.
      const { rows: cols } = await query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1 AND column_name = ANY($2)`,
        [destino.tabla, destino.columnas]
      );
      const columnas = cols.map((c) => c.column_name);
      if (!columnas.length) continue;

      const where = columnas.map((c, i) => `${c} = $${i + 1}`).join(' OR ');
      const valores = columnas.map((c) => (/email|correo/i.test(c) ? sol.email : sol.rut));
      const { rows: filas } = await query(
        `SELECT * FROM ${destino.tabla} WHERE ${where} LIMIT 500`, valores
      );
      hallazgos.push({ tabla: destino.tabla, filas });
    }

    await logActividad({
      usuarioId: req.user.sub, accion: 'arcop_consultar_datos',
      entidad: 'solicitud_arcop', entidadId: sol.id, ip: req.ip,
    });

    res.json(armarPaquete({
      titular: { rut: sol.rut, email: sol.email, nombre: sol.nombre },
      hallazgos,
      generadoAt: new Date().toISOString(),
    }));
  } catch (err) { next(err); }
});

// Qué se puede borrar y qué queda retenido, con su fundamento. La
// pantalla lo muestra ANTES de confirmar una supresión, para que la
// respuesta al titular salga del sistema y no de la memoria de quien
// atiende.
router.get('/arcop/limites-supresion', async (req, res, next) => {
  try {
    res.json(limitesDeSupresion());
  } catch (err) { next(err); }
});

// Resolver: se registra qué se respondió. NO ejecuta borrados automáticos
// —cada derecho se atiende con criterio y algunos datos no se pueden
// eliminar—, pero deja constancia de la respuesta, que es lo que la ley
// exige poder demostrar.
router.post('/arcop/:id/resolver', adminOnly, async (req, res, next) => {
  try {
    const estado = req.body?.estado === 'rechazada' ? 'rechazada' : 'resuelta';
    const resolucion = String(req.body?.resolucion || '').trim().slice(0, 4000);
    if (!resolucion) return res.status(400).json({ error: 'Escribe qué se respondió al titular' });

    const { rows } = await query(
      `UPDATE solicitudes_arcop
          SET estado = $2, resolucion = $3, resuelta_por = $4, resuelta_at = now()
        WHERE id = $1 AND estado = 'pendiente' RETURNING *`,
      [req.params.id, estado, resolucion, req.user.sub]
    );
    if (!rows[0]) return res.status(409).json({ error: 'La solicitud no existe o ya fue resuelta' });

    await logActividad({
      usuarioId: req.user.sub, accion: 'arcop_resolver', entidad: 'solicitud_arcop',
      entidadId: req.params.id, detalle: { estado, derecho: rows[0].derecho }, ip: req.ip,
    });
    res.json({ solicitud: rows[0] });
  } catch (err) { next(err); }
});

// ---------- Brechas de seguridad ----------
// Se llenan a mano: no hay detección automática y fingir que la hay sería
// peor que no tenerla. Lo que aporta la tabla es la cronología —cuándo
// ocurrió, cuándo se supo, cuándo se avisó—, que en una brecha es la
// defensa.
router.get('/brechas', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT b.*, u.nombre AS registrada_por_nombre
         FROM brechas_seguridad b
         LEFT JOIN usuarios u ON u.id = b.registrada_por
        ORDER BY (b.estado <> 'cerrada') DESC, b.detectada_at DESC LIMIT 200`
    );
    res.json({ brechas: rows });
  } catch (err) { next(err); }
});

router.post('/brechas', adminOnly, async (req, res, next) => {
  try {
    const b = req.body || {};
    const titulo = String(b.titulo || '').trim().slice(0, 200);
    const descripcion = String(b.descripcion || '').trim().slice(0, 5000);
    if (!titulo || !descripcion) {
      return res.status(400).json({ error: 'Una brecha necesita al menos qué pasó y una descripción' });
    }
    const { rows } = await query(
      `INSERT INTO brechas_seguridad
         (titulo, descripcion, ocurrida_at, datos_afectados, titulares_afectados, riesgo, registrada_por)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,'por_evaluar'),$7) RETURNING *`,
      [titulo, descripcion, b.ocurrida_at || null, b.datos_afectados || null,
       Number.isFinite(Number(b.titulares_afectados)) ? Number(b.titulares_afectados) : null,
       b.riesgo, req.user.sub]
    );
    await logActividad({ usuarioId: req.user.sub, accion: 'registrar_brecha', entidad: 'brecha', entidadId: rows[0].id, ip: req.ip });
    res.status(201).json({ brecha: rows[0] });
  } catch (err) { next(err); }
});

// Actualizar: riesgo, estado, medidas y las fechas de notificación. Solo
// se tocan los campos que vienen, para que marcar "ya avisamos a la
// Agencia" no pise el resto.
router.put('/brechas/:id', adminOnly, async (req, res, next) => {
  try {
    const b = req.body || {};
    const { rows } = await query(
      `UPDATE brechas_seguridad SET
         riesgo = COALESCE($2, riesgo),
         estado = COALESCE($3, estado),
         medidas = COALESCE($4, medidas),
         datos_afectados = COALESCE($5, datos_afectados),
         titulares_afectados = COALESCE($6, titulares_afectados),
         notificada_agencia_at = COALESCE($7, notificada_agencia_at),
         notificados_titulares_at = COALESCE($8, notificados_titulares_at),
         motivo_no_notificar = COALESCE($9, motivo_no_notificar),
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [req.params.id, b.riesgo || null, b.estado || null, b.medidas || null,
       b.datos_afectados || null,
       Number.isFinite(Number(b.titulares_afectados)) ? Number(b.titulares_afectados) : null,
       b.notificada_agencia_at || null, b.notificados_titulares_at || null,
       b.motivo_no_notificar || null]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Brecha no encontrada' });
    await logActividad({ usuarioId: req.user.sub, accion: 'actualizar_brecha', entidad: 'brecha', entidadId: req.params.id, ip: req.ip });
    res.json({ brecha: rows[0] });
  } catch (err) { next(err); }
});

// El registro de actividades de tratamiento, para exportarlo cuando la
// Agencia lo pida. Sale del mismo inventario que usan la purga y ARCOP,
// así que no puede quedar desincronizado con el código.
router.get('/retencion/registro', async (req, res, next) => {
  try {
    res.json({
      generado_at: new Date().toISOString(),
      responsable: 'sicr3p',
      tratamientos: Object.entries(INVENTARIO).map(([tabla, e]) => ({ tabla, ...e })),
    });
  } catch (err) { next(err); }
});

export default router;
