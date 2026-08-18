import crypto from 'crypto';
import { query } from '../lib/db.js';
import { cifrar, descifrar, cifradoDisponible } from './cripto.js';

// ============================================================
// ENTREGA CIFRADA DEL ACTIVO.
//
// El activo de sicr3p es la contabilidad sellada, y hasta ahora viajaba en
// claro: el informe salía como PDF adjunto en un correo. Un adjunto de
// correo cruza servidores que no controlamos, se queda en la bandeja del
// destinatario para siempre y se reenvía con dos clics. Sellar el cálculo
// y después mandarlo desnudo es sellar la puerta y dejar la ventana abierta.
//
// Este módulo hace dos cosas y ninguna más:
//
//  1. LA CLAVE POR EMPRESA. Cada empresa tiene una contraseña de informe,
//     estable en el tiempo, guardada CIFRADA en reposo con la misma llave
//     maestra que ya protege las credenciales del SII (services/cripto.js,
//     AES-256-GCM, llave solo en env). Si se filtra la base, las claves no
//     sirven de nada.
//
//  2. EL ACUSE DE LO ENTREGADO. Se anota el hash SHA-256 del archivo
//     CIFRADO que salió. Eso permite responder con precisión la pregunta
//     que un activo tiene que poder responder: "¿qué archivo exacto
//     recibió esta empresa en julio?". No es la cadena de integridad —no
//     se encadena, no se sella— es el recibo de la entrega.
//
// LO QUE NO HACE, Y HAY QUE SABERLO: un PDF con contraseña protege el
// archivo, no el canal. La contraseña NUNCA viaja en el mismo correo que
// el PDF; se entrega una sola vez desde el panel. Y el cifrado del PDF
// resiste a quien tenga el archivo, no a quien tenga la contraseña.
// ============================================================

// Alfabeto sin caracteres ambiguos: esta clave se dicta por teléfono y se
// copia a mano en el diálogo de Acrobat. Mismo criterio que la contraseña
// temporal de cuentas.js — 0/O y 1/l/I fuera.
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/** Contraseña de informe: 16 caracteres, ~92 bits. */
export function generarClaveInforme(largo = 16) {
  const bytes = crypto.randomBytes(largo);
  let out = '';
  for (let i = 0; i < largo; i++) out += ALFABETO[bytes[i] % ALFABETO.length];
  return out;
}

/**
 * Opciones de pdfkit para emitir el documento cifrado con AES-256.
 *
 * `pdfVersion: '1.7ext3'` NO es decorativo: es lo que hace que pdfkit use
 * AESV3 (256 bits). Sin esa línea cae a AESV2 (128) o a RC4 según versión,
 * y el archivo queda con un cifrado que hoy no se considera suficiente.
 *
 * `ownerPassword` distinta de la del lector: quien tiene la clave puede
 * ABRIR e imprimir el informe, no reeditarlo. Es una barrera débil por
 * diseño del formato PDF —cualquiera que pueda abrirlo puede copiar el
 * contenido— pero deja explícito qué se autorizó.
 *
 * Sin clave devuelve `{}`: el llamador no tiene que ramificar.
 */
export function opcionesCifrado(clave) {
  if (!clave) return {};
  return {
    userPassword: String(clave),
    ownerPassword: `${clave}:propietario`,
    pdfVersion: '1.7ext3',
    permissions: { printing: 'highResolution', modifying: false, copying: false },
  };
}

/** ¿El PDF salió cifrado de verdad? Se usa en los tests y en el acuse. */
export function pdfEstaCifrado(buffer) {
  return Buffer.isBuffer(buffer) && buffer.includes(Buffer.from('/Encrypt'));
}

export const hashArchivo = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

// ---------- la clave de cada entidad ----------

// Las DOS tablas que portan clave de informe, y por qué son dos.
//
// La clave cuelga de quien RECIBE el informe, y sicr3p le entrega
// informes a dos sujetos distintos según el camino:
//
//  · `proveedores` — el comprobante de transporte sale del panel de una
//    empresa logueada, hay `proveedor_id`.
//  · `codigos_acceso` — el informe consolidado nace en `POST /api/sesiones`,
//    que es PÚBLICO: quien sube documentos se identifica con un código de
//    acceso y no existe ningún `proveedor_id`. El código ES la identidad
//    del comprador ahí, y es lo que el módulo de cobros emite por empresa
//    que paga (migración 100).
//
// LISTA BLANCA, NO PARÁMETRO LIBRE: el nombre de tabla se interpola en el
// SQL (Postgres no admite bind de identificadores), así que el conjunto de
// valores posibles tiene que ser cerrado y estar acá, no venir del
// llamador. Un `tabla` que no esté en esta lista es un error de
// programación y se trata como tal.
const TABLAS_CON_CLAVE = new Set(['proveedores', 'codigos_acceso']);

