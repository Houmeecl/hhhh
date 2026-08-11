import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filaCbamCsv, resumenNormativo } from '../src/services/pasaporteOrigen.js';

// ============================================================
// Mapeo de columnas del export CBAM para mandantes (mandante.js
// GET /export/cbam) — mismo espíritu que alcanceGhg.test.js: probar la
// función pura de transformación sin BD ni HTTP.
// ============================================================

const LOTE_ACERO = {
  codigo: 'LM-2026-000010',
  pais_origen: 'BR',
  material: 'otro',
  codigo_nc: '720610',
  emisiones_directas_tco2e_t: 1.234,
  emisiones_indirectas_tco2e_t: 0.5,
  metodo_emisiones: 'valores_reales',
  faena_origen: 'Planta Carajás',
};

const LOTE_COBRE = {
  codigo: 'LM-2026-000011',
  pais_origen: 'CL',
  material: 'cobre_catodo',
  codigo_nc: '740311',
  emisiones_directas_tco2e_t: null,
  emisiones_indirectas_tco2e_t: null,
  metodo_emisiones: null,
  faena_origen: null,
};

function anotarCbam(lote) {
  return { ...lote, cbam: resumenNormativo(lote, []).cbam };
}

test('filaCbamCsv: lote de acero (Brasil) aplicable y completo', () => {
  const fila = filaCbamCsv(anotarCbam(LOTE_ACERO));
  assert.deepEqual(fila, {
    codigo: 'LM-2026-000010',
    pais_origen: 'BR',
    material: 'otro',
    codigo_nc: '720610',
    cbam_aplicable: 'si',
    metodo_emisiones: 'valores_reales',
    emisiones_directas_tco2e_t: 1.234,
    emisiones_indirectas_tco2e_t: 0.5,
    cbam_listo: 'si',
    cbam_faltantes: '',
  });
});

test('filaCbamCsv: lote de cobre fuera del Anexo I — no aplicable, sin romper el export', () => {
  const fila = filaCbamCsv(anotarCbam(LOTE_COBRE));
  assert.equal(fila.cbam_aplicable, 'no');
  assert.equal(fila.codigo, 'LM-2026-000011');
  assert.equal(fila.emisiones_directas_tco2e_t, '');
  assert.equal(fila.metodo_emisiones, '');
});

test('filaCbamCsv: lote incompleto (falta código NC) lista los faltantes separados por ;', () => {
  const lote = { ...LOTE_ACERO, codigo_nc: null };
  const fila = filaCbamCsv(anotarCbam(lote));
  assert.equal(fila.cbam_aplicable, 'no'); // sin NC válido, cbamAplicable() es false
  assert.equal(fila.cbam_listo, 'no');
  assert.ok(fila.cbam_faltantes.split(';').includes('codigo_nc'));
});
