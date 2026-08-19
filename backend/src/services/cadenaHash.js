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

// Boilerplate repetido cada vez que se anexa un eslabón nuevo a una
// cadena (global o propia de una entidad): dado el estado actual
// (ultimo_hash/n_eslabones) y el hash del documento ya calculado por
// el llamador, arma el siguiente hash_cadena y número de eslabón.
export function siguienteEslabon(estado, hashDoc) {
  const hash_cadena = hashCadena(estado?.ultimo_hash, hashDoc);
  const eslabon = Number(estado?.n_eslabones || 0) + 1;
  return { hash_cadena, eslabon };
}

// Verificador incremental de la cadena.
//
// La verificación es inherentemente O(n): una alteración en un documento
// viejo NO mueve el estado de la cadena (`cadena_estado` sigue con el mismo
// último hash), así que no hay atajo ni caché posible — detectarla exige
// recorrer los eslabones. Lo que sí se puede evitar es tener la cadena
// entera en memoria a la vez: este verificador consume los eslabones por
// tandas y conserva solo el hash esperado y el conteo.
//
// Se recorre SIEMPRE desde el génesis: verificar un tramo suelto no dice
// nada del tramo anterior, y el informe promete la cadena completa.
export function nuevoVerificadorDeCadena() {
  let esperado = GENESIS;
  let total = 0;
  let roto = null;

  return {
    // Devuelve el fallo si la cadena ya se rompió (para cortar el recorrido),
    // o null mientras siga íntegra. `eslabones` viene ordenado por eslabón asc.
    agregar(eslabones) {
      if (roto) return roto;
      for (const e of eslabones || []) {
        if ((e.hash_anterior || GENESIS) !== esperado) {
          roto = { valido: false, rompe_en: e.id, motivo: 'hash_anterior no coincide con el eslabón previo' };
          return roto;
        }
        const recalculado = hashCadena(e.hash_anterior, e.hash_documento);
        if (recalculado !== e.hash_cadena) {
          roto = { valido: false, rompe_en: e.id, motivo: 'hash_cadena no coincide con lo recalculado' };
          return roto;
        }
        esperado = e.hash_cadena;
        total += 1;
      }
      return null;
    },
    resultado() {
      return roto || { valido: true, total_eslabones: total, ultimo_hash: esperado };
    },
  };
}

// Recalcula la cadena completa desde el génesis y confirma que no se
// rompió en ningún punto. `eslabones` debe venir ordenado por `eslabon` asc.
export function verificarCadenaCompleta(eslabones) {
  const v = nuevoVerificadorDeCadena();
  v.agregar(eslabones);
  return v.resultado();
}
