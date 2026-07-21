import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLES,
  validarSecuenciaRoles,
  hashEslabonLote,
  generarNonce,
  validarEslabon,
  balanceMasas,
  TOLERANCIA_MERMA_PCT,
  filtrarPorVisibilidad,
  enmascararRut,
  CATALOGO_DECLARACIONES,
  codigoDeclaracionValido,
  CAPITULOS_NC_CBAM,
  validarNc,
  cbamAplicable,
  emisionesIncorporadasPorTonelada,
  resumenNormativo,
  generarCodigoLote,
  GENESIS,
  hashCadena,
} from '../src/services/pasaporteOrigen.js';
import { verificarCadenaCompleta } from '../src/services/cadenaHash.js';

const LOTE = { codigo: 'LM-2026-000001', cantidad: 100, unidad: 't', estado: 'abierto', codigo_nc: '740311', composicion: { ley_pct: 99.99 }, n_eslabones: 0 };

const ESLABON_BASE = {
  rol: 'mina', rut_empresa: '76.123.456-0', pais: 'CL',
  fecha: '2026-07-01', cantidad: 100, co2e_aportado: 12.5, visibilidad: 'publico',
};

// RUT válido módulo 11 para tests (76.123.456-0 → verificar con rutValido real:
// usamos uno conocido válido: 12.345.678-5).
const RUT_VALIDO = '12345678-5';

// ---------- hashEslabonLote ----------

test('hashEslabonLote es determinista y sensible a cada campo', () => {
  const base = { lote_codigo: 'LM-2026-000001', eslabon: 1, rol: 'mina', rut_empresa: RUT_VALIDO, pais: 'CL', fecha: '2026-07-01', cantidad: 100, co2e_aportado: 12.5, factura_numero: 'F-1', nonce: 'abc123' };
  const h1 = hashEslabonLote(base);
  assert.equal(h1, hashEslabonLote({ ...base })); // determinista
  assert.match(h1, /^[0-9a-f]{64}$/);
  // cada campo cambia el hash
  for (const [k, v] of [['rol', 'planta'], ['cantidad', 99], ['nonce', 'otro'], ['fecha', '2026-07-02'], ['co2e_aportado', 12.6]]) {
    assert.notEqual(hashEslabonLote({ ...base, [k]: v }), h1, `campo ${k} debió alterar el hash`);
  }
  // normalización de RUT: con o sin puntos/guión, mismo hash
  assert.equal(hashEslabonLote({ ...base, rut_empresa: '12.345.678-5' }), hashEslabonLote({ ...base, rut_empresa: '123456785' }));
});

test('generarNonce produce 32 hex distintos', () => {
  const a = generarNonce();
  const b = generarNonce();
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(a, b);
});

// ---------- cadena por lote (primitivas reutilizadas) ----------

test('la cadena por lote se verifica de punta a punta y detecta alteraciones', () => {
  let anterior = GENESIS;
  const eslabones = [];
  for (let i = 1; i <= 3; i++) {
    const hd = hashEslabonLote({ lote_codigo: 'LM-2026-000001', eslabon: i, rol: 'mina', nonce: `n${i}` });
    const hc = hashCadena(anterior, hd);
    eslabones.push({ id: `e${i}`, eslabon: i, hash_documento: hd, hash_anterior: anterior, hash_cadena: hc });
    anterior = hc;
  }
  assert.equal(verificarCadenaCompleta(eslabones).valido, true);
  // alterar el eslabón 2 rompe la cadena EN el 2 (hash_cadena ya no coincide)
  const alterados = eslabones.map((e) => e.eslabon === 2 ? { ...e, hash_documento: 'f'.repeat(64) } : e);
  const r = verificarCadenaCompleta(alterados);
  assert.equal(r.valido, false);
  assert.equal(r.rompe_en, 'e2');
});

// ---------- validarEslabon ----------

test('validarEslabon acepta un eslabón chileno válido', () => {
  const r = validarEslabon({ ...ESLABON_BASE, rut_empresa: RUT_VALIDO }, LOTE, []);
  assert.equal(r.ok, true, JSON.stringify(r.errores));
  assert.equal(r.rut_normalizado, '123456785');
});

