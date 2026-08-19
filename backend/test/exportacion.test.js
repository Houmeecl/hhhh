import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  regimenesDe, listoParaExportar, semaforoExportacion, glosaExportacion, urgenciaExportacion,
  commodityEudr, eudrAplicable,
  REQUISITOS_CBAM, REQUISITOS_EUDR, REQUISITOS_EXPORTACION,
  COMMODITIES_EUDR, METODOS_EMISIONES, CORTE_DEFORESTACION, CONSECUENCIA,
} from '../src/services/exportacion.js';
import { CAPITULOS_NC_CBAM } from '../src/services/pasaporteOrigen.js';

// ============================================================
// Los tres regímenes de exportación (services/exportacion.js).
//
// Lo que estos casos cuidan, en orden de importancia:
//
//  1. QUE «NO SÉ» NO SE DISFRACE DE «EXPORTACIÓN». Sin código arancelario
//     no se puede saber qué régimen aplica. Caer a 'exportacion' por
//     defecto haría que una carga de SOYA sin código —que sí está bajo
//     EUDR— se viera en regla justo donde no lo está. Es el error caro de
//     este módulo y por eso va primero.
//  2. QUE EL COBRE NO SALGA COMO INCUMPLIMIENTO CBAM. CBAM no cubre cobre
//     ni litio. Un exportador de cátodos mirando un semáforo CBAM en rojo
//     permanente no está viendo rigor: está viendo una obligación que
//     nunca tuvo.
//  3. QUE LA PROHIBICIÓN NO SE VEA IGUAL QUE EL SOBRECOSTO. EUDR bloquea
//     la comercialización; CBAM cobra más. Mostrarlos con el mismo peso
//     hace que el exportador atienda primero lo barato.
//  4. QUE UNA EMISIÓN DECLARADA EN CERO CUENTE. Cero es un valor, no una
//     ausencia. Un `!valor` la borraría, que es exactamente al revés.
//  5. QUE EL GRIS NO SEA ROJO. Mismo vocabulario que semaforoDocumental y
//     semaforoExpediente: gris es «no se opina».
// ============================================================

const cbamCompleto = {
  codigo_nc: '7601', faena_origen: 'Fundición de Ejemplo',
  emisiones_directas_tco2e_t: 8.1, emisiones_indirectas_tco2e_t: 2.4,
  metodo_emisiones: 'valores_reales',
};
const exportCompleto = {
  codigo_nc: '7403', pais_origen: 'CL', faena_origen: 'Mina de Ejemplo',
  composicion: { cu: 99.99 }, n_eslabones: 3, emisiones_directas_tco2e_t: 1.2,
};
const eudrCompleto = {
  codigo_nc: '1201', pais_origen: 'BR',
  parcelas: [{ lat: -15.123456, lng: -56.654321 }],
  fecha_produccion: '2026-03', libre_deforestacion: true, legalidad: true,
};

// ---------- 1. Sin código arancelario no se opina ----------

test('sin código no hay régimen — y NO cae a "exportación"', () => {
  const { regimenes } = regimenesDe({});
  assert.deepEqual(regimenes, []);
});

test('sin código, `listo` es null — no false', () => {
  const e = listoParaExportar({});
  assert.equal(e.listo, null);
  assert.equal(semaforoExportacion(e), 'gris');
});

test('sin régimen solo se pide el código, no los seis del EUDR', () => {
  // Listar los requisitos de un régimen antes de saber si aplica sería
  // pedirle a un exportador de cobre las coordenadas de sus parcelas.
  const e = listoParaExportar({ pais_origen: 'BR' });
  assert.deepEqual(e.bloques[0].faltantes, ['codigo_nc']);
  assert.equal(e.bloques[0].total, 1);
});

test('un código con formato inválido tampoco decide régimen', () => {
  for (const nc of ['12a1', '1', '', null, undefined]) {
    assert.deepEqual(regimenesDe({ codigo_nc: nc }).regimenes, [], `${nc} no debería decidir`);
  }
});

