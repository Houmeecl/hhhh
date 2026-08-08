import express from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../lib/db.js';
import { hashApiKey, normalizarRut } from '../services/mandante.js';
import { logActividad } from '../middleware/auth.js';
import { bigquery } from '../services/bigquery.js';
import { agregarAlcance3, parsearAlcanceGHG, CITA_CATEGORIAS_ALCANCE3 } from '../services/alcanceGhg.js';
import { categoriaParaMostrar, SQL_CATEGORIA_ATRIBUIBLE } from '../services/categoriaPresentacion.js';
import { filasACsv } from '../services/csv.js';
import { resumenNormativo, filaCbamCsv } from '../services/pasaporteOrigen.js';
import { citaFuente, generateReporteCbam } from '../services/pdf.js';

// ============================================================
// API para MANDANTES — dos caminos de acceso a los MISMOS datos:
//  1) X-Api-Key: integración de sistemas externos.
//  2) Sesión (Bearer JWT, panel='mandante', migración 042): el operador
//     humano del mandante entra por /panel-mandante/login con su propia
//     cuenta (email+contraseña), atada a esta MISMA fila de `mandantes`
//     vía usuarios.mandante_id — nunca ve datos de otro mandante.
// Una empresa mandante consulta la trazabilidad y CO2e que sus
// proveedores le han emitido. Solo ve relaciones donde ella es
// la receptora de los documentos.
// ============================================================

const router = express.Router();
const rutNorm = normalizarRut;
const NORM = (col) => `regexp_replace(COALESCE(${col},''), '[^0-9kK]', '', 'g')`;

// Autenticación por API key o por sesión de panel.
async function requireMandante(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
      let payload;
      try {
        payload = jwt.verify(authHeader.slice(7), config.jwt.accessSecret);
      } catch {
        return res.status(401).json({ error: 'Sesión expirada o inválida.' });
      }
      if (payload.panel !== 'mandante' || !payload.mandante_id) {
        return res.status(403).json({ error: 'Esta cuenta no tiene acceso al panel de mandante.' });
      }
      const { rows } = await query(`SELECT * FROM mandantes WHERE id = $1`, [payload.mandante_id]);
      const m = rows[0];
      if (!m || !m.activo) return res.status(401).json({ error: 'Mandante inactivo.' });
      req.mandante = m;
      return next();
    }
    const key = req.headers['x-api-key'];
    if (!key) return res.status(401).json({ error: 'Falta el header X-Api-Key o una sesión.' });
    const { rows } = await query(`SELECT * FROM mandantes WHERE token_hash = $1`, [hashApiKey(key)]);
    const m = rows[0];
    if (!m || !m.activo) return res.status(401).json({ error: 'API key inválida o inactiva.' });
    await query(`UPDATE mandantes SET ultimo_uso = now() WHERE id = $1`, [m.id]);
    req.mandante = m;
    next();
  } catch (err) { next(err); }
}
router.use(requireMandante);

// Lista blanca opcional de RUT proveedor para este mandante (vacía = sin restricción).
async function proveedoresPermitidos(mandanteId) {
  const { rows } = await query(
    `SELECT rut_proveedor FROM mandante_proveedores WHERE mandante_id = $1 AND activo = true`,
    [mandanteId]
  );
  return rows.map((r) => r.rut_proveedor);
}

