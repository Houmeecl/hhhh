import express from 'express';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query, withTx } from '../lib/db.js';
import { simpleApi } from '../services/simpleApi.js';
import { generateReport, generateLabel, generateExpedienteLote, generateCarpetaMandante } from '../services/pdf.js';
import { qrBuffer, qrBufferDe, pasaporteUrl, verifyUrl, loteUrl, tarjetaUrl } from '../services/qr.js';
import { montoUsdDesdeClp } from '../services/compensacion.js';
import {
  filtrarPorVisibilidad, enmascararRut, balanceMasas,
  emisionesIncorporadasPorTonelada, resumenNormativo,
} from '../services/pasaporteOrigen.js';
import { sendMail, reporteEmail, enviarComprobantePos } from '../services/mailer.js';
import { cargarCuentas, registrarMovimientos } from '../services/capitalNatural.js';
import { bigquery } from '../services/bigquery.js';
import { cargarCategorias, calcularFactura } from '../services/motorPropio.js';
import { leerDocumento, filaRechazo } from '../services/lecturaDocumento.js';
import { normalizarRut, dispararWebhook } from '../services/mandante.js';
import { contrapartesDeRut } from '../services/trazabilidad.js';
import { hashDocumento, hashCadena, eslabonValido, verificarCadenaCompleta, siguienteEslabon } from '../services/cadenaHash.js';
import { validarComponentes, calcularReciclabilidad, hashDeclaracionEmbalaje } from '../services/rep.js';
import { validarCompensacion, calcularMonto } from '../services/compensacion.js';
import { generarSelloSvg } from '../services/sello.js';
import { filaEslabonPublico, hashCorto } from '../services/cadenaPublica.js';

const router = express.Router();

// Kill switch del motor externo: con MOTOR_EXTERNO=off ningún documento
// del cliente sale a un motor de terceros — lo irresoluble se rechaza
// (nunca se completa a mano). Se lee por request (no al cargar el
// módulo) para poder probarlo en vivo.
const motorExternoActivo = () =>
  String(process.env.MOTOR_EXTERNO || 'on').toLowerCase() !== 'off';

// Almacenamiento en memoria; solo guardamos el nombre original (no el binario).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: config.maxFilesPerSession },
  fileFilter: (req, file, cb) => {
    const ok = /\.(pdf|xml|jpe?g|png|heic)$/i.test(file.originalname);
    cb(ok ? null : new Error('Formato no permitido'), ok);
  },
});

// Carga completa de una tabla de ítems para una lista de facturas.
async function hydrateFacturas(sesionId) {
  const { rows: facturas } = await query(
    `SELECT * FROM facturas WHERE sesion_id = $1 ORDER BY created_at`,
    [sesionId]
  );
  for (const f of facturas) {
    const { rows: items } = await query(
      `SELECT descripcion, cantidad, co2e, porcentaje_total FROM line_items WHERE factura_id = $1`,
      [f.id]
    );
    f.items = items;
  }
  return facturas;
}

// Envuelve multer para devolver el mensaje amigable del límite duro de la demo.
function uploadArchivos(req, res, next) {
  upload.array('archivos', config.maxFilesPerSession)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ error: 'Puedes cargar hasta 5 facturas por envío. Contáctanos para más.' });
      }
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Cada archivo debe pesar menos de 15 MB.' });
      }
      return res.status(400).json({ error: 'No se pudo procesar la carga de archivos.' });
    }
    if (err) return res.status(400).json({ error: err.message || 'Formato no permitido.' });
    next();
  });
}