// ---------- 2. EUDR: lo que este corredor realmente mueve ----------

test('la soya (1201) cae en EUDR', () => {
  assert.equal(commodityEudr('1201').commodity, 'soya');
  assert.deepEqual(regimenesDe({ codigo_nc: '1201' }).regimenes, ['eudr']);
});

test('la carne bovina (0202) cae en EUDR', () => {
  assert.equal(commodityEudr('0202').commodity, 'bovinos');
});

test('todas las commodities del anexo tienen partidas y etiqueta', () => {
  for (const c of COMMODITIES_EUDR) {
    assert.ok(c.partidas.length, `${c.commodity} sin partidas`);
    assert.ok(c.etiqueta.length > 3, `${c.commodity} sin etiqueta legible`);
    for (const p of c.partidas) assert.equal(eudrAplicable(p.padEnd(4, '0')), true, `${p} no reconocida`);
  }
});

test('la geolocalización es el requisito que EUDR no perdona', () => {
  const sinParcelas = { ...eudrCompleto, parcelas: [] };
  assert.ok(listoParaExportar(sinParcelas).bloques[0].faltantes.includes('geolocalizacion'));
});

test('una parcela a medio coordinar no cuenta como geolocalizada', () => {
  // Media coordenada no ubica nada. Aceptarla sería dar por cumplido el
  // único requisito del EUDR que no se resuelve con papeles.
  // `lng: null` es el caso que importa: Number(null) es 0, y 0 es una
  // longitud válida (Greenwich). Sin el chequeo explícito, un predio en
  // Mato Grosso quedaba "geolocalizado" en medio del Atlántico.
  const invalidas = [
    { lat: -15.1 }, { lng: -56.2 }, { lat: -15.1, lng: null }, { lat: null, lng: -56.2 },
    { lat: -15.1, lng: '' }, { lat: 'x', lng: 'y' }, { lat: 500, lng: -56.2 }, { lat: -15.1, lng: 999 },
    { lat: true, lng: -56.2 },
  ];
  for (const p of invalidas) {
    const e = listoParaExportar({ ...eudrCompleto, parcelas: [p] });
    assert.ok(e.bloques[0].faltantes.includes('geolocalizacion'), `${JSON.stringify(p)} no debería contar`);
  }
});

test('"libre de deforestación" exige un sí explícito, no un valor con verdad', () => {
  for (const v of ['si', 1, 'true', undefined]) {
    const e = listoParaExportar({ ...eudrCompleto, libre_deforestacion: v });
    assert.ok(e.bloques[0].faltantes.includes('libre_deforestacion'), `${v} no debería alcanzar`);
  }
  assert.equal(listoParaExportar(eudrCompleto).listo, true);
});

test('la fecha de corte del EUDR viaja en la etiqueta del requisito', () => {
  const r = REQUISITOS_EUDR.find((x) => x.campo === 'libre_deforestacion');
  assert.match(r.etiqueta, new RegExp(CORTE_DEFORESTACION));
  assert.equal(CORTE_DEFORESTACION, '2020-12-31');
});

// ---------- 3. Prohibición ≠ sobrecosto ----------

test('EUDR prohíbe, CBAM cobra — y se dicen distinto', () => {
  assert.equal(CONSECUENCIA.eudr.tipo, 'prohibicion');
  assert.equal(CONSECUENCIA.cbam.tipo, 'sobrecosto');
  assert.match(CONSECUENCIA.eudr.texto, /no.*comercializar/i);
  assert.match(CONSECUENCIA.cbam.texto, /valores por defecto/i);
});

test('lo urgente es la prohibición, no el sobrecosto', () => {
  const e = listoParaExportar({ codigo_nc: '1201' });
  assert.equal(urgenciaExportacion(e).consecuencia.tipo, 'prohibicion');
});

