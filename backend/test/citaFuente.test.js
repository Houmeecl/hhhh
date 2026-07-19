import { test } from 'node:test';
import assert from 'node:assert/strict';
import { citaFuente } from '../src/services/pdf.js';

// ============================================================
// citaFuente — helper PURO del informe PDF: arma la cita
// "organismo — documento (año)" de una fuente metodológica.
// Sin fuente vinculada devuelve '' y el informe sale como hoy.
// ============================================================

test('citaFuente arma "organismo — documento (año)"', () => {
  assert.equal(
    citaFuente({
      organismo: 'DEFRA (Reino Unido)',
      documento: 'UK Government GHG Conversion Factors for Company Reporting',
      version_anio: '2024',
    }),
    'DEFRA (Reino Unido) — UK Government GHG Conversion Factors for Company Reporting (2024)'
  );
});

test('citaFuente sin año omite el paréntesis', () => {
  assert.equal(
    citaFuente({ organismo: 'IPCC', documento: 'AR6, GT1' }),
    'IPCC — AR6, GT1'
  );
  assert.equal(citaFuente({ organismo: 'IPCC', documento: 'AR6', version_anio: '' }), 'IPCC — AR6');
  assert.equal(citaFuente({ organismo: 'IPCC', documento: 'AR6', version_anio: null }), 'IPCC — AR6');
});

test('citaFuente con una sola parte no deja la raya colgando', () => {
  assert.equal(citaFuente({ organismo: 'IPCC' }), 'IPCC');
  assert.equal(citaFuente({ documento: 'GLEC Framework v3', version_anio: '2023' }), 'GLEC Framework v3 (2023)');
});

test('citaFuente sin fuente vinculada devuelve vacío (render idéntico al actual)', () => {
  assert.equal(citaFuente({}), '');
  assert.equal(citaFuente(), '');
  assert.equal(citaFuente({ organismo: null, documento: null, version_anio: '2024' }), '');
  assert.equal(citaFuente({ organismo: '  ', documento: '' }), '');
});