test('validarEslabon rechaza RUT chileno inválido, fecha futura, lote cerrado y rol basura', () => {
  assert.equal(validarEslabon({ ...ESLABON_BASE, rut_empresa: '12345678-9' }, LOTE).ok, false); // DV malo
  assert.equal(validarEslabon({ ...ESLABON_BASE, rut_empresa: RUT_VALIDO, fecha: '2030-01-01' }, LOTE).ok, false);
  assert.equal(validarEslabon({ ...ESLABON_BASE, rut_empresa: RUT_VALIDO }, { ...LOTE, estado: 'cerrado' }).ok, false);
  assert.equal(validarEslabon({ ...ESLABON_BASE, rut_empresa: RUT_VALIDO, rol: 'alquimista' }, LOTE).ok, false);
  assert.equal(validarEslabon({ ...ESLABON_BASE, rut_empresa: RUT_VALIDO, cantidad: 101 }, LOTE).ok, false); // > lote
});

test('validarEslabon: extranjero sin RUT pasa; chileno sin RUT no', () => {
  const ar = validarEslabon({ ...ESLABON_BASE, rol: 'transporte', pais: 'AR', rut_empresa: null }, LOTE);
  assert.equal(ar.ok, true, JSON.stringify(ar.errores));
  const cl = validarEslabon({ ...ESLABON_BASE, rut_empresa: null }, LOTE);
  assert.equal(cl.ok, false);
});

test('validarSecuenciaRoles advierte retrocesos e ignora transporte', () => {
  assert.equal(validarSecuenciaRoles([
    { eslabon: 1, rol: 'mina' }, { eslabon: 2, rol: 'transporte' }, { eslabon: 3, rol: 'refineria' },
  ]).length, 0);
  const adv = validarSecuenciaRoles([
    { eslabon: 1, rol: 'exportador' }, { eslabon: 2, rol: 'mina' },
  ]);
  assert.equal(adv.length, 1);
});

// ---------- balance de masas ----------

test('balanceMasas: sin merma no alerta; merma sobre tolerancia alerta', () => {
  const ok = balanceMasas(LOTE, [
    { cantidad: 100 }, { cantidad: 99 },
  ]);
  assert.equal(ok.alerta, false);
  assert.equal(ok.merma_pct, 1);

  const mal = balanceMasas(LOTE, [
    { cantidad: 100 }, { cantidad: 100 - TOLERANCIA_MERMA_PCT - 2 },
  ]);
  assert.equal(mal.alerta, true);
});

test('balanceMasas sin cantidades declaradas no alerta', () => {
  const r = balanceMasas(LOTE, [{ rol: 'mina' }]);
  assert.equal(r.alerta, false);
  assert.equal(r.ultima_cantidad, null);
});

// ---------- divulgación selectiva ----------

test('filtrarPorVisibilidad: público ve hashes de todos pero contenido solo de públicos', () => {
  const eslabones = [
    { eslabon: 1, rol: 'mina', pais: 'CL', fecha: '2026-07-01', visibilidad: 'publico', rut_empresa: '123456785', cantidad: 100, co2e_aportado: 1, nonce: 'SECRETO', hash_documento: 'a', hash_anterior: 'b', hash_cadena: 'c' },
    { eslabon: 2, rol: 'refineria', pais: 'CL', fecha: '2026-07-02', visibilidad: 'cadena', rut_empresa: '765432109', cantidad: 99, co2e_aportado: 2, nonce: 'SECRETO2', hash_documento: 'd', hash_anterior: 'c', hash_cadena: 'e' },
    { eslabon: 3, rol: 'exportador', pais: 'CL', fecha: '2026-07-03', visibilidad: 'privado', rut_empresa: '111111111', cantidad: 99, co2e_aportado: 0, nonce: 'SECRETO3', hash_documento: 'f', hash_anterior: 'e', hash_cadena: 'g' },
  ];
  const pub = filtrarPorVisibilidad(eslabones, 'publico');
  assert.equal(pub.length, 3);
  // integridad siempre visible
  assert.equal(pub[1].hash_cadena, 'e');
  assert.equal(pub[2].rol, 'exportador');
  // contenido oculto para cadena/privado
  assert.equal(pub[0].divulgado, true);
  assert.equal(pub[0].rut_empresa, '123456785');
  assert.equal(pub[1].divulgado, false);
  assert.equal('rut_empresa' in pub[1], false);
  assert.equal(pub[2].divulgado, false);
  // nonce JAMÁS sale, a ningún nivel
  const priv = filtrarPorVisibilidad(eslabones, 'privado');
  assert.equal(priv.every((e) => !('nonce' in e)), true);
  assert.equal(priv[2].divulgado, true);
  assert.equal(priv[2].rut_empresa, '111111111');
  // nivel cadena ve el 2 pero no el 3
  const cad = filtrarPorVisibilidad(eslabones, 'cadena');
  assert.equal(cad[1].divulgado, true);
  assert.equal(cad[2].divulgado, false);
});