// ---------- GET /api/mandante/proveedores ----------
// Proveedores que emiten documentos al RUT del mandante, con totales.
// Si el mandante tiene permisos finos configurados, se filtra a esa lista.
router.get('/proveedores', async (req, res, next) => {
  try {
    const rn = rutNorm(req.mandante.rut);
    const permitidos = await proveedoresPermitidos(req.mandante.id);
    const params = [rn];
    let filtroPermitidos = '';
    if (permitidos.length) {
      params.push(permitidos);
      filtroPermitidos = ` AND ${NORM('f.rut_emisor')} = ANY($${params.length})`;
    }
    const { rows } = await query(
      `SELECT ${NORM('f.rut_emisor')} AS rut_proveedor,
              COUNT(*)::int AS n_documentos,
              SUM(f.total_co2e)::float AS total_co2e,
              MAX(f.created_at) AS ultimo_documento,
              -- Solo las categorías atribuibles: el catch-all del motor no es
              -- una clasificación del documento. COALESCE porque un FILTER que
              -- no calza ninguna fila devuelve NULL, no un arreglo vacío — y
              -- hoy no calza ninguna, así que sin esto la pantalla recibe null
              -- para todos los proveedores.
              COALESCE(array_agg(DISTINCT f.categoria)
                FILTER (WHERE ${SQL_CATEGORIA_ATRIBUIBLE.replace('categoria_origen', 'f.categoria_origen')}), '{}')
                AS categorias,
              -- Su contrapeso: sin este contador la pantalla pasaría de
              -- contradecir al CSV a no decir nada, que no es lo mismo que
              -- decir la verdad.
              COUNT(*) FILTER (WHERE NOT (${SQL_CATEGORIA_ATRIBUIBLE.replace('categoria_origen', 'f.categoria_origen')})
                                  OR f.categoria_origen IS NULL)::int AS n_sin_clasificar
       FROM facturas f
       WHERE ${NORM('f.rut_receptor')} = $1 AND f.rut_emisor IS NOT NULL${filtroPermitidos}
       GROUP BY 1 ORDER BY total_co2e DESC NULLS LAST LIMIT 200`, params
    );
    res.json({ mandante: { rut: req.mandante.rut, empresa: req.mandante.nombre_empresa }, proveedores: rows });

    // Auditoría del cruce: el mandante ve datos de terceros (sus
    // proveedores) — no es un usuario de `usuarios`, así que queda sin
    // usuarioId, identificado por entidad/entidadId.
    const detalle = { rut_mandante: req.mandante.rut, n_proveedores: rows.length };
    logActividad({
      usuarioId: null, accion: 'consulta_proveedores_mandante',
      entidad: 'mandante', entidadId: req.mandante.id, detalle, ip: req.ip,
    });
    bigquery.exportAcceso({ tipo: 'consulta_proveedores_mandante', actor: { tipo: 'mandante', id: req.mandante.id }, rut_consultado: req.mandante.rut, detalle });
  } catch (err) { next(err); }
});

// ---------- GET /api/mandante/proveedor/:rut/resumen?anio=&mes= ----------
router.get('/proveedor/:rut/resumen', async (req, res, next) => {
  try {
    const rnMandante = rutNorm(req.mandante.rut);
    const rnProv = rutNorm(req.params.rut);
    const permitidos = await proveedoresPermitidos(req.mandante.id);
    if (permitidos.length && !permitidos.includes(rnProv)) {
      return res.status(403).json({ error: 'No tienes acceso a este proveedor.' });
    }
    const cond = [`${NORM('f.rut_receptor')} = $1`, `${NORM('f.rut_emisor')} = $2`];
    const params = [rnMandante, rnProv];
    if (req.query.anio) { params.push(Number(req.query.anio)); cond.push(`EXTRACT(YEAR FROM f.created_at) = $${params.length}`); }
    if (req.query.mes) { params.push(Number(req.query.mes)); cond.push(`EXTRACT(MONTH FROM f.created_at) = $${params.length}`); }

    const { rows: docs } = await query(
      `SELECT f.numero_venta, f.categoria, f.categoria_origen, f.total_co2e, f.created_at
       FROM facturas f WHERE ${cond.join(' AND ')} ORDER BY f.created_at DESC LIMIT 200`, params
    );
    // El agregado por categoría junta bajo "Sin clasificar" todo lo que no
    // salió de la glosa real del documento: acumularlo bajo el nombre del
    // catch-all lo convierte en un hallazgo ("Servicios: 40% de tus
    // emisiones") que nadie calculó. El detalle de cada documento sí conserva
    // su nombre, marcado — ver services/categoriaPresentacion.js.
    const porCategoria = {};
    let total = 0;
    for (const d of docs) {
      total += Number(d.total_co2e || 0);
      const c = categoriaParaMostrar(d).agregado;
      porCategoria[c] = (porCategoria[c] || 0) + Number(d.total_co2e || 0);
      d.categoria = categoriaParaMostrar(d).detalle;
    }
    res.json({
      proveedor: req.params.rut,
      periodo: { anio: req.query.anio || 'todos', mes: req.query.mes || 'todos' },
      n_documentos: docs.length,
      total_co2e: Math.round(total * 10000) / 10000,
      por_categoria: porCategoria,
      documentos: docs,
    });

    {
      const detalle = { rut_mandante: req.mandante.rut, rut_proveedor: req.params.rut, n_documentos: docs.length };
      logActividad({
        usuarioId: null, accion: 'consulta_proveedor_mandante',
        entidad: 'mandante', entidadId: req.mandante.id, detalle, ip: req.ip,
      });
      bigquery.exportAcceso({ tipo: 'consulta_proveedor_mandante', actor: { tipo: 'mandante', id: req.mandante.id }, rut_consultado: req.params.rut, detalle });
    }
  } catch (err) { next(err); }
});

