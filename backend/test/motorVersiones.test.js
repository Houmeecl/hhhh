import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { fusionarMetodologia, fusionarFactores } from '../src/services/motorVersiones.js';
import { lineaFactorElectricidad } from '../src/services/pdf.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

// Busca una migración por su sufijo en vez de por su número: el número
// cambió al traer esto desde el repositorio nuevo, y volverá a cambiar.
// Fallar por un renumerado sería ruido; fallar porque la migración
// desapareció, no.
function leerMigracion(sufijo) {
  const archivo = readdirSync(join(raiz, 'migrations')).find((f) => f.endsWith(sufijo));
  assert.ok(archivo, `no se encontró la migración *${sufijo}`);
  return readFileSync(join(raiz, 'migrations', archivo), 'utf8');
}

// ============================================================
// Lo que estos tests protegen: un informe ya emitido tiene que seguir
// citando la metodología con la que REALMENTE se calculó. El PDF no se
// guarda —se rearma en cada descarga— así que la única defensa es que la
// metodología salga de la versión estampada en la factura y no del estado
// vigente del motor.
// ============================================================

test('una sola versión: la línea del PDF queda igual que siempre (sin marca de versión)', () => {
  const { alcances, versiones, mixta } = fusionarMetodologia([
    { version_id: 3, nombre: 'Energía eléctrica', alcance_ghg: 'Alcance 2', fuente_organismo: 'MMA', fuente_documento: 'HuellaChile', fuente_version_anio: '2023' },
    { version_id: 3, nombre: 'Combustibles', alcance_ghg: 'Alcance 1', fuente_organismo: 'IPCC', fuente_documento: 'Guías 2006', fuente_version_anio: 'v2' },
  ]);
  assert.equal(mixta, false);
  assert.deepEqual(versiones, [3]);
  assert.equal(alcances.length, 2);
  // Sin ambigüedad no se ensucia la línea con "[v3]".
  assert.ok(alcances.every((a) => a.version_motor === null));
});

test('dos versiones que coinciden se fusionan en una sola fila', () => {
  const { alcances, versiones, mixta } = fusionarMetodologia([
    { version_id: 1, nombre: 'Energía eléctrica', alcance_ghg: 'Alcance 2', fuente_organismo: 'MMA', fuente_documento: 'HuellaChile', fuente_version_anio: '2023' },
    { version_id: 2, nombre: 'Energía eléctrica', alcance_ghg: 'Alcance 2', fuente_organismo: 'MMA', fuente_documento: 'HuellaChile', fuente_version_anio: '2023' },
  ]);
  // La versión 2 pudo cambiar OTRA categoría; para esta no hay conflicto.
  assert.equal(mixta, false);
  assert.deepEqual(versiones, [1, 2]);
  assert.equal(alcances.length, 1);
  assert.equal(alcances[0].version_motor, null);
});

test('si una categoría cambió de fuente entre versiones, salen las dos marcadas', () => {
  const { alcances, mixta } = fusionarMetodologia([
    { version_id: 1, nombre: 'Energía eléctrica', alcance_ghg: 'Alcance 2', fuente_organismo: 'MMA', fuente_documento: 'HuellaChile', fuente_version_anio: '2023' },
    { version_id: 2, nombre: 'Energía eléctrica', alcance_ghg: 'Alcance 2', fuente_organismo: 'MMA', fuente_documento: 'HuellaChile', fuente_version_anio: '2025' },
  ]);
  // No se elige una y se calla: el informe declara que abarca dos versiones.
  assert.equal(mixta, true);
  assert.equal(alcances.length, 2);
  assert.deepEqual(alcances.map((a) => a.version_motor).sort(), [1, 2]);
  assert.deepEqual(alcances.map((a) => a.version_anio).sort(), ['2023', '2025']);
});

test('las categorías sin alcance declarado no llegan al PDF', () => {
  const { alcances } = fusionarMetodologia([
    { version_id: 1, nombre: 'Servicios', alcance_ghg: null, fuente_organismo: null, fuente_documento: null, fuente_version_anio: null },
  ]);
  assert.equal(alcances.length, 0);
});

test('fusionarMetodologia tolera vacío y basura sin lanzar', () => {
  for (const entrada of [null, undefined, []]) {
    const r = fusionarMetodologia(entrada);
    assert.deepEqual(r, { alcances: [], versiones: [], mixta: false });
  }
});

test('el factor de electricidad del PDF sale de la versión, no de una constante', () => {
  const factores = fusionarFactores([
    { version_id: 5, codigo: 'electricidad', nombre: 'Energía eléctrica', unidad_fisica: 'kWh', factor_fisico_kgco2e: '0.3100' },
  ]);
  const linea = lineaFactorElectricidad({ factores });
  assert.match(linea, /0,31/);
  // El valor viejo NO puede seguir apareciendo cuando la versión dice otra cosa.
  assert.ok(!linea.includes('0,2421'), `la línea quedó citando el factor viejo: ${linea}`);
});