// ---------- GET /api/codigos/:codigo — estado de un código de acceso ----------
router.get('/codigos/:codigo', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT codigo, creditos, creditos_usados, activo, empresa FROM codigos_acceso
       WHERE upper(codigo) = upper($1)`,
      [String(req.params.codigo).trim()]
    );
    const c = rows[0];
    if (!c || !c.activo) return res.status(404).json({ error: 'Código inválido o inactivo.' });
    // Marca la primera conexión (entrar con el código), distinta de consumir
    // un crédito (subir una factura, ver public.js más abajo) — solo la
    // primera vez, para poder distinguir en el admin "nunca entró" de
    // "entró pero no llegó a subir nada".
    await query(
      `UPDATE codigos_acceso SET primera_conexion_at = now()
       WHERE codigo = $1 AND primera_conexion_at IS NULL`,
      [c.codigo]
    );
    res.json({
      valido: true,
      codigo: c.codigo,
      empresa: c.empresa,
      creditos_restantes: Math.max(0, c.creditos - c.creditos_usados),
    });
  } catch (err) { next(err); }
});

// ---------- GET /api/publico/calculadora — factores públicos de estimación ----------
// Expone SOLO lo necesario para que cualquiera estime su CO2e antes de
// registrarse: tarifa vigente + factores por categoría activa. Nada de
// palabras clave ni fuentes internas del motor.
router.get('/publico/calculadora', async (req, res, next) => {
  try {
    // Tipo de cambio USD→CLP (migración 018): NULL = sin fijar, y el
    // frontend no muestra USD. Defensivo: si la columna aún no existe,
    // se consulta solo la tarifa y el tipo de cambio queda en null.
    let cfg = null;
    try {
      const { rows } = await query(
        `SELECT tarifa_clp_tco2e, tipo_cambio_usd_clp FROM config_pos WHERE id = 1`
      );
      cfg = rows[0];
    } catch {
      const { rows } = await query(`SELECT tarifa_clp_tco2e FROM config_pos WHERE id = 1`);
      cfg = rows[0];
    }
    const tarifa = Number(cfg?.tarifa_clp_tco2e ?? 5000);
    const tipoCambio = cfg?.tipo_cambio_usd_clp != null ? Number(cfg.tipo_cambio_usd_clp) : null;

    const { rows } = await query(
      `SELECT codigo, nombre, unidad_fisica, factor_fisico_kgco2e, factor_gasto_kgco2e_clp1000
       FROM motor_categorias WHERE activo = true ORDER BY codigo`
    );
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({
      tarifa_clp_tco2e: tarifa,
      tipo_cambio_usd_clp: tipoCambio,
      categorias: rows.map((r) => ({
        codigo: r.codigo,
        nombre: r.nombre,
        unidad_fisica: r.unidad_fisica,
        factor_fisico_kgco2e: r.factor_fisico_kgco2e === null ? null : Number(r.factor_fisico_kgco2e),
        factor_gasto_kgco2e_clp1000: Number(r.factor_gasto_kgco2e_clp1000),
      })),
    });
  } catch (err) { next(err); }
});

// ---------- GET /api/publico/cadena — estado público de la cadena de hash ----------
// Vista anonimizada (ver services/cadenaPublica.js): jamás RUT, empresa,
// folio ni archivo. La verificación completa recalcula toda la cadena, así
// que se cachea en memoria por 5 minutos; el listado de últimos eslabones
// es barato y se consulta fresco en cada visita.
const CADENA_CACHE_TTL_MS = 5 * 60 * 1000;
let cadenaCache = { resultado: null, n: 0, ultimoHash: '', ts: 0 };

router.get('/publico/cadena', async (req, res, next) => {
  try {
    // La cadena global = facturas + anclajes de lotes cerrados (022),
    // que comparten la secuencia de cadena_estado.
    if (!cadenaCache.resultado || Date.now() - cadenaCache.ts > CADENA_CACHE_TTL_MS) {
      const { rows } = await query(
        `SELECT id::text AS id, eslabon, hash_anterior, hash_documento, hash_cadena FROM (
           SELECT id, eslabon, hash_anterior, hash_documento, hash_cadena
           FROM facturas WHERE hash_cadena IS NOT NULL
           UNION ALL
           SELECT id, eslabon, hash_anterior, hash_documento, hash_cadena
           FROM cadena_anclajes
         ) t ORDER BY eslabon ASC`
      );
      cadenaCache = {
        resultado: verificarCadenaCompleta(rows),
        n: rows.length,
        ultimoHash: rows[rows.length - 1]?.hash_cadena || '',
        ts: Date.now(),
      };
    }

    const { rows: ultimos } = await query(
      `SELECT id::text AS id, eslabon, created_at, hash_cadena, total_co2e, tipo FROM (
         SELECT id, eslabon, created_at, hash_cadena, total_co2e, 'documento' AS tipo
         FROM facturas WHERE hash_cadena IS NOT NULL
         UNION ALL
         SELECT id, eslabon, created_at, hash_cadena, NULL AS total_co2e, 'anclaje' AS tipo
         FROM cadena_anclajes
       ) t ORDER BY eslabon DESC LIMIT 20`
    );

    const r = cadenaCache.resultado;
    res.json({
      estado: {
        n_eslabones: cadenaCache.n,
        ultimo_hash_corto: hashCorto(r.ultimo_hash || cadenaCache.ultimoHash),
        intacta: r.valido === true,
        verificado_hace_s: Math.floor((Date.now() - cadenaCache.ts) / 1000),
      },
      eslabones: ultimos.map(filaEslabonPublico),
    });
  } catch (err) { next(err); }
});

// Bitácora de rechazos: se escribe con el pool (FUERA de cualquier
// transacción) para que sobreviva al rollback del envío. Defensiva con
// la migración 030 sin correr (42P01): jamás rompe la respuesta 422.
async function registrarRechazos(filas) {
  for (const f of filas) {
    try {
      await query(
        `INSERT INTO documentos_rechazados
           (nombre_archivo, extension, tamano_bytes, sha256, motivo, etapa_alcanzada, rut_cliente)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [f.nombre_archivo, f.extension, f.tamano_bytes, f.sha256, f.motivo, f.etapa_alcanzada, f.rut_cliente]
      );
    } catch (err) {
      if (err.code !== '42P01') console.warn('[rechazos] no se pudo registrar:', err.message);
    }
  }
}

