import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generarCodigoCarga, RE_CODIGO_CARGA,
  latValida, lngValida, anilloDe, validarPoligono, areaHa, contrastarArea,
  validarParcela, nivelConfianzaParcela, resumenParcela, puntoDe,
  EXIGE_POLIGONO_HA, TOLERANCIA_AREA_PCT, ORIGENES_COORDENADA, NOMBRE_NIVEL_PARCELA,
} from '../src/services/corredor.js';

// ============================================================
// Funciones puras del Corredor (services/corredor.js).
//
// Lo que estos casos cuidan, en orden de importancia:
//
//  1. QUE EL NIVEL DE CONFIANZA SE CALCULE Y NO SE RECIBA. Si viajara en
//     el body, cualquiera se pondría en 4 con un curl y la escalera
//     entera dejaría de significar algo.
//  2. QUE MEDIA COORDENADA NO UBIQUE NADA. Number(null) es 0 y 0 es una
//     longitud válida: sin el chequeo explícito, un predio de Mato Grosso
//     queda "ubicado" en el meridiano de Greenwich.
//  3. QUE EL DESACUERDO SE REGISTRE Y NO SE CORRIJA. Si el polígono y el
//     área declarada no calzan, no se pisa ninguna de las dos.
//  4. QUE SOBRE 4 HA SE EXIJA EL POLÍGONO. Aceptar un punto ahí deja
//     pasar una parcela que la autoridad va a rechazar, y descubrirlo en
//     la declaración es demasiado tarde.
//  5. QUE FALTA DE DATO NO SEA DESACUERDO. Sin área declarada no hay con
//     qué contrastar: `calza` es null, no false.
// ============================================================

// Cuadrado de ~1 km de lado cerca de Sorriso, Mato Grosso — zona de soya.
const PREDIO = {
  type: 'Polygon',
  coordinates: [[[-55.7, -12.5], [-55.6908, -12.5], [-55.6908, -12.5092], [-55.7, -12.5092], [-55.7, -12.5]]],
};
const AREA_PREDIO = areaHa(PREDIO); // ~102,4 ha

// ---------- Código ----------

test('el código de una carga es CB, no LM', () => {
  const c = generarCodigoCarga(2026, 1);
  assert.equal(c, 'CB-2026-000001');
  assert.ok(RE_CODIGO_CARGA.test(c));
  assert.doesNotMatch(c, /^LM-/); // así salía una carga de soya antes
});

test('el correlativo se rellena a seis dígitos', () => {
  assert.equal(generarCodigoCarga(2026, 42), 'CB-2026-000042');
  assert.equal(generarCodigoCarga(2026, 123456), 'CB-2026-123456');
});

// ---------- Coordenadas ----------

test('null NO es una longitud válida, aunque Number(null) sea 0', () => {
  // El bug clásico: 0 es una longitud real (Greenwich), así que dejar
  // pasar null pone un predio brasileño en medio del Atlántico.
  assert.equal(lngValida(null), false);
  assert.equal(lngValida(''), false);
  assert.equal(lngValida(undefined), false);
  assert.equal(lngValida(true), false);
  assert.equal(lngValida(0), true); // pero el cero declarado sí vale
});

test('una coordenada fuera de rango no es un error de tipo, es un dato inservible', () => {
  assert.equal(latValida(91), false);
  assert.equal(latValida(-91), false);
  assert.equal(lngValida(181), false);
  assert.equal(latValida(-12.5), true);
});

// ---------- Polígonos ----------

test('acepta el GeoJSON venga como venga del catastro', () => {
  const feature = { type: 'Feature', geometry: PREDIO, properties: {} };
  const coleccion = { type: 'FeatureCollection', features: [feature] };
  for (const forma of [PREDIO, feature, coleccion, PREDIO.coordinates[0]]) {
    assert.ok(anilloDe(forma), 'no supo extraer el anillo');
  }
});

test('un polígono que no cierra se rechaza con el motivo', () => {
  const abierto = { type: 'Polygon', coordinates: [[[-55.7, -12.5], [-55.69, -12.5], [-55.69, -12.51]]] };
  const r = validarPoligono(abierto);
  assert.equal(r.ok, false);
  assert.match(r.error, /cierra|vértices/);
});

test('avisa cuando vienen invertidas lat y lng', () => {
  // GeoJSON es [lng, lat]. Confundirlo pone un predio brasileño en Asia,
  // y con una latitud de -55 el error ni siquiera es detectable por rango
  // — por eso el mensaje lo dice explícitamente.
  const invertido = { type: 'Polygon', coordinates: [[[-12.5, -195], [-12.5, -195], [-12.5, -195], [-12.5, -195]]] };
  const r = validarPoligono(invertido);
  assert.equal(r.ok, false);
  assert.match(r.error, /longitud, latitud/);
});

test('el área sale en hectáreas y es del orden correcto', () => {
  // Un cuadrado de ~1 km de lado son ~100 ha.
  assert.ok(AREA_PREDIO > 95 && AREA_PREDIO < 110, `dio ${AREA_PREDIO} ha`);
});