// ---------- GET /api/mandante/export/alcance3?anio=&formato=csv|json ----------
// Export de Alcance 3 (ISSB IFRS S2 / NCG 461 de la CMF) agregado por
// proveedor y categoría GHG Protocol (1-15), para que el mandante lo
// pegue en su memoria anual. Sin LIMIT: a diferencia de /proveedores
// (vista rápida), este es un export contable de cierre — truncar en
// silencio produciría una cifra de Alcance 3 incompleta.
router.get('/export/alcance3', async (req, res, next) => {
  try {
    const rn = rutNorm(req.mandante.rut);
    const permitidos = await proveedoresPermitidos(req.mandante.id);
    const params = [rn];
    // El filtro de Alcance 3 NO va acá. Estuvo en el WHERE y era un error con
    // consecuencia contable: se aplicaba ANTES de separar lo atribuible, así
    // que un documento cuya categoría catch-all mapea fuera de Alcance 3
    // desaparecía del export Y del saldo no atribuido — subdeclaraba en
    // silencio justo lo que el pie del CSV promete declarar. Se filtra en JS,
    // después de clasificar. Sin filtro por estado ni por CO2e, igual que
    // /proveedores: así el total que el mandante ve en esa pantalla cuadra
    // con filas + otros alcances + no atribuido. (Con /proveedor/:rut/resumen
    // no tiene por qué cuadrar: esa vista trae hasta 200 documentos y admite
    // filtro por mes.)
    const cond = [`${NORM('f.rut_receptor')} = $1`, `f.rut_emisor IS NOT NULL`];
    if (permitidos.length) {
      params.push(permitidos);
      cond.push(`${NORM('f.rut_emisor')} = ANY($${params.length})`);
    }
    if (req.query.anio) {
      params.push(Number(req.query.anio));
      cond.push(`EXTRACT(YEAR FROM f.created_at) = $${params.length}`);
    }

    // JOIN por `categoria_codigo` (clave estable) con respaldo por nombre para
    // las filas anteriores a la migración 077: `categoria` guarda el NOMBRE,
    // que se edita desde el panel del motor, así que un renombre sacaba del
    // export —sin aviso— todo el histórico de esa categoría, bajando el
    // Alcance 3 informado por el mandante.
    //
    // LEFT JOIN, no JOIN: un `categoria_codigo` que ya no está en el catálogo
    // (categoría borrada del panel del motor) hacía desaparecer el documento
    // entero de la consulta. Ahora entra con `alcance_ghg` en NULL y sale
    // contado en el saldo no atribuido, que es lo que de verdad es.
    //
    // LATERAL con LIMIT 1, y no un JOIN directo, porque el respaldo por
    // nombre puede calzar con MÁS DE UNA categoría: `motor_categorias.nombre`
    // no es único y se edita libre desde el panel del motor. Con el JOIN
    // directo, dos categorías del mismo nombre duplicaban cada documento
    // histórico (los que no tienen `categoria_codigo`) y el CSV sobredeclaraba
    // Alcance 3 — en un documento que se pega en una memoria anual. El
    // `ORDER BY codigo` hace la elección estable y no al azar del planificador.
    const { rows } = await query(
      `SELECT ${NORM('f.rut_emisor')} AS rut_proveedor,
              mc.alcance_ghg, f.total_co2e, f.categoria_origen,
              fm.organismo, fm.documento, fm.version_anio
         FROM facturas f
         LEFT JOIN LATERAL (
           SELECT c.alcance_ghg, c.fuente_metodologica_id
             FROM motor_categorias c
            WHERE c.codigo = f.categoria_codigo
               OR (f.categoria_codigo IS NULL AND c.nombre = f.categoria)
            ORDER BY c.codigo
            LIMIT 1
         ) mc ON true
         LEFT JOIN fuentes_metodologicas fm ON fm.id = mc.fuente_metodologica_id
        WHERE ${cond.join(' AND ')}`,
      params
    );

    // Solo se informa como Alcance 3 el documento cuya categoría salió de una
    // palabra clave que calzó con la glosa de sus ítems. El catch-all del
    // motor ('servicios', que mapea a Cat. 1) significa "no pude clasificar
    // esto": ponerlo en el CSV como una fila Cat. 1 con su fuente citada lo
    // haría indistinguible de una atribución calculada, en un documento que
    // se pega en una memoria anual bajo NCG 461 / IFRS S2. Ver migración 077.
    //
    // Tres montones que suman el total del proveedor, sin que ninguno pueda
    // esconder al otro:
    //   · atribuible y Alcance 3 → las filas del export.
    //   · atribuible y Alcance 1 o 2 → `otros_alcances`: NO es este informe
    //     (que es de Alcance 3), pero tampoco es un saldo sin clasificar, y
    //     meterlo entre lo no atribuido inflaría lo que el mandante lee como
    //     "me falta clasificar esto".
    //   · el resto → `no_atribuido`, con su causa.
    const alcanceDe = (r) => parsearAlcanceGHG(r.alcance_ghg).alcance;
    const atribuibles = rows.filter((r) => r.categoria_origen === 'glosa' && alcanceDe(r) !== null);
    const filas = agregarAlcance3(atribuibles.filter((r) => alcanceDe(r) === 3));
    const otros = atribuibles.filter((r) => alcanceDe(r) !== 3);
    // No se esconde lo excluido: se informa aparte, con su CO2e, para que el
    // mandante sepa qué parte de su gasto quedó sin clasificar en vez de
    // creer que el export lo cubre todo.
    const esAtribuible = new Set(atribuibles);
    const sinClasificar = rows.filter((r) => !esAtribuible.has(r));
    const suma = (lista) => Math.round(lista.reduce((a, r) => a + Number(r.total_co2e || 0), 0) * 10000) / 10000;
    const noAtribuido = {
      n_documentos: sinClasificar.length,
      total_tco2e: suma(sinClasificar),
      sin_coincidencia: sinClasificar.filter((r) => r.categoria_origen === 'sin_coincidencia').length,
      // Cuarto balde, y no un detalle: el remedio de `sin_coincidencia` que el
      // panel le ofrece al mandante es "falta una palabra clave en el motor".
      // Para un documento SIN ítems que clasificar (nota de crédito, todo
      // descartado) ese consejo es falso — ninguna palabra clave lo cambia.
      // Ver migración 078.
      sin_categoria: sinClasificar.filter((r) => r.categoria_origen === 'sin_categoria').length,
      procedencia_no_registrada: sinClasificar.filter((r) => r.categoria_origen == null).length,
      // Clasificado de verdad, pero su categoría no resuelve a un alcance: el
      // texto libre `alcance_ghg` no calza el patrón, o el código ya no está
      // en el catálogo. Lo arregla un admin en el panel del motor, no el
      // mandante — por eso va contado aparte de los otros dos.
      alcance_no_legible: sinClasificar.filter((r) => r.categoria_origen === 'glosa').length,
    };
    const otrosAlcances = { n_documentos: otros.length, total_tco2e: suma(otros) };
    const anio = req.query.anio || 'todos';

    if (req.query.formato === 'csv') {
      const headers = ['rut_proveedor', 'categoria_numero', 'categoria_nombre_ghg_protocol', 'descripcion_motor', 'n_documentos', 'total_tco2e', 'fuente_factor'];
      const csv = filasACsv(headers, filas.map((f) => ({
        rut_proveedor: f.rut_proveedor,
        categoria_numero: f.categoria_numero ?? '',
        categoria_nombre_ghg_protocol: f.categoria_nombre ?? '',
        descripcion_motor: f.descripcion_motor,
        n_documentos: f.n_documentos,
        total_tco2e: f.total_tco2e.toFixed(4),
        fuente_factor: f.fuente_factor,
      })));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="alcance3_${rn}_${anio}.csv"`);
      // El saldo no atribuido va como comentario al pie: no puede ir como una
      // fila más (no tiene categoría GHG) ni puede omitirse, o el CSV se leería
      // como la totalidad del gasto clasificado.
      // Los números del pie van en formato de máquina (punto decimal, sin
      // separador de miles) igual que las columnas de arriba: es una línea
      // dentro de un CSV, y una coma decimal la partiría en dos celdas.
      const pieNoAtribuido = noAtribuido.n_documentos > 0
        ? `\n# ${noAtribuido.n_documentos} documento(s) por ${noAtribuido.total_tco2e.toFixed(4)} tCO2e sin categoría GHG atribuible`
          + ` (${noAtribuido.sin_coincidencia} sin coincidencia en el motor,`
          + ` ${noAtribuido.sin_categoria} sin items que clasificar,`
          + ` ${noAtribuido.procedencia_no_registrada} sin procedencia registrada,`
          + ` ${noAtribuido.alcance_no_legible} con categoría sin alcance legible): no incluidos arriba.`
        : '';
      // Alcance 1 y 2 quedan fuera por definición del informe, no por falta de
      // dato: decirlo evita que el mandante lea la diferencia contra su
      // contabilidad como documentos perdidos.
      const pieOtros = otrosAlcances.n_documentos > 0
        ? `\n# ${otrosAlcances.n_documentos} documento(s) por ${otrosAlcances.total_tco2e.toFixed(4)} tCO2e con categoría de Alcance 1 o 2:`
          + ` fuera de este informe, que es solo de Alcance 3.`
        : '';
      const pie = pieNoAtribuido || pieOtros ? `${pieNoAtribuido}${pieOtros}\n` : '';
      res.send('\uFEFF' + csv + pie); // BOM: Excel abre con tildes/ñ correctas
    } else {
      res.json({
        mandante: { rut: req.mandante.rut, empresa: req.mandante.nombre_empresa },
        periodo: { anio },
        metodologia: { taxonomia_categorias: CITA_CATEGORIAS_ALCANCE3 },
        filas,
        no_atribuido: noAtribuido,
        otros_alcances: otrosAlcances,
      });
    }

    const detalle = { rut_mandante: req.mandante.rut, anio, n_filas: filas.length, n_no_atribuidos: noAtribuido.n_documentos, formato: req.query.formato === 'csv' ? 'csv' : 'json' };
    logActividad({ usuarioId: null, accion: 'export_alcance3_mandante', entidad: 'mandante', entidadId: req.mandante.id, detalle, ip: req.ip });
    bigquery.exportAcceso({ tipo: 'export_alcance3_mandante', actor: { tipo: 'mandante', id: req.mandante.id }, rut_consultado: req.mandante.rut, detalle });
  } catch (err) { next(err); }
});