test('enmascararRut oculta el cuerpo y conserva extremos', () => {
  assert.equal(enmascararRut('76.123.456-0'), '76.***.**6-0');
  assert.equal(enmascararRut('12345678-5'), '12.***.**8-5');
  assert.equal(enmascararRut('x'), null);
});

// ---------- normativa ----------

test('codigoDeclaracionValido acepta el catálogo y rechaza inventos', () => {
  for (const d of CATALOGO_DECLARACIONES) assert.equal(codigoDeclaracionValido(d.codigo), true);
  assert.equal(codigoDeclaracionValido('oecd_p9'), false);
  assert.equal(codigoDeclaracionValido(''), false);
});

test('cbamAplicable: cobre NO, aluminio y acero SÍ', () => {
  assert.equal(cbamAplicable('740311'), false); // cátodos de cobre — fuera del Anexo I vigente
  assert.equal(cbamAplicable('760110'), true);  // aluminio
  assert.equal(cbamAplicable('720610'), true);  // acero
  assert.equal(cbamAplicable('2523'), true);    // cemento (4 dígitos)
  assert.equal(cbamAplicable('abc'), false);
  assert.equal(cbamAplicable(''), false);
  assert.ok(CAPITULOS_NC_CBAM.includes('76'));
});

test('validarNc exige 4, 6 u 8 dígitos', () => {
  assert.equal(validarNc('7403'), true);
  assert.equal(validarNc('740311'), true);
  assert.equal(validarNc('74031100'), true);
  for (const v of ['74', '74031', 'x403', '', null]) assert.equal(validarNc(v), false);
});

test('emisionesIncorporadasPorTonelada contrasta declarado vs trazado', () => {
  const lote = { ...LOTE, emisiones_directas_tco2e_t: 0.1, emisiones_indirectas_tco2e_t: 0.05 };
  // trazado: 15 t CO2e / 100 t = 0.15/t = declarado → sin advertencia
  const ok = emisionesIncorporadasPorTonelada(lote, [{ co2e_aportado: 10 }, { co2e_aportado: 5 }]);
  assert.equal(ok.trazado_t, 0.15);
  assert.equal(ok.declarado_t, 0.15);
  assert.equal(ok.advertencia, false);
  // trazado muy distinto → advertencia
  const mal = emisionesIncorporadasPorTonelada(lote, [{ co2e_aportado: 30 }]);
  assert.equal(mal.advertencia, true);
  // sin declaración → sin divergencia
  const sin = emisionesIncorporadasPorTonelada(LOTE, [{ co2e_aportado: 5 }]);
  assert.equal(sin.declarado_t, null);
  assert.equal(sin.advertencia, false);
});