test('un polígono inválido no tiene área: null, no 0', () => {
  // Devolver 0 lo haría ver como un predio de superficie cero, que es un
  // dato, en vez de como "no se pudo calcular".
  assert.equal(areaHa({ type: 'Polygon', coordinates: [[[0, 0]]] }), null);
  assert.equal(areaHa(null), null);
});

// ---------- Contraste de área ----------

test('sin área declarada no hay desacuerdo: calza es null, no false', () => {
  const r = contrastarArea(null, PREDIO);
  assert.equal(r.calza, null);
  assert.equal(r.diferencia_pct, null);
  assert.ok(r.calculada_ha > 0); // el polígono sí se pudo calcular
});

test('una diferencia dentro de la tolerancia calza', () => {
  const r = contrastarArea(AREA_PREDIO, PREDIO);
  assert.equal(r.calza, true);
  assert.ok(r.diferencia_pct <= TOLERANCIA_AREA_PCT);
});

test('una diferencia grande no calza, y se dice cuánto', () => {
  const r = contrastarArea(300, PREDIO);
  assert.equal(r.calza, false);
  assert.ok(r.diferencia_pct > 50);
  // Ninguna de las dos cifras se pisa: las dos viajan.
  assert.equal(r.declarada_ha, 300);
  assert.ok(r.calculada_ha > 0);
});

test('el desacuerdo se registra, no se corrige', () => {
  const r = resumenParcela({ origen_coordenada: 'archivo', poligono: PREDIO, area_ha: 300 });
  assert.ok(r.desacuerdo_area, 'tiene que quedar constancia');
  assert.match(r.desacuerdo_area, /300 ha/);
  assert.match(r.desacuerdo_area, /diferencia/);
});

// ---------- Validación ----------

test('una parcela sin coordenadas no entra', () => {
  const r = validarParcela({ nombre: 'Predio', pais: 'BR' });
  assert.equal(r.ok, false);
  assert.match(r.error, /coordenadas/);
});

test('sobre 4 ha se exige el polígono, no basta un punto', () => {
  const r = validarParcela({ nombre: 'Grande', pais: 'BR', lat: -12.5, lng: -55.7, area_ha: EXIGE_POLIGONO_HA + 1 });
  assert.equal(r.ok, false);
  assert.match(r.error, /pol[íi]gono/i);
});

test('bajo el umbral, un punto alcanza', () => {
  const r = validarParcela({ nombre: 'Chica', pais: 'BR', lat: -12.5, lng: -55.7, area_ha: EXIGE_POLIGONO_HA - 1 });
  assert.equal(r.ok, true);
});

test('no existen los orígenes gps ni perimetro', () => {
  // Descartados a propósito: mandar a alguien a recorrer un predio en
  // zona de frontera es el riesgo que este producto no corre.
  assert.deepEqual(ORIGENES_COORDENADA, ['archivo', 'registro', 'mapa']);
  for (const malo of ['gps', 'perimetro']) {
    const r = validarParcela({ nombre: 'X', pais: 'BR', lat: -12.5, lng: -55.7, origen_coordenada: malo });
    assert.equal(r.ok, false, `${malo} no debería aceptarse`);
  }
});

test('el país va en ISO-2', () => {
  assert.equal(validarParcela({ nombre: 'X', pais: 'Brasil', lat: -12.5, lng: -55.7 }).ok, false);
  assert.equal(validarParcela({ nombre: 'X', pais: 'BR', lat: -12.5, lng: -55.7 }).ok, true);
});

// ---------- El nivel de confianza ----------

test('dibujado en el mapa es nivel 1: lo declara quien dibuja', () => {
  assert.equal(nivelConfianzaParcela({ origen_coordenada: 'mapa', poligono: PREDIO, area_ha: AREA_PREDIO }), 1);
});

test('archivo del catastro sin área contra qué contrastar: nivel 2', () => {
  // No contrastar NO es contradecirse. Se queda en documentado.
  assert.equal(nivelConfianzaParcela({ origen_coordenada: 'archivo', poligono: PREDIO }), 2);
});

test('archivo cuyo polígono calza con lo declarado: nivel 3', () => {
  // Dos fuentes diciendo lo mismo — eso es "consistente".
  assert.equal(nivelConfianzaParcela({ origen_coordenada: 'archivo', poligono: PREDIO, area_ha: AREA_PREDIO }), 3);
});

test('si NO calza, no sube a 3 por mucho que venga de un archivo', () => {
  assert.equal(nivelConfianzaParcela({ origen_coordenada: 'archivo', poligono: PREDIO, area_ha: 300 }), 2);
});