// ---------- GET /api/mandante/export/cbam?formato=csv|json ----------
// Export de apoyo CBAM (Reglamento UE 2023/956) de los lotes minerales del
// mandante exportador, reusando tal cual el cálculo ya construido en
// pasaporteOrigen.js — este endpoint solo lo expone como documento.
//
// A diferencia de /export/alcance3 (que ancla la consulta en
// f.rut_receptor = el propio RUT del mandante, y la whitelist SOLO acota
// más), lotes_minerales no tiene ningún campo "receptor": el titular del
// lote (rut_titular) es un tercero cuya relación con el mandante existe
// SOLO si está en mandante_proveedores. Por eso aquí la whitelist no es
// opcional — sin ella no hay ninguna forma segura de decidir qué lotes le
// pertenecen a este mandante, así que una whitelist vacía devuelve un
// export vacío (nunca "todos los lotes") para no filtrar datos de terceros.
async function lotesCbamDelMandante(req) {
  const permitidos = await proveedoresPermitidos(req.mandante.id);
  if (!permitidos.length) return [];
  const { rows } = await query(
    `SELECT codigo, pais_origen, material, codigo_nc, cantidad, unidad, faena_origen,
            emisiones_directas_tco2e_t, emisiones_indirectas_tco2e_t, metodo_emisiones,
            estado, created_at
       FROM lotes_minerales
      WHERE ${NORM('rut_titular')} = ANY($1)
      ORDER BY created_at DESC LIMIT 500`,
    [permitidos]
  );
  return rows.map((l) => ({ ...l, cbam: resumenNormativo(l, []).cbam }));
}

