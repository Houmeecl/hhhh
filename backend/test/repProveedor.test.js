import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validarItemsVenta, snapshotItemsVenta, totalesVenta, resumenRep, MAX_ITEMS_VENTA,
} from '../src/services/repProveedor.js';

// ============================================================
// Ley REP real desde el proveedor: la venta pega la factura a productos
// del catálogo, el snapshot congela el envase del momento, y el resumen
// entrega los kilos por material — la base de la declaración RETC/SGR.
// ============================================================

// Dos productos con envases distintos. La botella: 30 g de plástico
// reciclable + 5 g de tapa (2 tapas de 2.5 g) no reciclable.
const BOTELLA = {
  id: 'p1', nombre: 'Botella 1L', codigo: 'B-1', activo: true,
  peso_total_gr: 35, peso_reciclable_gr: 30,
  componentes: [
    { material: 'plasticos', peso_gr: 30, cantidad: 1, reciclable: true },
    { material: 'plasticos', peso_gr: 2.5, cantidad: 2, reciclable: false },
  ],
};
const CAJA = {
  id: 'p2', nombre: 'Caja 6 unidades', codigo: null, activo: true,
  peso_total_gr: 200, peso_reciclable_gr: 200,
  componentes: [{ material: 'papel_carton', peso_gr: 200, cantidad: 1, reciclable: true }],
};
const INACTIVO = { ...CAJA, id: 'p3', nombre: 'Descontinuado', activo: false };

const porId = new Map([[BOTELLA.id, BOTELLA], [CAJA.id, CAJA], [INACTIVO.id, INACTIVO]]);

// ---------- Validación de items ----------

test('items válidos pasan; vacío, ajeno, inactivo, repetido y unidades malas no', () => {
  assert.equal(validarItemsVenta([{ producto_id: 'p1', unidades: 10 }], porId).ok, true);
  assert.equal(validarItemsVenta([], porId).ok, false);
  // Un id ajeno no está en el Map del proveedor: "no existe" cubre "no es tuyo".
  assert.match(validarItemsVenta([{ producto_id: 'de-otro', unidades: 1 }], porId).error, /no existe en tu cat/);
  assert.match(validarItemsVenta([{ producto_id: 'p3', unidades: 1 }], porId).error, /desactivado/);
  assert.match(validarItemsVenta(
    [{ producto_id: 'p1', unidades: 1 }, { producto_id: 'p1', unidades: 2 }], porId
  ).error, /repetido/);
  for (const unidades of [0, -1, 1.5, 'diez', true]) {
    assert.equal(validarItemsVenta([{ producto_id: 'p1', unidades }], porId).ok, false, String(unidades));
  }
  const muchos = Array.from({ length: MAX_ITEMS_VENTA + 1 }, (_, i) => ({ producto_id: `x${i}`, unidades: 1 }));
  assert.match(validarItemsVenta(muchos, porId).error, /Máximo/);
});

// ---------- Snapshot: congela el producto del momento ----------

test('el snapshot congela nombre, pesos y componentes: editar el producto no reescribe la venta', () => {
  const snap = snapshotItemsVenta([{ producto_id: 'p1', unidades: 100 }], porId);
  assert.equal(snap[0].nombre, 'Botella 1L');
  assert.equal(snap[0].peso_total_gr, 35);
  assert.equal(snap[0].componentes.length, 2);
  // Simula que después le cambian el envase al producto en el catálogo…
  const editado = { ...BOTELLA, peso_total_gr: 99, componentes: [] };
  porId.set('p1', editado);
  // …y el snapshot ya tomado no se mueve.
  assert.equal(snap[0].peso_total_gr, 35);
  porId.set('p1', BOTELLA); // restaurar para los demás tests
});

// ---------- Totales de la venta ----------

test('totalesVenta: kilos de envase = unidades × peso, con reciclables aparte', () => {
  const snap = snapshotItemsVenta(
    [{ producto_id: 'p1', unidades: 1000 }, { producto_id: 'p2', unidades: 50 }], porId
  );
  const t = totalesVenta(snap);
  // 1000 × 35 g + 50 × 200 g = 45.000 g = 45 kg
  assert.equal(t.kg_envases, 45);
  // 1000 × 30 g + 50 × 200 g = 40.000 g = 40 kg
  assert.equal(t.kg_reciclables, 40);
});

// ---------- Resumen por material y período ----------

test('resumenRep: kilos por material (declaración RETC es por material) y por período', () => {
  const snap1 = snapshotItemsVenta([{ producto_id: 'p1', unidades: 1000 }], porId);
  const snap2 = snapshotItemsVenta([{ producto_id: 'p2', unidades: 50 }], porId);
  const ventas = [
    { periodo: '2026-07', items: snap1, ...totalesVenta(snap1) },
    { periodo: '2026-08', items: snap2, ...totalesVenta(snap2) },
  ];
  const r = resumenRep(ventas);

  // Por material: plásticos = 30g + 2×2.5g = 35 g × 1000 = 35 kg (30 reciclables);
  // papel/cartón = 200 g × 50 = 10 kg (todos reciclables).
  const plasticos = r.por_material.find((m) => m.material === 'plasticos');
  assert.equal(plasticos.kg, 35);
  assert.equal(plasticos.kg_reciclables, 30, 'la tapa no reciclable no infla los reciclables');
  const carton = r.por_material.find((m) => m.material === 'papel_carton');
  assert.equal(carton.kg, 10);
  assert.equal(carton.nombre, 'Papel y cartón');
  // Materiales sin kilos no aparecen (vidrio, metales…).
  assert.equal(r.por_material.length, 2);

  // Por período, descendente.
  assert.deepEqual(r.por_periodo.map((p) => p.periodo), ['2026-08', '2026-07']);
  assert.equal(r.por_periodo[1].kg_envases, 35);

  // Totales.
  assert.equal(r.total.kg_envases, 45);
  assert.equal(r.total.kg_reciclables, 40);
  assert.equal(r.total.n_ventas, 2);
  assert.equal(r.total.n_unidades, 1050);
});

test('resumenRep sin ventas: vacío coherente, sin materiales fantasma', () => {
  const r = resumenRep([]);
  assert.deepEqual(r.por_material, []);
  assert.deepEqual(r.por_periodo, []);
  assert.equal(r.total.kg_envases, 0);
  assert.equal(r.total.n_ventas, 0);
});

test('la suma por material cuadra con el total: nada se pierde ni se duplica', () => {
  const snap = snapshotItemsVenta(
    [{ producto_id: 'p1', unidades: 333 }, { producto_id: 'p2', unidades: 77 }], porId
  );
  const ventas = [{ periodo: '2026-08', items: snap, ...totalesVenta(snap) }];
  const r = resumenRep(ventas);
  const sumaMateriales = r.por_material.reduce((s, m) => s + m.kg, 0);
  assert.ok(Math.abs(sumaMateriales - r.total.kg_envases) < 0.005,
    `por material ${sumaMateriales} vs total ${r.total.kg_envases}`);
});