// ---------- POST /api/sesiones — procesa hasta 5 facturas ----------
router.post('/sesiones', uploadArchivos, async (req, res, next) => {
  try {
    const { rut, empresa, email, codigo } = req.body;
    const files = req.files || [];

    if (!rut || !empresa || !email) {
      return res.status(400).json({ error: 'Faltan datos: RUT, empresa y email son obligatorios.' });
    }
    if (files.length === 0) {
      return res.status(400).json({ error: 'Debes subir al menos una factura.' });
    }
    // Límite duro por envío.
    if (files.length > config.maxFilesPerSession) {
      return res.status(400).json({
        error: 'Puedes cargar hasta 5 facturas por envío. Contáctanos para más.',
      });
    }

    // Pre-lectura FUERA de la transacción: el OCR puede tardar decenas de
    // segundos por archivo y antes corría con la fila de cadena_estado
    // bloqueada, serializando todos los envíos concurrentes. Ahora el lock
    // se toma recién con las lecturas ya resueltas.
    const lecturas = [];
    for (const file of files) {
      // El RUT del formulario es la identidad del trámite (no un dato de
      // factura): si aparece en el documento, ancla quién es el receptor.
      lecturas.push(await leerDocumento(file.buffer, file.originalname, { rutReceptorEsperado: rut }));
    }

    // Rechazos del lote — TODOS de una vez (el operador re-escanea solo
    // esos) y con registro en la bitácora, que sobrevive porque la sesión
    // ni siquiera se intenta. Dos causas:
    //  - tipo 'rechazo' (ej. monto fuera de rango = lectura corrupta):
    //    SIEMPRE se rechaza, con o sin motor externo.
    //  - tipo 'sin_senal': se rechaza solo con el motor externo apagado
    //    (encendido, ese documento va al motor externo dentro de la tx).
    const externoActivo = motorExternoActivo();
    const indicesRechazados = lecturas
      .map((l, i) => (l.tipo === 'rechazo' || (l.tipo === 'sin_senal' && !externoActivo) ? i : -1))
      .filter((i) => i >= 0);
    if (indicesRechazados.length > 0) {
      await registrarRechazos(
        indicesRechazados.map((i) => filaRechazo(files[i], lecturas[i], rut, lecturas[i].motivo || 'sin_senal'))
      );
      const nombres = indicesRechazados.map((i) => files[i].originalname);
      const plural = nombres.length > 1;
      // Los documentos rechazados por tipo (nota de crédito/débito, guía de
      // despacho, liquidación) SÍ se leyeron bien — el problema no es la
      // lectura, es que ese tipo no se calcula como factura nueva (duplicaría
      // o distorsionaría el CO2e). Mensaje honesto y distinto del genérico
      // "vuelve a escanear", que no aplica aquí.
      const todosPorTipo = indicesRechazados.every((i) => lecturas[i].motivo === 'tipo_documento_no_calculable');
      const tipos = indicesRechazados.map((i) => lecturas[i].tipo_detectado || lecturas[i].dte?.tipo_nombre).filter(Boolean).join(', ');
      const error = todosPorTipo
        ? `${plural ? `Estos documentos son de tipo: ${tipos}` : `"${nombres[0]}" es de tipo: ${tipos || 'no calculable'}`} — hoy sicr3p calcula CO2e solo desde facturas y boletas de compra. Sube el documento original o contacta soporte.`
        : `No pudimos leer automáticamente ${plural ? 'estos documentos' : `"${nombres[0]}"`}${plural ? `: ${nombres.map((n) => `"${n}"`).join(', ')}` : ''}. Vuelve a escanear${plural ? 'los' : 'lo'} (buena luz, sin cortes) y carga el envío de nuevo.`;
      return res.status(422).json({ error, rechazados: nombres });
    }

    const result = await withTx(async (client) => {
      // Código de acceso con créditos (1 crédito = 1 factura procesada).
      // Se valida y consume DENTRO de la transacción (con lock de fila).
      if (codigo) {
        const { rows: cRows } = await client.query(
          `SELECT * FROM codigos_acceso WHERE upper(codigo) = upper($1) FOR UPDATE`,
          [String(codigo).trim()]
        );
        const c = cRows[0];
        if (!c || !c.activo) {
          const e = new Error('Código inválido o inactivo.'); e.status = 400; throw e;
        }
        const restantes = c.creditos - c.creditos_usados;
        if (restantes < files.length) {
          const e = new Error(`Tu código tiene ${restantes} crédito${restantes === 1 ? '' : 's'} y estás subiendo ${files.length} facturas.`);
          e.status = 400; throw e;
        }
        await client.query(
          `UPDATE codigos_acceso SET creditos_usados = creditos_usados + $2, ultimo_uso = now() WHERE id = $1`,
          [c.id, files.length]
        );
      }

      const { rows: sRows } = await client.query(
        `INSERT INTO sesiones (rut_cliente, nombre_cliente, email_cliente)
         VALUES ($1,$2,$3) RETURNING *`,
        [rut, empresa, email]
      );
      const sesion = sRows[0];

      // Plan de cuentas de Capital Natural (una sola carga por sesión).
      const cuentasNaturales = await cargarCuentas((sql) => client.query(sql));
      // Categorías del motor propio (una sola carga por sesión).
      const categoriasMotor = await cargarCategorias((sql) => client.query(sql));

      // Cadena de hash: se bloquea la fila de estado (FOR UPDATE) para toda
      // la transacción, serializando sesiones concurrentes — cada factura
      // se encadena a la anterior, incluidas las de esta misma sesión.
      const { rows: cadenaRows } = await client.query(
        `SELECT ultimo_hash, n_eslabones FROM cadena_estado WHERE id = 1 FOR UPDATE`
      );
      let hashAnterior = cadenaRows[0].ultimo_hash;
      let eslabon = Number(cadenaRows[0].n_eslabones);

      let totalSesion = 0;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        // Lectura ya resuelta en el pre-pass (services/lecturaDocumento.js):
        // aquí solo queda calcular, hashear e insertar. El único camino que
        // sigue dentro de la transacción es el motor externo (necesita
        // sesion.id y client) — y el pre-pass ya garantizó que si algo
        // quedó sin señal es porque ese motor está activo.
        const lectura = lecturas[i];

        let analysis;
        let motor;
        if (lectura.tipo === 'xml') {
          // Motor propio: cálculo real a partir de los datos del DTE, sin
          // depender del motor externo.
          const { dte } = lectura;
          const calc = calcularFactura(dte.items, categoriasMotor, { origen: 'xml' });
          analysis = {
            invoice_id_simple: null,
            numero_venta: dte.folio ? `F-${dte.folio}` : null,
            rut_emisor: dte.rut_emisor || null,
            rut_receptor: dte.rut_receptor || rut,
            total_co2e: calc.total_co2e,
            categoria: calc.categoria,
            items: calc.items,
          };
          motor = 'propio';
        } else if (lectura.tipo === 'texto') {
          // Motor propio sobre texto extraído (PDF con capa de texto, OCR, o
          // IA): el parser de reglas (propio_texto/propio_ocr) nunca captura
          // unidad, así que siempre cae a gasto. La IA (propio_ia) sí captura
          // unidad, pero solo se habilita el método físico cuando su propio
          // documento ya pasó la verificación cruzada Σítems≈total (no
          // colapsó) — si colapsó, o no corrió (menos de 2 ítems), sigue
          // tratándose como 'texto' (gasto), igual que siempre.
          const { textoParseado } = lectura;
          const origenCalculo = (lectura.motor === 'propio_ia' && textoParseado.verificaciones?.colapsado === false)
            ? 'ia_verificada'
            : 'texto';
          const calc = calcularFactura(textoParseado.items, categoriasMotor, { origen: origenCalculo });
          analysis = {
            invoice_id_simple: null,
            numero_venta: textoParseado.folio ? `F-${textoParseado.folio}` : null,
            rut_emisor: textoParseado.rut_emisor || null,
            rut_receptor: textoParseado.rut_receptor || rut,
            total_co2e: calc.total_co2e,
            categoria: calc.categoria,
            items: calc.items,
          };
          motor = lectura.motor;
        } else {
          // Sin datos reales extraíbles y con el motor externo aún activo
          // (garantizado por el pre-pass: apagado ⇒ 422 antes de llegar acá).
          analysis = await simpleApi.analyzeInvoice({
            sesionId: sesion.id,
            filename: file.originalname,
            index: i,
            rutReceptor: rut,
            client,
          });
          if (lectura.dte) {
            if (lectura.dte.folio) analysis.numero_venta = `F-${lectura.dte.folio}`;
            if (lectura.dte.rut_emisor) analysis.rut_emisor = lectura.dte.rut_emisor;
            if (lectura.dte.rut_receptor) analysis.rut_receptor = lectura.dte.rut_receptor;
          }
          motor = 'externo';
        }
        totalSesion += Number(analysis.total_co2e || 0);

        const hDoc = hashDocumento({
          numero_venta: analysis.numero_venta,
          rut_emisor: analysis.rut_emisor,
          rut_receptor: analysis.rut_receptor,
          total_co2e: analysis.total_co2e,
          categoria: analysis.categoria,
          archivo_original: file.originalname,
        });
        const hPrevio = hashAnterior;
        const hCad = hashCadena(hashAnterior, hDoc);
        eslabon += 1;
        const nEslabon = eslabon;

        const { rows: fRows } = await client.query(
          `INSERT INTO facturas
             (sesion_id, invoice_id_simple, numero_venta, archivo_original,
              rut_emisor, rut_receptor, total_co2e, categoria, status, motor,
              hash_documento, hash_anterior, hash_cadena, eslabon)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
          [
            sesion.id,
            analysis.invoice_id_simple,
            analysis.numero_venta,
            file.originalname,
            analysis.rut_emisor,
            analysis.rut_receptor,
            analysis.total_co2e,
            analysis.categoria,
            'procesada',
            motor,
            hDoc,
            hPrevio,
            hCad,
            nEslabon,
          ]
        );
        hashAnterior = hCad;
        const factura = fRows[0];

        for (const it of analysis.items) {
          await client.query(
            `INSERT INTO line_items (factura_id, descripcion, cantidad, co2e, porcentaje_total, metodo)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [factura.id, it.descripcion, it.cantidad, it.co2e, it.porcentaje_total, it.metodo || null]
          );
        }
        // Capital Natural: cargos automáticos en las cuentas ambientales activas.
        await registrarMovimientos({ client, factura, fecha: sesion.fecha, cuentas: cuentasNaturales });

        // Valorización: los DTE traen precio real por ítem → entradas de inventario.
        // El CO2e de la factura se reparte entre ítems según su monto.
        const dte = lectura.tipo === 'xml' ? lectura.dte : null;
        if (dte && dte.items?.length) {
          const totalMonto = dte.items.reduce((a, it) => a + (Number(it.monto) || 0), 0);
          for (const it of dte.items) {
            const cant = Number(it.cantidad) || 0;
            if (cant <= 0) continue;
            const monto = Number(it.monto) || 0;
            const co2eItem = totalMonto > 0 ? Number(analysis.total_co2e || 0) * (monto / totalMonto) : 0;
            await client.query(
              `INSERT INTO inventario_movimientos
                 (rut_cliente_norm, descripcion, fecha, tipo, cantidad, precio_unitario, co2e_unitario, factura_id, origen)
               VALUES ($1,$2,COALESCE($3::date, CURRENT_DATE),'entrada',$4,$5,$6,$7,'documento')`,
              [String(rut).replace(/[^0-9kK]/g, '').toUpperCase(), it.nombre, dte.fecha_emision || null,
               cant, Number(it.precio) || (cant > 0 ? monto / cant : 0),
               cant > 0 ? co2eItem / cant : 0, factura.id]
            );
          }
        }
      }

      await client.query(`UPDATE sesiones SET total_co2e = $1 WHERE id = $2`, [
        Math.round(totalSesion * 10000) / 10000,
        sesion.id,
      ]);
      sesion.total_co2e = Math.round(totalSesion * 10000) / 10000;

      // Cierra el avance de la cadena de hash con el último eslabón de esta sesión.
      await client.query(
        `UPDATE cadena_estado SET ultimo_hash = $1, n_eslabones = $2, updated_at = now() WHERE id = 1`,
        [hashAnterior, eslabon]
      );

      return sesion;
    });

    const facturas = await hydrateFacturas(result.id);
    res.status(201).json({ sesion: result, facturas });

    // Export al data warehouse (no bloqueante; apagado por defecto).
    bigquery.exportSesion({ sesion: result, facturas });

    // Envío del informe por correo (no bloqueante: nunca afecta la respuesta).
    (async () => {
      try {
        const pdf = await generateReport({ sesion: result, facturas });
        await sendMail({
          to: result.email_cliente,
          ...reporteEmail({ nombre: result.nombre_cliente, totalCo2e: result.total_co2e, nFacturas: facturas.length }),
          attachments: [{ filename: `sicr3p-informe-${result.id.slice(0, 8)}.pdf`, content: pdf }],
        });
      } catch (e) {
        console.warn('[correo] no se pudo enviar el informe:', e.message);
      }
    })();

    // Webhook al mandante cuyo RUT coincide con esta sesión (no bloqueante).
    (async () => {
      try {
        const rn = normalizarRut(result.rut_cliente);
        const { rows: mandantes } = await query(
          `SELECT id, webhook_url FROM mandantes
           WHERE activo = true AND webhook_url IS NOT NULL
             AND regexp_replace(rut, '[^0-9kK]', '', 'g') = $1`,
          [rn]
        );
        for (const m of mandantes) {
          const r = await dispararWebhook({
            url: m.webhook_url,
            payload: {
              evento: 'sesion.creada',
              sesion_id: result.id,
              rut_cliente: result.rut_cliente,
              nombre_cliente: result.nombre_cliente,
              total_co2e: result.total_co2e,
              n_facturas: facturas.length,
              fecha: result.fecha,
            },
          });
          if (!r.ok) console.warn(`[webhook] mandante ${m.id} no respondió ok:`, r.error || r.status);
        }
      } catch (e) {
        console.warn('[webhook] error al notificar mandantes:', e.message);
      }
    })();
  } catch (err) {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Puedes cargar hasta 5 facturas por envío. Contáctanos para más.' });
    }
    next(err);
  }
});