router.get('/export/cbam', async (req, res, next) => {
  try {
    const rn = rutNorm(req.mandante.rut);
    const lotes = await lotesCbamDelMandante(req);
    const metodologia = citaFuente({
      organismo: 'Unión Europea',
      documento: 'Reglamento (UE) 2023/956 — Mecanismo de Ajuste en Frontera por Carbono (CBAM)',
      version_anio: '2023',
    });

    if (req.query.formato === 'csv') {
      const headers = ['codigo', 'pais_origen', 'material', 'codigo_nc', 'cbam_aplicable', 'metodo_emisiones', 'emisiones_directas_tco2e_t', 'emisiones_indirectas_tco2e_t', 'cbam_listo', 'cbam_faltantes'];
      const csv = filasACsv(headers, lotes.map(filaCbamCsv));
      const filaMeta = `\r\n"${metodologia.replace(/"/g, '""')} — datos de apoyo, no sustituye verificación acreditada."\r\n`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="cbam_${rn}.csv"`);
      res.send('\uFEFF' + csv + filaMeta);
    } else {
      res.json({
        mandante: { rut: req.mandante.rut, empresa: req.mandante.nombre_empresa },
        periodo: { generado: new Date().toISOString() },
        metodologia,
        lotes,
      });
    }

    const detalle = { rut_mandante: req.mandante.rut, n_lotes: lotes.length, formato: req.query.formato === 'csv' ? 'csv' : 'json' };
    logActividad({ usuarioId: null, accion: 'export_cbam_mandante', entidad: 'mandante', entidadId: req.mandante.id, detalle, ip: req.ip });
    bigquery.exportAcceso({ tipo: 'export_cbam_mandante', actor: { tipo: 'mandante', id: req.mandante.id }, rut_consultado: req.mandante.rut, detalle });
  } catch (err) { next(err); }
});

// ---------- GET /api/mandante/export/cbam.pdf ----------
router.get('/export/cbam.pdf', async (req, res, next) => {
  try {
    const lotes = await lotesCbamDelMandante(req);
    const buffer = await generateReporteCbam({ mandante: req.mandante, lotes });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="cbam_${rutNorm(req.mandante.rut)}.pdf"`);
    res.send(buffer);

    const detalle = { rut_mandante: req.mandante.rut, n_lotes: lotes.length, formato: 'pdf' };
    logActividad({ usuarioId: null, accion: 'export_cbam_mandante', entidad: 'mandante', entidadId: req.mandante.id, detalle, ip: req.ip });
    bigquery.exportAcceso({ tipo: 'export_cbam_mandante', actor: { tipo: 'mandante', id: req.mandante.id }, rut_consultado: req.mandante.rut, detalle });
  } catch (err) { next(err); }
});

export default router;