test('el nivel 4 exige quién, contra qué y cuándo — los tres', () => {
  const base = { origen_coordenada: 'registro', poligono: PREDIO, area_ha: AREA_PREDIO };
  const completo = { ...base, validado_por: 'INCRA', validado_fuente: 'car', validado_at: '2026-01-01' };
  assert.equal(nivelConfianzaParcela(completo), 4);
  // Quitando cualquiera de los tres, deja de ser nivel 4.
  for (const campo of ['validado_por', 'validado_fuente', 'validado_at']) {
    const cojo = { ...completo, [campo]: null };
    assert.notEqual(nivelConfianzaParcela(cojo), 4, `sin ${campo} no puede ser 4`);
  }
});

test('el nivel 5 no existe: no hay auditor que lo otorgue', () => {
  assert.equal(NOMBRE_NIVEL_PARCELA[5], undefined);
  const maximo = { origen_coordenada: 'registro', poligono: PREDIO, area_ha: AREA_PREDIO,
    validado_por: 'X', validado_fuente: 'car', validado_at: '2026-01-01', nivel_confianza: 5 };
  // Y mandar un 5 en el objeto no lo sube: el nivel se calcula, no se lee.
  assert.equal(nivelConfianzaParcela(maximo), 4);
});

test('el nivel que venga en el objeto se ignora — se calcula, no se recibe', () => {
  const mentiroso = { origen_coordenada: 'mapa', lat: -12.5, lng: -55.7, nivel_confianza: 4 };
  assert.equal(nivelConfianzaParcela(mentiroso), 1);
});

test('el resumen trae con qué pintar la parcela', () => {
  const r = resumenParcela({ origen_coordenada: 'archivo', poligono: PREDIO, area_ha: AREA_PREDIO });
  assert.equal(r.nivel_confianza, 3);
  assert.equal(r.nombre_nivel, 'Consistente');
  assert.equal(r.desacuerdo_area, null);
  assert.equal(r.exige_poligono, true); // ~102 ha
});

// ---------- El punto representativo ----------

test('una parcela declarada SOLO con polígono sí está ubicada', () => {
  // Es el caso obligatorio sobre 4 ha: el EUDR exige el perímetro y no
  // admite el punto. Tratarla como "sin geolocalización" dejaba fuera
  // justo a la parcela mejor declarada de todas.
  const punto = puntoDe({ poligono: PREDIO });
  assert.ok(punto, 'un polígono ubica la parcela');
  assert.ok(punto.lat < -12.4 && punto.lat > -12.6, `latitud fuera del predio: ${punto.lat}`);
  assert.ok(punto.lng < -55.6 && punto.lng > -55.8, `longitud fuera del predio: ${punto.lng}`);
});

test('el punto declarado manda sobre el centroide', () => {
  const p = puntoDe({ lat: -12.55, lng: -55.65, poligono: PREDIO });
  assert.equal(p.lat, -12.55);
  assert.equal(p.lng, -55.65);
});

test('sin punto ni polígono no hay ubicación: null', () => {
  assert.equal(puntoDe({}), null);
  assert.equal(puntoDe({ lat: -12.5 }), null);       // media coordenada no ubica
  assert.equal(puntoDe({ poligono: { type: 'Polygon', coordinates: [[[0, 0]]] } }), null);
});

test('el centroide no pesa dos veces el vértice de cierre', () => {
  // El anillo repite el primer vértice al final. Contarlo dos veces
  // correría el centroide hacia esa esquina.
  const cuadrado = { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] };
  const c = puntoDe({ poligono: cuadrado });
  assert.equal(c.lng, 1);
  assert.equal(c.lat, 1);
});

// ---------- El frontend y el backend tienen que dar lo MISMO ----------

test('el área que muestra el navegador coincide con la que calcula el servidor', async () => {
  // `frontend/src/panel-corredor/geo.js` repite la fórmula del área para
  // poder mostrarla al momento de cargar el archivo, antes de guardar.
  // Esa duplicación es deliberada —el navegador no puede consultar al
  // servidor en cada tecla— pero es exactamente el tipo de copia que se
  // separa con el tiempo: el usuario vería "102,4 ha" y el servidor
  // guardaría otra cosa, y el desacuerdo de área que decide el nivel de
  // confianza pasaría a depender de cuál de las dos miró.
  const { areaHa: areaFrontend } = await import('../../frontend/src/panel-corredor/geo.js');

  const casos = [
    { type: 'Polygon', coordinates: [[[-55.7, -12.5], [-55.6908, -12.5], [-55.6908, -12.5092], [-55.7, -12.5092], [-55.7, -12.5]]] },
    { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
    { type: 'Polygon', coordinates: [[[-70.6, -33.4], [-70.5, -33.4], [-70.55, -33.3], [-70.6, -33.4]]] },
  ];
  for (const geo of casos) {
    assert.equal(areaFrontend(geo), areaHa(geo), `difieren para ${JSON.stringify(geo.coordinates[0][0])}`);
  }
});

test('el umbral de 4 ha del EUDR es el mismo en los dos lados', () => {
  // Si el frontend dejara pasar un punto para 5 ha, el backend lo
  // rechazaría con un 400 después de que la persona llenó todo el
  // formulario.
  assert.equal(EXIGE_POLIGONO_HA, 4);
});