// ---------- POST /api/sesiones/:id/embalaje — declaración REP (Ley 20.920) ----------
// Persiste la pre-declaración de envases y embalajes del POS. El porcentaje
// y el nivel se recalculan SIEMPRE en el servidor (fórmula SICREP); nunca se
// aceptan valores calculados por el cliente. Una declaración por sesión:
// un nuevo POST reemplaza la anterior.
// Cada versión (creación o reemplazo) se encadena contra la cadena GLOBAL
// (misma secuencia/lock que las facturas, cadena_estado). Antes de
// sobreescribir, la versión anterior se copia íntegra a
// declaraciones_embalaje_historial (append-only) — "reemplazar" ya no
// borra evidencia legal (migración 028).
router.post('/sesiones/:id/embalaje', async (req, res, next) => {
  try {
    const { rows: sRows } = await query(`SELECT id, rut_cliente FROM sesiones WHERE id = $1`, [req.params.id]);
    if (!sRows[0]) return res.status(404).json({ error: 'Sesión no encontrada' });

    const componentes = req.body?.componentes;
    const val = validarComponentes(componentes);
    if (!val.ok) return res.status(400).json({ error: val.error });

    // Solo se persisten los campos declarados (nada extra del cliente).
    const limpios = componentes.map((c) => ({
      material: c.material,
      peso_gr: Number(c.peso_gr),
      cantidad: Number(c.cantidad),
      reciclable: c.reciclable,
    }));
    const calc = calcularReciclabilidad(limpios);

    const declaracion = await withTx(async (client) => {
      // Lock de la declaración anterior de ESTA sesión primero (si existe),
      // recién después cadena_estado — orden fijo para no chocar con el
      // flujo de subida de facturas (que solo toca cadena_estado).
      const { rows: prevRows } = await client.query(
        `SELECT * FROM declaraciones_embalaje WHERE sesion_id = $1 FOR UPDATE`,
        [req.params.id]
      );
      const previa = prevRows[0] || null;

      const { rows: eRows } = await client.query(`SELECT * FROM cadena_estado WHERE id = 1 FOR UPDATE`);
      const estado = eRows[0];
      const hDoc = hashDeclaracionEmbalaje({ sesion_id: req.params.id, componentes: limpios, ...calc });
      const { hash_cadena: hCad, eslabon } = siguienteEslabon(estado, hDoc);

      if (previa) {
        await client.query(
          `INSERT INTO declaraciones_embalaje_historial
             (declaracion_id, sesion_id, componentes, peso_total_gr, peso_reciclable_gr, porcentaje, nivel,
              hash_documento, hash_anterior, hash_cadena, eslabon, vigente_desde)
           VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [previa.id, previa.sesion_id, JSON.stringify(previa.componentes), previa.peso_total_gr, previa.peso_reciclable_gr,
           previa.porcentaje, previa.nivel, previa.hash_documento, previa.hash_anterior, previa.hash_cadena,
           previa.eslabon, previa.created_at]
        );
      }

      const { rows } = await client.query(
        `INSERT INTO declaraciones_embalaje
           (sesion_id, componentes, peso_total_gr, peso_reciclable_gr, porcentaje, nivel,
            hash_documento, hash_anterior, hash_cadena, eslabon)
         VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (sesion_id) DO UPDATE SET
           componentes        = EXCLUDED.componentes,
           peso_total_gr      = EXCLUDED.peso_total_gr,
           peso_reciclable_gr = EXCLUDED.peso_reciclable_gr,
           porcentaje         = EXCLUDED.porcentaje,
           nivel              = EXCLUDED.nivel,
           hash_documento     = EXCLUDED.hash_documento,
           hash_anterior      = EXCLUDED.hash_anterior,
           hash_cadena        = EXCLUDED.hash_cadena,
           eslabon            = EXCLUDED.eslabon,
           created_at         = now()
         RETURNING *`,
        [
          req.params.id, JSON.stringify(limpios), calc.peso_total_gr, calc.peso_reciclable_gr,
          calc.porcentaje, calc.nivel, hDoc, estado.ultimo_hash, hCad, eslabon,
        ]
      );

      await client.query(
        `UPDATE cadena_estado SET ultimo_hash = $1, n_eslabones = $2, updated_at = now() WHERE id = 1`,
        [hCad, eslabon]
      );
      return rows[0];
    });

    res.status(201).json({ declaracion });
    // Export al warehouse (no bloqueante; cada versión queda como fila propia).
    bigquery.exportDeclaracionEmbalaje(declaracion, sRows[0]);
  } catch (err) {
    next(err);
  }
});

// Si la petición trae un Bearer con JWT válido de rol 'pos', devuelve el id
// del terminal; si no, null. El parse es OPCIONAL: el flujo de compensación
// es público y jamás se rechaza por un token ausente, vencido o ajeno —
// solo se aprovecha para atribuir el cobro al terminal que lo originó.
function terminalIdOpcional(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwt.accessSecret);
    return payload.rol === 'pos' ? payload.sub : null;
  } catch {
    return null;
  }
}

// ---------- POST /api/sesiones/:id/compensacion — cobro del POS Aduana Verde ----------
// El SERVIDOR toma las toneladas de la sesión y la tarifa vigente de
// config_pos y calcula el monto (ROUND(t CO2e × tarifa); $0 si 'omitido').
// Nunca se acepta un monto calculado por el cliente. Una compensación por
// sesión: un re-cobro del mismo trámite reemplaza la anterior.
router.post('/sesiones/:id/compensacion', async (req, res, next) => {
  try {
    const { rows: sRows } = await query(
      `SELECT id, rut_cliente, total_co2e FROM sesiones WHERE id = $1`,
      [req.params.id]
    );
    const sesion = sRows[0];
    if (!sesion) return res.status(404).json({ error: 'Sesión no encontrada' });

    const val = validarCompensacion(req.body || {});
    if (!val.ok) return res.status(400).json({ error: val.error });

    // Tarifa vigente (la migración siembra la fila 1; 5000 es el respaldo).
    const { rows: cfgRows } = await query(
      `SELECT tarifa_clp_tco2e FROM config_pos WHERE id = 1`
    );
    const tarifa = Number(cfgRows[0]?.tarifa_clp_tco2e ?? 5000);

    const tCo2e = Number(sesion.total_co2e || 0);
    const monto = calcularMonto(tCo2e, tarifa, val.estado);
    const terminalId = terminalIdOpcional(req);

    const { rows } = await query(
      `INSERT INTO compensaciones
         (sesion_id, terminal_id, t_co2e, tarifa_clp_tco2e, monto_clp, metodo, estado)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (sesion_id) DO UPDATE SET
         terminal_id      = EXCLUDED.terminal_id,
         t_co2e           = EXCLUDED.t_co2e,
         tarifa_clp_tco2e = EXCLUDED.tarifa_clp_tco2e,
         monto_clp        = EXCLUDED.monto_clp,
         metodo           = EXCLUDED.metodo,
         estado           = EXCLUDED.estado,
         created_at       = now()
       RETURNING *`,
      [req.params.id, terminalId, tCo2e, tarifa, monto, val.metodo, val.estado]
    );
    res.status(201).json({ compensacion: rows[0] });
    // Export al warehouse (no bloqueante; cada versión queda como fila propia).
    bigquery.exportCompensacion(rows[0], sesion);
  } catch (err) {
    next(err);
  }
});

// ---------- POST /api/sesiones/:id/comprobante-correo — comprobante del POS ----------
// Envía por correo el resumen de la visita (resultado + compensación +
// enlaces de verificación e informe). Un fallo del mailer NO bota el
// endpoint: responde { ok: false } y el POS puede reintentar.
router.post('/sesiones/:id/comprobante-correo', async (req, res, next) => {
  try {
    const { rows: sRows } = await query(`SELECT * FROM sesiones WHERE id = $1`, [req.params.id]);
    const sesion = sRows[0];
    if (!sesion) return res.status(404).json({ error: 'Sesión no encontrada' });

    const { rows: cRows } = await query(
      `SELECT * FROM compensaciones WHERE sesion_id = $1`,
      [req.params.id]
    );
    const comp = cRows[0] || null;

    // Primera factura de la sesión: ancla del enlace de verificación pública.
    const { rows: fRows } = await query(
      `SELECT id FROM facturas WHERE sesion_id = $1 ORDER BY created_at LIMIT 1`,
      [req.params.id]
    );

    try {
      await enviarComprobantePos({
        para: sesion.email_cliente,
        empresa: sesion.nombre_cliente,
        t_co2e: Number(comp?.t_co2e ?? sesion.total_co2e ?? 0),
        monto_clp: Number(comp?.monto_clp ?? 0),
        estado: comp?.estado || null,
        metodo: comp?.metodo || null,
        verificarUrl: fRows[0] ? `${config.publicAppUrl}/verificar/${fRows[0].id}` : null,
        informeUrl: `${config.publicAppUrl}/api/sesiones/${req.params.id}/informe.pdf`,
      });
      res.json({ ok: true });
    } catch (e) {
      console.warn('[comprobante-correo] no se pudo enviar:', e.message);
      res.json({ ok: false, error: 'No se pudo enviar el comprobante. Intenta de nuevo.' });
    }
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/sesiones/:id — resultados ----------
router.get('/sesiones/:id', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM sesiones WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Sesión no encontrada' });
    const facturas = await hydrateFacturas(req.params.id);
    const { rows: dRows } = await query(
      `SELECT * FROM declaraciones_embalaje WHERE sesion_id = $1`,
      [req.params.id]
    );
    const { rows: cRows } = await query(
      `SELECT * FROM compensaciones WHERE sesion_id = $1`,
      [req.params.id]
    );
    res.json({
      sesion: rows[0],
      facturas,
      declaracion_embalaje: dRows[0] || null,
      compensacion: cRows[0] || null,
    });
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/sesiones/:id/carpeta.pdf — carpeta física para el mandante ----------
// Las mineras y grandes empresas piden la evidencia en papel: esta es la
// carpeta única imprimible del trámite (portada dirigida al mandante,
// resumen, QR por documento, declaración REP y hoja de verificación).
// `?mandante=` es solo texto de portada (saneado, jamás se persiste).
router.get('/sesiones/:id/carpeta.pdf', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM sesiones WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Sesión no encontrada' });
    const facturas = await hydrateFacturas(req.params.id);
    // Contrapartes relacionadas: mismo cálculo ya expuesto en
    // GET /admin/informes/cadena, reexpuesto dentro de la carpeta.
    const contrapartes = rows[0].rut_cliente ? await contrapartesDeRut(rows[0].rut_cliente) : null;
    const pdf = await generateCarpetaMandante({
      sesion: rows[0],
      facturas,
      mandante: req.query.mandante,
      contrapartes,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="sicr3p-carpeta-${req.params.id.slice(0, 8)}.pdf"`);
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/sesiones/:id/informe.pdf ----------
router.get('/sesiones/:id/informe.pdf', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM sesiones WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Sesión no encontrada' });
    const facturas = await hydrateFacturas(req.params.id);
    const pdf = await generateReport({ sesion: rows[0], facturas });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="sicr3p-informe-${req.params.id.slice(0, 8)}.pdf"`);
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/sesiones/:id/sello.svg — sello embebible ----------
// SVG que el comercio pega en su sitio: empresa, toneladas, distintivo REP
// y estado de la cadena, con enlace de verificación pública. ?tema=oscuro
// para fondos oscuros; ?lang=en para etiquetas en inglés (default español).
// La integridad usa el mismo criterio local que GET /api/verificar/:id
// (eslabonValido de la primera factura).
router.get('/sesiones/:id/sello.svg', async (req, res, next) => {
  try {
    const { rows: sRows } = await query(`SELECT * FROM sesiones WHERE id = $1`, [req.params.id]);
    const sesion = sRows[0];
    if (!sesion) return res.status(404).json({ error: 'Sesión no encontrada' });

    // Primera factura: ancla del enlace de verificación y de la cadena.
    const { rows: fRows } = await query(
      `SELECT * FROM facturas WHERE sesion_id = $1 ORDER BY created_at LIMIT 1`,
      [req.params.id]
    );
    const factura = fRows[0] || null;

    const { rows: dRows } = await query(
      `SELECT nivel FROM declaraciones_embalaje WHERE sesion_id = $1`,
      [req.params.id]
    );

    const svg = generarSelloSvg({
      empresa: sesion.nombre_cliente,
      t_co2e: Number(sesion.total_co2e || 0),
      fecha: sesion.fecha ? new Date(sesion.fecha).toISOString().slice(0, 10) : '',
      nivel_rep: dRows[0]?.nivel || null,
      cadena_intacta: factura?.hash_cadena ? eslabonValido(factura) : null,
      verificar_url: factura
        ? `${config.publicAppUrl}/verificar/${factura.id}`
        : config.publicAppUrl,
      tema: req.query.tema === 'oscuro' ? 'oscuro' : 'claro',
      lang: req.query.lang === 'en' ? 'en' : 'es',
    });
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(svg);
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/facturas/:id/etiqueta.pdf ----------
router.get('/facturas/:id/etiqueta.pdf', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM facturas WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Factura no encontrada' });
    const factura = rows[0];
    const { rows: items } = await query(
      `SELECT descripcion, cantidad, co2e, porcentaje_total FROM line_items WHERE factura_id = $1`,
      [factura.id]
    );
    factura.items = items;
    const { rows: sRows } = await query(`SELECT * FROM sesiones WHERE id = $1`, [factura.sesion_id]);
    const pdf = await generateLabel({ sesion: sRows[0], factura });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="sicr3p-etiqueta-${factura.numero_venta || factura.id.slice(0, 8)}.pdf"`);
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/facturas/:id/qr.png — QR de verificación (para previsualizar) ----------
router.get('/facturas/:id/qr.png', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT id FROM facturas WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Factura no encontrada' });
    const png = await qrBuffer(req.params.id);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(png);
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/verificar/:id — verificación pública de trazabilidad ----------
router.get('/verificar/:id', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM facturas WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Documento no encontrado' });
    const factura = rows[0];
    const { rows: items } = await query(
      `SELECT descripcion, cantidad, co2e, porcentaje_total FROM line_items WHERE factura_id = $1`,
      [factura.id]
    );
    const { rows: sRows } = await query(
      `SELECT nombre_cliente, rut_cliente, fecha FROM sesiones WHERE id = $1`,
      [factura.sesion_id]
    );
    // Declaración de embalaje REP (Ley 20.920) de la sesión, si existe.
    const { rows: eRows } = await query(
      `SELECT porcentaje, nivel, peso_total_gr,
              jsonb_array_length(componentes) AS n_componentes
       FROM declaraciones_embalaje WHERE sesion_id = $1`,
      [factura.sesion_id]
    );
    res.json({
      valido: true,
      factura: {
        id: factura.id,
        sesion_id: factura.sesion_id,
        numero_venta: factura.numero_venta,
        categoria: factura.categoria,
        total_co2e: factura.total_co2e,
        status: factura.status,
        fecha: sRows[0]?.fecha,
      },
      cliente: {
        nombre: sRows[0]?.nombre_cliente,
        rut: sRows[0]?.rut_cliente,
      },
      cadena: factura.hash_cadena ? {
        eslabon: factura.eslabon,
        hash_documento: factura.hash_documento,
        hash_cadena: factura.hash_cadena,
        intacto: eslabonValido(factura),
      } : null,
      embalaje: eRows[0] ? {
        porcentaje: eRows[0].porcentaje,
        nivel: eRows[0].nivel,
        peso_total_gr: eRows[0].peso_total_gr,
        n_componentes: eRows[0].n_componentes,
      } : null,
      items,
    });
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/pasaporte/:id — Pasaporte Digital de Producto ----------
// Consolida en UN documento público lo que ya es verificable por partes:
// emisiones (con clasificación GHG de la categoría), economía circular
// (declaración REP), compensación (CLP + USD server-side) e integridad
// (cadena de hash). El formato se alinea al CONCEPTO de Pasaporte Digital
// de Producto (UE/ESPR) sin presentarse jamás como documento oficial de
// una autoridad — el frontend muestra ese disclaimer en el idioma del
// lector. No expone nada que /verificar/:id, /pos/config o el sello no
// expongan ya.
router.get('/pasaporte/:id', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM facturas WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Pasaporte no encontrado' });
    const factura = rows[0];

    const [{ rows: sRows }, { rows: items }, { rows: eRows }, { rows: cRows }, { rows: aRows }] =
      await Promise.all([
        query(`SELECT nombre_cliente, rut_cliente, fecha FROM sesiones WHERE id = $1`, [factura.sesion_id]),
        query(`SELECT descripcion, cantidad, co2e, porcentaje_total FROM line_items WHERE factura_id = $1`, [factura.id]),
        query(
          `SELECT porcentaje, nivel, peso_total_gr, jsonb_array_length(componentes) AS n_componentes
           FROM declaraciones_embalaje WHERE sesion_id = $1`,
          [factura.sesion_id]
        ),
        query(
          `SELECT estado, monto_clp, tarifa_clp_tco2e, t_co2e, created_at
           FROM compensaciones WHERE sesion_id = $1`,
          [factura.sesion_id]
        ),
        query(`SELECT nombre, alcance_ghg FROM motor_categorias WHERE codigo = $1`, [factura.categoria]),
      ]);

    // Equivalente USD server-authoritative: solo si hay tipo de cambio
    // vigente (manual o automático). Defensivo ante columna sin migrar.
    const comp = cRows[0] || null;
    let montoUsd = null;
    if (comp) {
      try {
        const { rows: tcRows } = await query(`SELECT tipo_cambio_usd_clp FROM config_pos WHERE id = 1`);
        montoUsd = montoUsdDesdeClp(comp.monto_clp, tcRows[0]?.tipo_cambio_usd_clp);
      } catch { /* sin columna aún: sin USD */ }
    }

    res.json({
      pasaporte: {
        id: factura.id,
        url: pasaporteUrl(factura.id),
        verificar_url: verifyUrl(factura.id),
        sello_svg: `/api/sesiones/${factura.sesion_id}/sello.svg`,
        qr_png: `/api/pasaporte/${factura.id}/qr.png`,
      },
      producto: {
        documento: factura.numero_venta,
        categoria: factura.categoria,
        clasificacion_ghg: aRows[0]?.alcance_ghg || null,
        motor: factura.motor,
        status: factura.status,
        fecha: sRows[0]?.fecha || null,
      },
      titular: {
        nombre: sRows[0]?.nombre_cliente || null,
        rut: sRows[0]?.rut_cliente || null,
      },
      clima: {
        total_co2e: factura.total_co2e,
        items,
      },
      circular: eRows[0]
        ? {
            porcentaje: eRows[0].porcentaje,
            nivel: eRows[0].nivel,
            peso_total_gr: eRows[0].peso_total_gr,
            n_componentes: eRows[0].n_componentes,
          }
        : null,
      compensacion: comp
        ? {
            estado: comp.estado,
            monto_clp: comp.monto_clp,
            monto_usd: montoUsd,
            t_co2e: comp.t_co2e,
            fecha: comp.created_at,
          }
        : null,
      integridad: factura.hash_cadena
        ? {
            eslabon: factura.eslabon,
            hash_documento: factura.hash_documento,
            hash_cadena: factura.hash_cadena,
            intacto: eslabonValido(factura),
          }
        : null,
    });
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/pasaporte/:id/qr.png — QR de la página del pasaporte ----------
router.get('/pasaporte/:id/qr.png', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT id FROM facturas WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Pasaporte no encontrado' });
    res.type('png').send(await qrBufferDe(pasaporteUrl(rows[0].id)));
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/lote/:codigo — Pasaporte de Origen (público) ----------
// La cadena de custodia de un lote mineral (migración 021), con
// DIVULGACIÓN SELECTIVA: los hashes, rol, país y fecha de TODOS los
// eslabones son públicos (la integridad debe ser verificable por
// cualquiera); el contenido comercial (empresa, cantidades, CO2e,
// vínculo DTE) solo se muestra si el eslabón es 'publico'. Los RUT
// divulgados van enmascarados (76.***.**6-0). El nonce jamás sale.
router.get('/lote/:codigo', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM lotes_minerales WHERE codigo = $1`,
      [String(req.params.codigo || '').toUpperCase()]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Lote no encontrado' });
    const lote = rows[0];

    const [{ rows: eslabones }, { rows: declaraciones }, { rows: fRows }] = await Promise.all([
      query(`SELECT * FROM lote_eslabones WHERE lote_id = $1 ORDER BY eslabon`, [lote.id]),
      query(`SELECT codigo, estado FROM lote_declaraciones WHERE lote_id = $1`, [lote.id]),
      lote.fuente_metodologica_id
        ? query(`SELECT organismo, documento, version_anio FROM fuentes_metodologicas WHERE id = $1`, [lote.fuente_metodologica_id])
        : Promise.resolve({ rows: [] }),
    ]);

    const publicos = filtrarPorVisibilidad(eslabones, 'publico').map((e) => ({
      ...e,
      // Enmascarado incluso cuando se divulga: se reconoce al actor sin
      // regalar el identificador completo a scrapers.
      rut_empresa: e.divulgado && e.rut_empresa ? enmascararRut(e.rut_empresa) : undefined,
      factura_id: undefined,
      dte_vinculado: e.divulgado ? Boolean(e.factura_id) : undefined,
    }));

    res.json({
      pasaporte: {
        codigo: lote.codigo,
        url: loteUrl(lote.codigo),
        qr_png: `/api/lote/${lote.codigo}/qr.png`,
      },
      lote: {
        tipo: lote.tipo || 'mineral',
        material: lote.material,
        descripcion: lote.descripcion,
        codigo_nc: lote.codigo_nc,
        cantidad: lote.cantidad,
        unidad: lote.unidad,
        pais_origen: lote.pais_origen,
        faena_origen: lote.faena_origen,
        composicion: lote.composicion,
        estandar_externo: lote.estandar_externo,
        estado: lote.estado,
      },
      emisiones: {
        ...emisionesIncorporadasPorTonelada(lote, eslabones),
        directas_t: lote.emisiones_directas_tco2e_t != null ? Number(lote.emisiones_directas_tco2e_t) : null,
        indirectas_t: lote.emisiones_indirectas_tco2e_t != null ? Number(lote.emisiones_indirectas_tco2e_t) : null,
        metodo: lote.metodo_emisiones,
        fuente: fRows[0] || null,
      },
      cadena: {
        eslabones: publicos,
        n_eslabones: Number(lote.n_eslabones),
        ultimo_hash: lote.ultimo_hash,
        integra: verificarCadenaCompleta(eslabones).valido,
      },
      balance: balanceMasas(lote, eslabones),
      normativo: resumenNormativo(lote, declaraciones),
    });
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/v/:serial — resolución de tarjeta de viaje ----------
// La tarjeta NFC/RFID lleva grabada la URL /v/{serial}. Cualquiera que
// la lea llega aquí y es dirigido al pasaporte del lote (SOLO lectura;
// por decisión de diseño no se registra ninguna lectura anónima).
// Registrar un paso exige la clave del portador (/api/tarjeta).
router.get('/v/:serial', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT t.serial, t.portador, l.codigo
       FROM tarjetas_viaje t JOIN lotes_minerales l ON l.id = t.lote_id
       WHERE t.serial = $1 AND t.activo = true`,
      [String(req.params.serial || '').trim().toUpperCase()]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Tarjeta no encontrada o inactiva' });
    // Instrucción vigente de la torre de control (migración 024): la ve
    // quien porta la credencial, sin clave — leerla no escribe nada.
    const { rows: mRows } = await query(
      `SELECT m.destino, m.zona, m.nota, m.emisor, m.creado
       FROM torre_mensajes m
       JOIN tarjetas_viaje t ON t.lote_id = m.lote_id
       WHERE t.serial = $1
       ORDER BY m.creado DESC LIMIT 1`,
      [rows[0].serial]
    );
    res.json({ serial: rows[0].serial, codigo: rows[0].codigo, instruccion: mRows[0] || null });
  } catch (err) { next(err); }
});

// ---------- GET /api/v/:serial/qr.png — QR de la propia credencial ----------
// La página /v/:serial muestra su propio QR: el portador enseña la
// pantalla y otro la escanea (comportamiento de credencial en el
// teléfono, sin chip físico).
router.get('/v/:serial/qr.png', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT serial FROM tarjetas_viaje WHERE serial = $1 AND activo = true`,
      [String(req.params.serial || '').trim().toUpperCase()]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Tarjeta no encontrada o inactiva' });
    res.type('png').send(await qrBufferDe(tarjetaUrl(rows[0].serial)));
  } catch (err) { next(err); }
});

// ---------- GET /api/lote/:codigo/mensajes — historial de la torre ----------
// Instrucciones operativas enviadas por la torre de control (últimas 10).
// Público: quien tiene el código del lote ya ve su pasaporte; la torre
// /torre/{codigo} pollea esto para pintar el historial. No expone RUT
// ni datos comerciales — solo destino, nota corta, emisor y fecha.
router.get('/lote/:codigo/mensajes', async (req, res, next) => {
  try {
    const { rows: lRows } = await query(
      `SELECT id FROM lotes_minerales WHERE codigo = $1`,
      [String(req.params.codigo || '').toUpperCase()]
    );
    if (!lRows[0]) return res.status(404).json({ error: 'Lote no encontrado' });
    const { rows } = await query(
      `SELECT destino, zona, nota, emisor, creado FROM torre_mensajes
       WHERE lote_id = $1 ORDER BY creado DESC LIMIT 10`,
      [lRows[0].id]
    );
    res.json({ mensajes: rows });
  } catch (err) { next(err); }
});

// ---------- GET /api/lote/:codigo/expediente.pdf — expediente sellado ----------
// El respaldo FÍSICO del lote: se imprime y se archiva junto a la
// tarjeta de viaje. Contenido con divulgación selectiva nivel público
// (el expediente lo ven terceros). "SELLADO" solo si el lote está
// cerrado y anclado en la cadena global.
router.get('/lote/:codigo/expediente.pdf', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM lotes_minerales WHERE codigo = $1`,
      [String(req.params.codigo || '').toUpperCase()]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Lote no encontrado' });
    const lote = rows[0];
    const [{ rows: eslabones }, { rows: declaraciones }, { rows: aRows }, { rows: fRows }] = await Promise.all([
      query(`SELECT * FROM lote_eslabones WHERE lote_id = $1 ORDER BY eslabon`, [lote.id]),
      query(`SELECT codigo, estado FROM lote_declaraciones WHERE lote_id = $1`, [lote.id]),
      query(`SELECT eslabon, hash_cadena, created_at FROM cadena_anclajes WHERE lote_id = $1`, [lote.id]),
      lote.fuente_metodologica_id
        ? query(`SELECT organismo, documento, version_anio FROM fuentes_metodologicas WHERE id = $1`, [lote.fuente_metodologica_id])
        : Promise.resolve({ rows: [] }),
    ]);

    const pdf = await generateExpedienteLote({
      lote,
      eslabones,
      declaraciones,
      normativo: resumenNormativo(lote, declaraciones),
      balance: balanceMasas(lote, eslabones),
      emisiones: { ...emisionesIncorporadasPorTonelada(lote, eslabones), fuente: fRows[0] || null },
      anclaje: aRows[0] || null,
      integra: verificarCadenaCompleta(eslabones).valido,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="sicr3p-expediente-${lote.codigo}.pdf"`);
    res.send(pdf);
  } catch (err) { next(err); }
});

// ---------- GET /api/lote/:codigo/qr.png — QR del pasaporte de origen ----------
router.get('/lote/:codigo/qr.png', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT codigo FROM lotes_minerales WHERE codigo = $1`,
      [String(req.params.codigo || '').toUpperCase()]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Lote no encontrado' });
    res.type('png').send(await qrBufferDe(loteUrl(rows[0].codigo)));
  } catch (err) {
    next(err);
  }
});

export default router;