/**
 * LEE la clave de informe de una entidad. NO la crea, y NO la devuelve si
 * nadie se la entregó todavía a la empresa.
 *
 * Que leer y crear estén separados es lo que impide un error que ya se
 * cometió: `claveDeEntidad` creaba la clave al pedirla, y quienes la pedían
 * eran los caminos que ENTREGAN UN ARCHIVO. Resultado: se cifraban informes
 * con una clave recién inventada que el destinatario nunca había visto ni
 * tenía forma de conseguir. Un PDF que nadie puede abrir no protege nada:
 * solo se pierde, y encima parece un archivo dañado.
 *
 * La regla, ahora sostenida por la forma del módulo y no por la memoria de
 * quien escriba la próxima ruta:
 *
 *   LA CLAVE NACE CUANDO ALGUIEN SE LA ENTREGA A LA EMPRESA
 *   (`emitirClaveDeEntidad`), NO CUANDO SE MANDA UN ARCHIVO.
 *
 * Así, si nadie entregó una clave, no hay clave, el archivo sale en claro y
 * el acuse lo deja anotado con `cifrado: false` — que es justo para lo que
 * existe esa bandera.
 *
 * Y LA SEGUNDA MITAD DE LA MISMA REGLA: una clave que la empresa nunca
 * recibió es, a todos los efectos, lo mismo que no tener clave. Si
 * `clave_informe_entregada_at` es NULL, acá se devuelve `null` aunque la
 * columna tenga un valor.
 *
 * Eso no es una precaución teórica: en producción quedaron filas con clave
 * creada por el bug viejo —la que se generaba sola al mandar un archivo— y
 * que nadie recibió jamás. Sin este chequeo se seguirían usando para
 * cifrar, y esas empresas seguirían recibiendo PDF que no pueden abrir.
 * Con él quedan desactivadas al desplegar, sin tocar un solo dato.
 *
 * Devuelve `null` si no hay clave emitida, si no consta que se haya
 * entregado, si falta la llave maestra, o si lo guardado ya no se puede
 * descifrar.
 */
export async function claveDeEntidad({ tabla, id }) {
  if (!TABLAS_CON_CLAVE.has(tabla)) {
    throw new Error(`[entrega] tabla sin clave de informe: ${tabla}`);
  }
  if (!cifradoDisponible() || !id) return null;

  const { rows } = await query(
    `SELECT clave_informe, clave_informe_entregada_at FROM ${tabla} WHERE id = $1`, [id]
  );
  if (!rows[0]?.clave_informe) return null;
  if (!rows[0].clave_informe_entregada_at) return null;
  try {
    return descifrar(rows[0].clave_informe);
  } catch (e) {
    // La llave maestra cambió y lo guardado ya no se puede leer. Se avisa
    // fuerte y se devuelve null: generar una clave nueva en silencio
    // dejaría al cliente sin poder abrir sus informes viejos.
    console.error(`[entrega] la clave de informe de ${tabla}/${id} no se puede descifrar: ${e.message}`);
    return null;
  }
}

/**
 * EMITE la clave de una entidad: la crea si no existe y la devuelve.
 *
 * El único que escribe. Lo llaman los caminos que le ENTREGAN la clave a la
 * empresa —el correo de credenciales del flujo de cobros, y el botón
 * "entregar clave" del panel—, nunca los que mandan un archivo.
 *
 * Idempotente y con bloqueo optimista: dos entregas simultáneas no pueden
 * dejar dos claves distintas —el `WHERE clave_informe IS NULL` hace que
 * solo la primera escriba, y la segunda relee la que quedó—. Si cambiara
 * en cada llamada, el informe del mes pasado dejaría de abrirse con la
 * clave que el cliente tiene anotada.
 */
