import { test } from 'node:test';
import assert from 'node:assert/strict';

// ============================================================
// Guardia de PARIDAD entre las dos implementaciones REP:
//  - backend/src/services/rep.js  (recalcula al persistir — manda)
//  - frontend/src/lib/rep.js      (preview en vivo en el terminal /pos)
// Si alguien cambia la fórmula/umbral en una sola, este test falla.
// El frontend lib es puro y sin dependencias, por eso se puede
// importar directo desde el suite del backend.
// ============================================================
import * as srv from '../src/services/rep.js';
import * as lib from '../../frontend/src/lib/rep.js';

test('paridad REP: mismos materiales (códigos y orden)', () => {
  assert.deepEqual(
    srv.MATERIALES_REP.map((m) => m.codigo),
    lib.MATERIALES_REP.map((m) => m.codigo)
  );
});

const CASOS = [
  [],                                                                              // vacío
  [{ material: 'plasticos', peso_gr: 500, cantidad: 2, reciclable: true }],        // 100% Alto
  [{ material: 'papel_carton', peso_gr: 300, cantidad: 10, reciclable: true },
   { material: 'plasticos', peso_gr: 150, cantidad: 10, reciclable: false }],      // 66.7% Medio
  [{ material: 'vidrio', peso_gr: 70, cantidad: 1, reciclable: true },
   { material: 'otros', peso_gr: 30, cantidad: 1, reciclable: false }],            // 70% exacto → Alto
  [{ material: 'metales', peso_gr: 50, cantidad: 1, reciclable: true },
   { material: 'otros', peso_gr: 50, cantidad: 1, reciclable: false }],            // 50% exacto → Medio
  [{ material: 'madera', peso_gr: 499, cantidad: 1, reciclable: true },
   { material: 'otros', peso_gr: 501, cantidad: 1, reciclable: false }],           // 49.9% → Bajo
  [{ material: 'compuestos', peso_gr: 1, cantidad: 3, reciclable: true },
   { material: 'otros', peso_gr: 2, cantidad: 3, reciclable: false }],             // 33.3% redondeo
  [{ material: 'plasticos', peso_gr: 100, cantidad: '', reciclable: true }],       // cantidad vacía = 1
  [{ material: 'plasticos', peso_gr: 0, cantidad: 5, reciclable: true }],          // peso 0 → nivel null
];

test('paridad REP: calcularReciclabilidad idéntica en ambos lados', () => {
  for (const caso of CASOS) {
    const a = srv.calcularReciclabilidad(caso);
    const b = lib.calcularReciclabilidad(caso);
    assert.deepEqual(a, b, `divergencia en caso: ${JSON.stringify(caso)}`);
  }
});

test('paridad REP: umbrales de nivel coinciden en los bordes', () => {
  // Barrido fino alrededor de 50% y 70% para atrapar un cambio de < vs <=.
  for (const pct of [49.9, 50, 50.1, 69.9, 70, 70.1]) {
    const caso = [
      { material: 'plasticos', peso_gr: pct * 10, cantidad: 1, reciclable: true },
      { material: 'otros', peso_gr: (100 - pct) * 10, cantidad: 1, reciclable: false },
    ];
    assert.equal(
      srv.calcularReciclabilidad(caso).nivel,
      lib.calcularReciclabilidad(caso).nivel,
      `nivel distinto en ${pct}%`
    );
  }
});