test('sin nada pendiente no hay urgencia que mostrar', () => {
  assert.equal(urgenciaExportacion(listoParaExportar(eudrCompleto)), null);
});

// ---------- 4. Cobre, y el cero como valor ----------

test('el cobre (7403) cae en exportación, no en CBAM ni EUDR', () => {
  const { regimenes, por_que } = regimenesDe({ codigo_nc: '7403' });
  assert.deepEqual(regimenes, ['exportacion']);
  assert.match(por_que, /no está ni en el Anexo I del EUDR ni en el de CBAM/);
});

test('una carga de cobre completa se ve VERDE, y su glosa no nombra CBAM', () => {
  const e = listoParaExportar(exportCompleto);
  assert.equal(e.listo, true);
  assert.equal(semaforoExportacion(e), 'verde');
  assert.doesNotMatch(glosaExportacion(e), /CBAM|EUDR/);
});

test('cada capítulo del Anexo I de CBAM decide régimen CBAM', () => {
  for (const cap of CAPITULOS_NC_CBAM) {
    const nc = cap.padEnd(4, '0');
    assert.ok(regimenesDe({ codigo_nc: nc }).regimenes.includes('cbam'), `${nc} debería ser CBAM`);
  }
});

test('una emisión declarada en CERO cuenta como declarada', () => {
  const e = listoParaExportar({ ...cbamCompleto, emisiones_indirectas_tco2e_t: 0 });
  assert.equal(e.listo, true);
});

test('null sí es ausencia, y se nombra', () => {
  const e = listoParaExportar({ ...cbamCompleto, emisiones_indirectas_tco2e_t: null });
  assert.deepEqual(e.bloques[0].faltantes, ['emisiones_indirectas_tco2e_t']);
});

test('un método de emisiones inventado no cuenta como declarado', () => {
  const e = listoParaExportar({ ...cbamCompleto, metodo_emisiones: 'a_ojo' });
  assert.deepEqual(e.bloques[0].faltantes, ['metodo_emisiones']);
  assert.ok(METODOS_EMISIONES.includes('valores_reales'));
});

// ---------- 5. Semáforo y requisitos ----------

test('sin ningún requisito cumplido es rojo; con alguno, amarillo', () => {
  assert.equal(semaforoExportacion(listoParaExportar({ codigo_nc: '7403' })), 'rojo');
  assert.equal(semaforoExportacion(listoParaExportar({ codigo_nc: '7403', pais_origen: 'CL' })), 'amarillo');
});

test('CBAM exige exactamente los cinco del reglamento', () => {
  assert.deepEqual(
    REQUISITOS_CBAM.map((r) => r.campo).sort(),
    ['codigo_nc', 'emisiones_directas_tco2e_t', 'emisiones_indirectas_tco2e_t', 'faena_origen', 'metodo_emisiones'],
  );
});

test('cada requisito dice quién lo aporta — sin eso la lista no sirve', () => {
  for (const r of [...REQUISITOS_EUDR, ...REQUISITOS_CBAM, ...REQUISITOS_EXPORTACION]) {
    assert.ok(r.quien && r.quien.length > 3, `${r.campo} sin responsable`);
    assert.ok(r.como_se_obtiene && r.como_se_obtiene.length > 10, `${r.campo} sin explicación`);
  }
});

test('las emisiones indirectas las aporta el suministrador, no el exportador', () => {
  // No es copy: es lo que evita que el exportador se quede pegado
  // buscando en su propia contabilidad un dato que no tiene.
  assert.match(REQUISITOS_CBAM.find((x) => x.campo === 'emisiones_indirectas_tco2e_t').quien, /electricidad/);
});

test('las coordenadas las aporta el productor, no el exportador', () => {
  assert.equal(REQUISITOS_EUDR.find((x) => x.campo === 'geolocalizacion').quien, 'productor');
});
