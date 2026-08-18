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
 * Devuelve la clave de informe de una entidad, creándola la primera vez.
 *
 * Idempotente y con bloqueo optimista: dos envíos simultáneos del mismo
 * mes no pueden dejar dos claves distintas —el `WHERE clave_informe IS
 * NULL` hace que solo el primero escriba, y el segundo relee la que quedó.
 *
 * Devuelve `null` si el cifrado no está disponible (falta la llave maestra
 * en producción). El llamador decide: mejor mandar el informe sin cifrar y
 * decirlo, que no mandarlo — pero esa decisión no se toma acá.
 */
export async function claveDeEntidad({ tabla, id }) {
  if (!TABLAS_CON_CLAVE.has(tabla)) {
    throw new Error(`[entrega] tabla sin clave de informe: ${tabla}`);
  }
  if (!cifradoDisponible() || !id) return null;

  const { rows } = await query(`SELECT clave_informe FROM ${tabla} WHERE id = $1`, [id]);
  if (!rows[0]) return null;
  if (rows[0].clave_informe) {
    try {
      return descifrar(rows[0].clave_informe);
    } catch (e) {
      // La llave maestra cambió y lo guardado ya no se puede leer. Se
      // avisa fuerte y se devuelve null: generar una clave nueva en
      // silencio dejaría al cliente sin poder abrir sus informes viejos.
      console.error(`[entrega] la clave de informe de ${tabla}/${id} no se puede descifrar: ${e.message}`);
      return null;
    }
  }

  const nueva = generarClaveInforme();
  const { rows: act } = await query(
    `UPDATE ${tabla} SET clave_informe = $2
      WHERE id = $1 AND clave_informe IS NULL
      RETURNING clave_informe`,
    [id, cifrar(nueva)]
  );
  if (act[0]) return nueva;

  // Otro proceso la creó entremedio: se lee la suya.
  const { rows: otra } = await query(`SELECT clave_informe FROM ${tabla} WHERE id = $1`, [id]);
  return otra[0]?.clave_informe ? descifrar(otra[0].clave_informe) : null;
}

/** La clave de un proveedor. Envoltorio: es el caso de uso del panel. */
export const claveDeProveedor = (proveedorId) =>
  claveDeEntidad({ tabla: 'proveedores', id: proveedorId });

/**
 * La clave del código con que se cargó una sesión (flujo público).
 *
 * NUNCA para un código de campaña de "Sube y Suma" (`modo_juego`), y esto
 * NO es una restricción de conveniencia:
 *
 *  · un código de campaña lo comparten TODOS los jugadores de esa empresa,
 *    así que una clave por código no protegería a ningún jugador de otro; y
 *  · el jugador entra por magic link y jamás recibe una clave de informes
 *    —ese correo sale del flujo de cobros, que él no atraviesa—.
 *
 * Cifrar igual le mandaría un PDF que no puede abrir. Un archivo
 * inutilizable no protege nada: solo se pierde. Mejor en claro y anotado
 * como tal en el acuse, que es justo para lo que existe `cifrado`.
 *
 * El guard vive acá y no solo en el llamador a propósito: la próxima ruta
 * que quiera entregar un informe no tiene por qué acordarse de esto.
 */
export async function claveDeCodigo(codigoId) {
  if (!codigoId) return null;
  const { rows } = await query(`SELECT modo_juego FROM codigos_acceso WHERE id = $1`, [codigoId]);
  if (!rows[0] || rows[0].modo_juego) return null;
  return claveDeEntidad({ tabla: 'codigos_acceso', id: codigoId });
}

/** Rota la clave. Los informes YA entregados siguen abriéndose con la anterior. */
export async function rotarClaveEntidad({ tabla, id }) {
  if (!TABLAS_CON_CLAVE.has(tabla)) {
    throw new Error(`[entrega] tabla sin clave de informe: ${tabla}`);
  }
  if (!cifradoDisponible()) return null;
  const nueva = generarClaveInforme();
  const { rows } = await query(
    `UPDATE ${tabla} SET clave_informe = $2 WHERE id = $1 RETURNING id`,
    [id, cifrar(nueva)]
  );
  return rows[0] ? nueva : null;
}

export const rotarClaveProveedor = (proveedorId) =>
  rotarClaveEntidad({ tabla: 'proveedores', id: proveedorId });

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