test('dos versiones con factores distintos citan los dos, no el primero que llegue', () => {
  // Sin esto, la línea dependía del orden en que Postgres devolviera las
  // filas: el MISMO informe podía imprimir un factor distinto entre descargas.
  const filas = [
    { version_id: 1, codigo: 'electricidad', nombre: 'Energía eléctrica', unidad_fisica: 'kWh', factor_fisico_kgco2e: '0.2421' },
    { version_id: 2, codigo: 'electricidad', nombre: 'Energía eléctrica', unidad_fisica: 'kWh', factor_fisico_kgco2e: '0.3100' },
  ];
  const linea = lineaFactorElectricidad({ factores: fusionarFactores(filas) });
  assert.match(linea, /0,2421/);
  assert.match(linea, /0,31/);
  assert.match(linea, /v1/);
  assert.match(linea, /v2/);
  // Y el orden no depende de cómo lleguen las filas.
  const alReves = lineaFactorElectricidad({ factores: fusionarFactores([...filas].reverse()) });
  assert.equal(linea, alReves);
});

test('dos versiones con el MISMO factor no ensucian la línea', () => {
  const factores = fusionarFactores([
    { version_id: 1, codigo: 'electricidad', nombre: 'Energía eléctrica', unidad_fisica: 'kWh', factor_fisico_kgco2e: '0.2421' },
    { version_id: 2, codigo: 'electricidad', nombre: 'Energía eléctrica', unidad_fisica: 'kWh', factor_fisico_kgco2e: '0.2421' },
  ]);
  const linea = lineaFactorElectricidad({ factores });
  assert.ok(!linea.includes('v1'), `la línea marcó versiones sin necesidad: ${linea}`);
});

test('sin versión estampada se conserva la línea histórica', () => {
  // Facturas anteriores al versionado: 0,2421 es lo que efectivamente se usó
  // en esos cálculos, así que decir otra cosa sería peor.
  assert.match(lineaFactorElectricidad(null), /0,2421/);
  assert.match(lineaFactorElectricidad({ factores: new Map() }), /0,2421/);
  const sinFactor = fusionarFactores([{ version_id: 1, codigo: 'electricidad', factor_fisico_kgco2e: 0 }]);
  assert.match(lineaFactorElectricidad({ factores: sinFactor }), /0,2421/);
});

// ---------- Guardas sobre el código, no sobre la lógica ----------

test('pdf.js no vuelve a leer la metodología en vivo en el camino principal', () => {
  const src = readFileSync(join(raiz, 'src/services/pdf.js'), 'utf8');
  // fetchAlcancesGHG puede existir (es el respaldo para facturas sin versión),
  // pero generateReport tiene que intentar PRIMERO la versión congelada.
  assert.ok(
    src.includes('metodologiaDeVersiones'),
    'generateReport dejó de resolver la metodología por versión: los informes emitidos volverían a cambiar al editar un factor.'
  );
  const iVersion = src.indexOf('metodologiaDeVersiones(facturas');
  assert.ok(iVersion > 0, 'la metodología ya no se deriva de las facturas del informe.');
});

test('no hay endpoint que edite ni borre una versión ya emitida', () => {
  const src = readFileSync(join(raiz, 'src/routes/motor.js'), 'utf8');
  const prohibidos = [
    /router\.put\(\s*['"`]\/versiones/,
    /router\.patch\(\s*['"`]\/versiones/,
    /router\.delete\(\s*['"`]\/versiones/,
  ];
  for (const re of prohibidos) {
    assert.ok(!re.test(src), `apareció un endpoint que modifica versiones (${re}): versionar solo inserta.`);
  }
});

test('el servicio de versiones nunca hace UPDATE ni DELETE sobre el histórico', () => {
  const src = readFileSync(join(raiz, 'src/services/motorVersiones.js'), 'utf8');
  const sql = src.replace(/\/\/.*$/gm, ''); // fuera comentarios
  assert.ok(!/UPDATE\s+motor_categorias_version/i.test(sql));
  assert.ok(!/DELETE\s+FROM\s+motor_categorias_version/i.test(sql));
  assert.ok(!/UPDATE\s+motor_versiones/i.test(sql));
  assert.ok(!/DELETE\s+FROM\s+motor_versiones/i.test(sql));
});

test('la migración 051 no altera ninguna columna que entre en el hash de la factura', () => {
  const sql = leerMigracion('_motor_versiones.sql');
  // hashDocumento() cubre estas seis. Un UPDATE sobre cualquiera de ellas
  // rompería la cadena global en silencio.
  const enElHash = ['numero_venta', 'rut_emisor', 'rut_receptor', 'total_co2e', 'categoria', 'archivo_original'];
  const updates = sql.match(/UPDATE\s+facturas\s+SET\s+([^;]+)/gi) || [];
  for (const u of updates) {
    for (const col of enElHash) {
      assert.ok(
        !new RegExp(`\\b${col}\\s*=`, 'i').test(u),
        `la migración escribe sobre facturas.${col}, que entra en hashDocumento().`
      );
    }
  }
});
