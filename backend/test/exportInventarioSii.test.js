import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filasInventario, inventarioCsv, inventarioJson } from '../src/services/exportInventarioSii.js';

// Análisis mínimo con la forma real de analizarPeriodo() para un período
// con emisiones calculadas y desglose por alcance.
const ANALISIS = {
  periodo: '2026-05',
  emisiones: {
    total_co2e_tref: 22.0,
    documentos_calculados: 6,
    documentos_totales: 7,
    motor_versiones: [3, 4],
    por_alcance: {
      alcances: [
        {
          alcance: 2, tco2e: 2, n_documentos: 1,
          categorias: [
            { codigo: 'electricidad', nombre: 'Energía eléctrica', categoria_ghg: null, categoria_ghg_nombre: null, tco2e: 2, n_documentos: 1, n_fisico: 1, fuente_factor: 'Coordinador Eléctrico Nacional — Factor SEN (2025)' },
          ],
        },
        {
          alcance: 3, tco2e: 18, n_documentos: 4,
          categorias: [
            { codigo: 'materiales', nombre: 'Materiales', categoria_ghg: 1, categoria_ghg_nombre: 'Bienes y servicios adquiridos', tco2e: 15, n_documentos: 3, n_fisico: 0, fuente_factor: 'DEFRA (Reino Unido) — Conversion Factors (2026)' },
            { codigo: 'residuos', nombre: 'Residuos', categoria_ghg: 5, categoria_ghg_nombre: 'Residuos generados en las operaciones', tco2e: 3, n_documentos: 1, n_fisico: 1, fuente_factor: null },
          ],
        },
      ],
      sin_clasificar: { tco2e: 2, n_documentos: 1, inferido_por_nombre: 1, descarga_antigua: 0, sin_coincidencia: 0, motor_sin_categoria: 0, alcance_no_legible: 0, procedencia_no_registrada: 0 },
    },
  },
};
const EMPRESA = { nombre_empresa: 'Minería del Norte SpA', rut: '76520943-9' };

test('filasInventario: una fila por categoría con su alcance, método y fuente', () => {
  const filas = filasInventario(ANALISIS.emisiones.por_alcance);
  assert.equal(filas.length, 3);
  assert.deepEqual(filas.map((f) => f.alcance), [2, 3, 3]);
  const mat = filas.find((f) => f.categoria_motor === 'Materiales');
  assert.equal(mat.categoria_ghg_numero, 1);
  assert.equal(mat.categoria_ghg_nombre, 'Bienes y servicios adquiridos');
  assert.equal(mat.n_documentos, 3);
  assert.equal(mat.n_fisico, 0);
  assert.equal(mat.n_gasto, 3);
  assert.equal(mat.total_tco2e, 15);
  assert.match(mat.fuente_factor, /DEFRA/);
});

test('inventarioCsv: columnas entregables, números de máquina y pie con el saldo por causa', () => {
  const csv = inventarioCsv({ analisis: ANALISIS });
  const [cabecera, ...resto] = csv.split('\n');
  assert.match(cabecera, /alcance,categoria_ghg_numero,categoria_ghg_nombre_ghg_protocol,categoria_motor,n_documentos,n_por_unidades_fisicas,n_por_gasto,total_tco2e,fuente_factor/);
  // Números con punto decimal (formato de máquina): es un archivo de datos.
  assert.match(csv, /15\.0000/);
  // El saldo sin alcance va al pie CON su causa — nunca escondido.
  assert.match(csv, /# 1 documento\(s\) por 2\.0000 tCO2e sin alcance atribuible/);
  assert.match(csv, /clasificados por el nombre del proveedor/);
  // Total del período y versión del motor: el lector sabe qué cubre el CSV.
  assert.match(csv, /# Total del per.odo: 22\.0000 tCO2e sobre 6 de 7 documentos/);
  assert.match(csv, /# Motor de c.lculo v3, v4\./);
  // Taxonomía citada y rol de insumo declarado (nunca certificación).
  assert.match(csv, /WRI\/WBCSD/);
  assert.match(csv, /no constituye certificacion/i);
  assert.ok(resto.length >= 3, 'una fila por categoría');
});

test('inventarioJson: totales, filas y aviso de insumo con HuellaChile reconociendo al titular', () => {
  const j = inventarioJson({ empresa: EMPRESA, periodo: '2026-05', analisis: ANALISIS });
  assert.equal(j.total_tco2e, 22);
  assert.equal(j.filas.length, 3);
  assert.equal(j.sin_alcance.n_documentos, 1);
  assert.deepEqual(j.motor_versiones, [3, 4]);
  assert.match(j.metodologia.taxonomia_categorias_alcance3, /WRI\/WBCSD/);
  assert.match(j.aviso, /HuellaChile/);
  assert.match(j.aviso, /nunca a sicr3p/);
  assert.match(j.aviso, /No constituye certificaci/);
});

test('inventarioCsv: sin saldo sin alcance, el pie no inventa una línea de causas', () => {
  const limpio = {
    ...ANALISIS,
    emisiones: {
      ...ANALISIS.emisiones,
      por_alcance: { ...ANALISIS.emisiones.por_alcance, sin_clasificar: { tco2e: 0, n_documentos: 0 } },
    },
  };
  const csv = inventarioCsv({ analisis: limpio });
  assert.doesNotMatch(csv, /sin alcance atribuible/);
  assert.match(csv, /# Total del per.odo/);
});