export async function emitirClaveDeEntidad({ tabla, id }) {
  if (!TABLAS_CON_CLAVE.has(tabla)) {
    throw new Error(`[entrega] tabla sin clave de informe: ${tabla}`);
  }
  if (!cifradoDisponible() || !id) return null;

  // OJO: acá NO sirve `claveDeEntidad`, que exige que la clave ya se haya
  // entregado. Emitir es justamente el paso previo a entregarla, así que
  // tiene que poder leer una clave emitida-y-no-entregada — y devolver LA
  // MISMA. De eso depende el rescate: entregar una clave fantasma manda la
  // que ya se usó para cifrar, y los PDF que la empresa ya recibió pasan a
  // poder abrirse.
  const yaHay = await claveGuardada({ tabla, id });
  if (yaHay) return yaHay;

  // Puede ser que la fila no exista, o que exista sin clave. Solo en el
  // segundo caso el UPDATE toca algo.
  const nueva = generarClaveInforme();
  const { rows: act } = await query(
    `UPDATE ${tabla} SET clave_informe = $2
      WHERE id = $1 AND clave_informe IS NULL
      RETURNING id`,
    [id, cifrar(nueva)]
  );
  if (act[0]) return nueva;

  // O la creó otro proceso entremedio, o la fila no existe. `claveGuardada`
  // distingue los dos casos sin repetir la lógica de descifrado.
  return claveGuardada({ tabla, id });
}

/**
 * La clave tal como está guardada, SIN exigir que se haya entregado.
 *
 * Uso restringido: solo los caminos que van a ENTREGARLA. Nunca los que
 * cifran un archivo — para eso está `claveDeEntidad`, que sí exige la
 * entrega. Por eso no se exporta.
 */
async function claveGuardada({ tabla, id }) {
  const { rows } = await query(`SELECT clave_informe FROM ${tabla} WHERE id = $1`, [id]);
  if (!rows[0]?.clave_informe) return null;
  try {
    return descifrar(rows[0].clave_informe);
  } catch (e) {
    console.error(`[entrega] la clave de informe de ${tabla}/${id} no se puede descifrar: ${e.message}`);
    return null;
  }
}

/**
 * Sella que la clave se le entregó a la empresa. Lo llaman los caminos de
 * entrega DESPUÉS de que el correo salió de verdad — si el envío falla, la
 * clave queda emitida y sin entregar, que es la verdad y es lo que el panel
 * tiene que mostrar.
 *
 * Idempotente por el `WHERE ... IS NULL`: un reenvío no reescribe la fecha
 * de la primera entrega, que es el dato que interesa conservar.
 */
export async function marcarClaveEntregada({ tabla, id }) {
  if (!TABLAS_CON_CLAVE.has(tabla)) {
    throw new Error(`[entrega] tabla sin clave de informe: ${tabla}`);
  }
  if (!id) return null;
  const { rows } = await query(
    `UPDATE ${tabla} SET clave_informe_entregada_at = now()
      WHERE id = $1 AND clave_informe IS NOT NULL AND clave_informe_entregada_at IS NULL
      RETURNING clave_informe_entregada_at`,
    [id]
  );
  if (rows[0]) return rows[0].clave_informe_entregada_at;
  const { rows: ya } = await query(
    `SELECT clave_informe_entregada_at FROM ${tabla} WHERE id = $1`, [id]
  );
  return ya[0]?.clave_informe_entregada_at || null;
}

/** Lee la clave de un proveedor (no la crea). */
export const claveDeProveedor = (proveedorId) =>
  claveDeEntidad({ tabla: 'proveedores', id: proveedorId });

/** Emite y devuelve la clave de un proveedor, para entregársela. */
export const emitirClaveDeProveedor = (proveedorId) =>
  emitirClaveDeEntidad({ tabla: 'proveedores', id: proveedorId });

// Un código de campaña de "Sube y Suma" NUNCA porta clave, y no es una
// restricción de conveniencia:
//
//  · lo comparten TODOS los jugadores de esa empresa, así que una clave por
//    código no protegería a ningún jugador de otro; y
//  · el jugador entra por magic link y jamás recibe una clave de informes
//    —ese correo sale del flujo de cobros, que él no atraviesa—.
//
// El guard vive acá y no solo en el llamador a propósito: la próxima ruta
// que quiera entregar un informe no tiene por qué acordarse de esto.
async function esCampanaDeJuego(codigoId) {
  const { rows } = await query(`SELECT modo_juego FROM codigos_acceso WHERE id = $1`, [codigoId]);
  return !rows[0] || rows[0].modo_juego === true;
}

