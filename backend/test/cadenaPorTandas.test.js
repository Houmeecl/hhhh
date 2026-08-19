import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GENESIS, hashDocumento, hashCadena, verificarCadenaCompleta, nuevoVerificadorDeCadena,
} from '../src/services/cadenaHash.js';

// ============================================================
// La cadena global se verifica por tandas para no cargar en memoria
// todos los documentos que sicr3p ha sellado en su historia cada vez que
// se imprime un informe mensual. El recorrido tiene que dar EXACTAMENTE
// el mismo resultado que verificarla de una sola vez — si no, se estaría
// cambiando la promesa del informe ("cadena global íntegra") en nombre
// de un ahorro de memoria.
// ============================================================

function cadenaDe(n) {
  const eslabones = [];
  let anterior = GENESIS;
  for (let i = 1; i <= n; i += 1) {
    const hash_documento = hashDocumento({ numero_venta: `F-${i}`, total_co2e: i });
    const hash_cadena = hashCadena(anterior, hash_documento);
    eslabones.push({ id: `id-${i}`, eslabon: i, hash_anterior: anterior, hash_documento, hash_cadena });
    anterior = hash_cadena;
  }
  return eslabones;
}

const enTandas = (eslabones, tam) => {
  const v = nuevoVerificadorDeCadena();
  for (let i = 0; i < eslabones.length; i += tam) {
    if (v.agregar(eslabones.slice(i, i + tam))) break;
  }
  return v.resultado();
};

test('por tandas da el mismo resultado que de una sola vez', () => {
  const cadena = cadenaDe(37);
  const entera = verificarCadenaCompleta(cadena);
  assert.equal(entera.valido, true);
  assert.equal(entera.total_eslabones, 37);
  // Tamaños que no dividen exacto, que dividen exacto, y uno mayor que la cadena.
  for (const tam of [1, 2, 5, 37, 100]) {
    assert.deepEqual(enTandas(cadena, tam), entera, `tanda de ${tam}`);
  }
});

test('una alteración se detecta caiga donde caiga el corte de tanda', () => {
  for (const posicion of [0, 4, 9]) {
    const cadena = cadenaDe(10);
    cadena[posicion].hash_documento = hashDocumento({ numero_venta: 'ADULTERADA', total_co2e: 999 });
    const entera = verificarCadenaCompleta(cadena);
    assert.equal(entera.valido, false);
    for (const tam of [1, 3, 5, 10]) {
      const porTandas = enTandas(cadena, tam);
      assert.equal(porTandas.valido, false, `tanda ${tam}, alterado el ${posicion}`);
      assert.equal(porTandas.rompe_en, entera.rompe_en, 'y señala el mismo eslabón');
    }
  }
});

test('el verificador no sigue contando después de romperse', () => {
  const cadena = cadenaDe(6);
  cadena[2].hash_cadena = 'f'.repeat(64);
  const v = nuevoVerificadorDeCadena();
  assert.equal(v.agregar(cadena.slice(0, 4))?.valido, false);
  // Alimentarlo de nuevo no lo "arregla": la cadena ya está rota.
  assert.equal(v.agregar(cadena.slice(4))?.valido, false);
  assert.equal(v.resultado().valido, false);
});

test('cadena vacía: válida, cero eslabones, último hash = génesis', () => {
  const v = nuevoVerificadorDeCadena();
  assert.equal(v.agregar([]), null);
  assert.deepEqual(v.resultado(), { valido: true, total_eslabones: 0, ultimo_hash: GENESIS });
  assert.deepEqual(verificarCadenaCompleta([]), v.resultado());
  assert.deepEqual(verificarCadenaCompleta(null), v.resultado());
});
