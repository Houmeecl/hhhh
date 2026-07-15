import crypto from 'crypto';

// ============================================================
// Cadena de hash tipo blockchain — interna, sin red externa.
// Cada factura se hashea (contenido) y se encadena al hash de la
// factura anterior (SHA-256(hash_anterior + hash_documento)). Si un
// registro pasado se altera, la cadena se rompe desde ese punto en
// adelante — evidencia de integridad, no de terceros.
// ============================================================

// Génesis: primer eslabón de la cadena (nada la precede).
export const GENESIS = '0'.repeat(64);

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Hash del contenido verificable de una factura (determinista: mismo
// orden de campos siempre, sin depender de JSON.stringify/orden de keys).
export function hashDocumento({ numero_venta, rut_emisor, rut_receptor, total_co2e, categoria, archivo_original }) {
  const canonico = [
    numero_venta || '', rut_emisor || '', rut_receptor || '',
    Number(total_co2e || 0).toFixed(4), categoria || '', archivo_original || '',
  ].join('|');
  return sha256(canonico);
}

// Encadena el hash del documento al hash del eslabón anterior.
export function hashCadena(hashAnterior, hashDoc) {
  return sha256(String(hashAnterior || GENESIS) + String(hashDoc || ''));
}

// Verifica que UN eslabón sea internamente consistente (su hash_cadena
// coincide con lo que se obtiene de su propio hash_anterior + hash_documento).
// No confirma que hash_anterior en sí sea legítimo — para eso, verificarCadenaCompleta.
export function eslabonValido({ hash_anterior, hash_documento, hash_cadena }) {
  if (!hash_documento || !hash_cadena) return false;
  return hashCadena(hash_anterior, hash_documento) === hash_cadena;
}

// Recalcula la cadena completa desde el génesis y confirma que no se
// rompió en ningún punto. `eslabones` debe venir ordenado por `eslabon` asc.
export function verificarCadenaCompleta(eslabones) {
  let esperado = GENESIS;
  for (const e of eslabones || []) {
    if ((e.hash_anterior || GENESIS) !== esperado) {
      return { valido: false, rompe_en: e.id, motivo: 'hash_anterior no coincide con el eslabón previo' };
    }
    const recalculado = hashCadena(e.hash_anterior, e.hash_documento);
    if (recalculado !== e.hash_cadena) {
      return { valido: false, rompe_en: e.id, motivo: 'hash_cadena no coincide con lo recalculado' };
    }
    esperado = e.hash_cadena;
  }
  return { valido: true, total_eslabones: (eslabones || []).length, ultimo_hash: esperado };
}