test('resumenNormativo cuenta pasos OECD y faltantes CBAM/DPP', () => {
  const vacio = resumenNormativo({ ...LOTE, composicion: {} }, []);
  assert.equal(vacio.oecd.pasos_cubiertos, 0);
  assert.equal(vacio.cbam.listo, false);
  assert.ok(vacio.cbam.faltantes.includes('emisiones_directas'));
  assert.ok(vacio.dpp.faltantes.includes('composicion'));
  assert.equal(vacio.cbam.aplicable, false); // cobre

  const completo = resumenNormativo(
    { ...LOTE, faena_origen: 'Mina X', emisiones_directas_tco2e_t: 0.1, emisiones_indirectas_tco2e_t: 0.05, metodo_emisiones: 'valores_reales', n_eslabones: 3 },
    ['oecd_p1', 'oecd_p2', 'oecd_p3', 'oecd_p4', 'oecd_p5', 'oecd_a2_conflicto'].map((c, i) => ({ codigo: c, estado: i % 2 ? 'declarado' : 'con_evidencia' }))
  );
  assert.equal(completo.oecd.pasos_cubiertos, 5);
  assert.equal(completo.oecd.anexo2_cubiertas, 1);
  assert.equal(completo.cbam.listo, true);
  assert.equal(completo.dpp.listo, true);
});

// ---------- código de lote ----------

test('generarCodigoLote formatea LM-AAAA-NNNNNN', () => {
  assert.equal(generarCodigoLote(2026, 1), 'LM-2026-000001');
  assert.equal(generarCodigoLote(2026, 123456), 'LM-2026-123456');
});

test('ROLES es el superset de los roles de los 3 tipos, sin duplicados', () => {
  assert.equal(new Set(ROLES).size, ROLES.length);
  // roles representativos de cada tipo
  assert.ok(ROLES.includes('mina') && ROLES.includes('comprador'));       // mineral
  assert.ok(ROLES.includes('comercio') && ROLES.includes('punto_aduana_verde')); // producto
  assert.ok(ROLES.includes('frontera') && ROLES.includes('destino'));     // documental
});

// ---------- Tarjeta de Viaje ----------

test('generarSerialTarjeta produce TV-XXXX válidos y variados', async () => {
  const { generarSerialTarjeta, serialTarjetaValido } = await import('../src/services/pasaporteOrigen.js');
  const muestras = new Set();
  for (let i = 0; i < 60; i++) {
    const s = generarSerialTarjeta();
    assert.equal(serialTarjetaValido(s), true, s);
    muestras.add(s);
  }
  assert.ok(muestras.size >= 55, 'demasiadas colisiones');
  assert.equal(serialTarjetaValido('AV-1234'), false);
  assert.equal(serialTarjetaValido('TV-12G4'), false);
  assert.equal(serialTarjetaValido(''), false);
});

// ---------- Anclaje en la cadena global ----------

test('hashAnclajeLote es determinista, sensible y distinto a hashEslabonLote', async () => {
  const { hashAnclajeLote } = await import('../src/services/pasaporteOrigen.js');
  const base = { codigo: 'LM-2026-000001', ultimo_hash: 'a'.repeat(64), n_eslabones: 4 };
  const h = hashAnclajeLote(base);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, hashAnclajeLote({ ...base }));
  assert.notEqual(h, hashAnclajeLote({ ...base, n_eslabones: 5 }));
  assert.notEqual(h, hashAnclajeLote({ ...base, ultimo_hash: 'b'.repeat(64) }));
});

test('la cadena global mixta (facturas + anclaje) verifica de punta a punta', async () => {
  const { hashAnclajeLote } = await import('../src/services/pasaporteOrigen.js');
  // factura 1 → factura 2 → ANCLAJE de lote → factura 3
  let anterior = GENESIS;
  const eslabones = [];
  const empujar = (id, hashDoc) => {
    const hc = hashCadena(anterior, hashDoc);
    eslabones.push({ id, eslabon: eslabones.length + 1, hash_documento: hashDoc, hash_anterior: anterior, hash_cadena: hc });
    anterior = hc;
  };
  empujar('f1', 'd'.repeat(64));
  empujar('f2', 'e'.repeat(64));
  empujar('anclaje-1', hashAnclajeLote({ codigo: 'LM-2026-000001', ultimo_hash: 'a'.repeat(64), n_eslabones: 3 }));
  empujar('f3', 'f'.repeat(64));
  const r = verificarCadenaCompleta(eslabones);
  assert.equal(r.valido, true);
  assert.equal(r.total_eslabones, 4);
});