/** Lee la clave del código con que se cargó una sesión (no la crea). */
export async function claveDeCodigo(codigoId) {
  if (!codigoId || await esCampanaDeJuego(codigoId)) return null;
  return claveDeEntidad({ tabla: 'codigos_acceso', id: codigoId });
}

/** Emite y devuelve la clave de un código, para entregársela. */
export async function emitirClaveDeCodigo(codigoId) {
  if (!codigoId || await esCampanaDeJuego(codigoId)) return null;
  return emitirClaveDeEntidad({ tabla: 'codigos_acceso', id: codigoId });
}

/**
 * Rota la clave: la reemplaza por una nueva, exista o no una anterior.
 *
 * Los informes YA entregados siguen abriéndose con la clave con que
 * salieron —no se re-cifran—. Rotar protege lo que viene, no lo que ya
 * viajó, y la UI tiene que decirlo así.
 */
export async function rotarClaveEntidad({ tabla, id }) {
  if (!TABLAS_CON_CLAVE.has(tabla)) {
    throw new Error(`[entrega] tabla sin clave de informe: ${tabla}`);
  }
  if (!cifradoDisponible()) return null;
  const nueva = generarClaveInforme();
  const { rows } = await query(
    // La marca de entrega se LIMPIA: la clave nueva no está entregada
    // hasta que salga el correo que la lleva. Si el envío falla, queda
    // emitida-sin-entregar y los informes vuelven a salir en claro — que
    // es preferible a cifrarlos con algo que la empresa no tiene.
    `UPDATE ${tabla} SET clave_informe = $2, clave_informe_entregada_at = NULL
      WHERE id = $1 RETURNING id`,
    [id, cifrar(nueva)]
  );
  return rows[0] ? nueva : null;
}

export const rotarClaveProveedor = (proveedorId) =>
  rotarClaveEntidad({ tabla: 'proveedores', id: proveedorId });

/**
 * Estado de la clave, para el panel, sin exponerla.
 *
 * Devuelve las DOS cosas, porque el panel tiene que distinguir tres
 * estados y antes solo mostraba dos: un `IS NOT NULL` pintado como "Clave
 * entregada" hacía que una clave fantasma se viera idéntica a una sana.
 */
export async function tieneClaveInforme({ tabla, id }) {
  if (!TABLAS_CON_CLAVE.has(tabla)) {
    throw new Error(`[entrega] tabla sin clave de informe: ${tabla}`);
  }
  const { rows } = await query(
    `SELECT clave_informe IS NOT NULL AS tiene, clave_informe_entregada_at
       FROM ${tabla} WHERE id = $1`, [id]
  );
  return { tiene: Boolean(rows[0]?.tiene), entregada_at: rows[0]?.clave_informe_entregada_at || null };
}

// ---------- el acuse ----------

export const TIPOS_ENTREGA = ['informe_sesion', 'informe_mensual', 'comprobante_transporte', 'carpeta_mandante'];

/**
 * Anota qué archivo se entregó, a quién y cuándo. No lanza: perder el
 * acuse no puede impedir la entrega que ya ocurrió.
 *
 * Se guarda el hash del archivo TAL COMO SALIÓ (cifrado si iba cifrado):
 * es lo que permite comparar bit a bit contra lo que el cliente diga que
 * recibió. Guardar el hash del PDF en claro no probaría nada sobre el
 * archivo que efectivamente viajó.
 */
export async function registrarEntrega({
  tipo, proveedorId = null, codigoId = null, destinatario, archivo, cifrado,
  periodo = null, referencia = null,
}) {
  try {
    // `proveedor_id` o `codigo_id`, según de cuál de las dos entidades
    // salió la clave. Anotarlo es lo que permite que el acuse responda
    // "¿con qué llave se abre este archivo?" — sin eso, una fila con
    // `cifrado = true` y ninguna entidad asociada no sirve de nada.
    await query(
      `INSERT INTO entregas (tipo, proveedor_id, codigo_id, destinatario_email, hash_archivo, bytes, cifrado, periodo, referencia)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [tipo, proveedorId, codigoId, destinatario, hashArchivo(archivo), archivo.length,
       Boolean(cifrado), periodo, referencia]
    );
  } catch (e) {
    console.error('[entrega] no se pudo registrar la entrega:', e.message);
  }
}