// ---------- Tipos de pasaporte (migración 023) ----------

test('materialValido respeta el catálogo de cada tipo', async () => {
  const { materialValido, TIPOS, CATALOGO_MATERIALES } = await import('../src/services/pasaporteOrigen.js');
  assert.deepEqual(TIPOS, ['mineral', 'producto', 'documental']);
  assert.equal(materialValido('mineral', 'cobre_catodo'), true);
  assert.equal(materialValido('producto', 'alimentos'), true);
  assert.equal(materialValido('documental', 'contenedor'), true);
  // cruces inválidos: el cobre NO es un producto de ciudad, etc.
  assert.equal(materialValido('producto', 'cobre_catodo'), false);
  assert.equal(materialValido('documental', 'alimentos'), false);
  assert.equal(materialValido('mineral', 'textil'), false);
  assert.equal(materialValido('inexistente', 'otro'), false);
  assert.ok(CATALOGO_MATERIALES.producto.includes('embalajes'));
});

test('validarEslabon exige roles del tipo del lote', () => {
  const loteProducto = { ...LOTE, tipo: 'producto' };
  // 'mina' no existe en un pasaporte de producto
  assert.equal(validarEslabon({ ...ESLABON_BASE, rut_empresa: RUT_VALIDO, rol: 'mina' }, loteProducto).ok, false);
  // 'comercio' sí
  assert.equal(validarEslabon({ ...ESLABON_BASE, rut_empresa: RUT_VALIDO, rol: 'comercio' }, loteProducto).ok, true);
  // documental: 'frontera' válido, 'refineria' no
  const loteDoc = { ...LOTE, tipo: 'documental' };
  assert.equal(validarEslabon({ ...ESLABON_BASE, rut_empresa: RUT_VALIDO, rol: 'frontera' }, loteDoc).ok, true);
  assert.equal(validarEslabon({ ...ESLABON_BASE, rut_empresa: RUT_VALIDO, rol: 'refineria' }, loteDoc).ok, false);
  // sin tipo = mineral (compatibilidad con lotes de la 021)
  assert.equal(validarEslabon({ ...ESLABON_BASE, rut_empresa: RUT_VALIDO, rol: 'mina' }, LOTE).ok, true);
});

test('validarSecuenciaRoles por tipo: documental acepta frontera/puerto intercalados', () => {
  const ok = validarSecuenciaRoles([
    { eslabon: 1, rol: 'origen' }, { eslabon: 2, rol: 'frontera' },
    { eslabon: 3, rol: 'puerto' }, { eslabon: 4, rol: 'destino' },
  ], 'documental');
  assert.equal(ok.length, 0);
  const mal = validarSecuenciaRoles([
    { eslabon: 1, rol: 'destino' }, { eslabon: 2, rol: 'origen' },
  ], 'documental');
  assert.equal(mal.length, 1);
});

test('resumenNormativo: OECD minerales SOLO para tipo mineral', () => {
  const declar = ['oecd_p1'].map((c) => ({ codigo: c, estado: 'declarado' }));
  // mineral (o sin tipo): bloque OECD presente
  assert.ok(resumenNormativo(LOTE, declar).oecd);
  assert.ok(resumenNormativo({ ...LOTE, tipo: 'mineral' }, declar).oecd);
  // producto y documental: null (un lote de alimentos no declara due diligence de minerales)
  assert.equal(resumenNormativo({ ...LOTE, tipo: 'producto' }, declar).oecd, null);
  assert.equal(resumenNormativo({ ...LOTE, tipo: 'documental' }, declar).oecd, null);
  // CBAM y DPP siguen presentes en todos los tipos
  assert.ok(resumenNormativo({ ...LOTE, tipo: 'producto' }, declar).cbam);
  assert.ok(resumenNormativo({ ...LOTE, tipo: 'documental' }, declar).dpp);
});
