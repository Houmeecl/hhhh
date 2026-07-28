// Genera una muestra de CADA documento que produce sicr3p, con datos
// ficticios pero realistas, en esta misma carpeta.
//
// Sale del código real, no de maquetas: si un generador cambia, la muestra
// cambia con él. Correrlo después de tocar pdf.js es la forma más rápida de
// ver una regresión que los tests no atrapan — un PDF que no lanza excepción
// puede igual salir con `undefined` en una columna.
//
// Cuidado con la semilla: la cadena global arranca desde `cadena_estado` y se
// cierra al terminar, igual que hace routes/public.js. Saltarse ese paso hace
// que el informe salga diciendo «cadena ALTERADA» aunque el sistema esté bien.
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/sicr3p';
process.env.PUBLIC_APP_URL = 'https://sicr3p.cl';

import { writeFileSync, mkdirSync } from 'node:fs';
const OUT = new URL('.', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const B = new URL('../../backend/src', import.meta.url).pathname;
const { query, withTx } = await import(`${B}/lib/db.js`);
const pdf = await import(`${B}/services/pdf.js`);
const { generarSelloSvg } = await import(`${B}/services/sello.js`);
const { hashDocumento, hashCadena } = await import(`${B}/services/cadenaHash.js`);
const { versionVigente } = await import(`${B}/services/motorVersiones.js`);
const { clausulas } = await import(`${B}/services/contrato.js`);

const guardar = (nombre, buf) => { writeFileSync(`${OUT}/${nombre}`, buf); console.log(`  ✓ ${nombre} (${Math.round(buf.length / 1024)} KB)`); };

// ============================================================
// 1. Sesión real con cadena de hash — base del informe y la etiqueta
// ============================================================
console.log('Sembrando una sesión con cadena real…');
await query(`DELETE FROM sesiones WHERE rut_cliente = '76.432.109-8'`);
const vId = (await versionVigente())?.id ?? null;

const ITEMS = [
  { n: 'F-8841', emisor: '96.800.570-7', glosa: 'Suministro eléctrico marzo', cat: 'Energía eléctrica', co2e: 3.8412, det: [['Consumo kWh 15.866', 15866, 3.8412, 'fisico']] },
  { n: 'F-1220', emisor: '81.201.000-K', glosa: 'Petróleo diésel 1.200 L', cat: 'Combustibles', co2e: 3.2160, det: [['Diésel B5 (L)', 1200, 3.2160, 'fisico']] },
  { n: 'F-0455', emisor: '77.905.310-4', glosa: 'Flete Santiago–Antofagasta', cat: 'Transporte y logística', co2e: 1.7400, det: [['Flete camión 1.450 km', 1450, 1.7400, 'fisico']] },
  { n: 'F-3097', emisor: '76.115.220-9', glosa: 'Insumos de oficina y aseo', cat: 'Bienes y servicios', co2e: 0.4185, det: [['Compra varios', 1, 0.4185, 'gasto']] },
];

const sesion = await withTx(async (c) => {
  const { rows: sr } = await c.query(
    `INSERT INTO sesiones (rut_cliente, nombre_cliente, email_cliente, total_co2e)
     VALUES ('76.432.109-8','Áridos del Maipo SpA','sustentabilidad@aridosdelmaipo.cl',$1) RETURNING *`,
    [ITEMS.reduce((a, i) => a + i.co2e, 0)]
  );
  const s = sr[0];
  // La cadena global arranca desde donde quedó, no desde null: es lo que
  // hace public.js. Sin esto el informe sale diciendo "cadena ALTERADA".
  const { rows: est } = await c.query(`SELECT ultimo_hash, n_eslabones FROM cadena_estado WHERE id = 1 FOR UPDATE`);
  let prev = est[0].ultimo_hash;
  let n = Number(est[0].n_eslabones);
  for (const it of ITEMS) {
    const hDoc = hashDocumento({
      numero_venta: it.n, rut_emisor: it.emisor, rut_receptor: '76.432.109-8',
      total_co2e: it.co2e, categoria: it.cat, archivo_original: `${it.n}.xml`,
    });
    const hCad = hashCadena(prev, hDoc);
    n += 1;
    const { rows: fr } = await c.query(
      `INSERT INTO facturas (sesion_id, numero_venta, archivo_original, rut_emisor, rut_receptor,
         total_co2e, categoria, status, motor, hash_documento, hash_anterior, hash_cadena, eslabon, motor_version_id)
       VALUES ($1,$2,$3,$4,'76.432.109-8',$5,$6,'procesada','propio',$7,$8,$9,$10,$11) RETURNING *`,
      [s.id, it.n, `${it.n}.xml`, it.emisor, it.co2e, it.cat, hDoc, prev, hCad, n, vId]
    );
    prev = hCad;
    for (const [desc, cant, co2e, metodo] of it.det) {
      await c.query(
        `INSERT INTO line_items (factura_id, descripcion, cantidad, co2e, porcentaje_total, metodo)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [fr[0].id, desc, cant, co2e, 100, metodo]
      );
    }
  }
  // Cerrar la cadena global, como hace public.js al terminar la sesión.
  await c.query(`UPDATE cadena_estado SET ultimo_hash = $1, n_eslabones = $2, updated_at = now() WHERE id = 1`, [prev, n]);
  // Declaración de embalaje (REP Ley 20.920)
  await c.query(
    `INSERT INTO declaraciones_embalaje (sesion_id, componentes, peso_total_gr, peso_reciclable_gr, porcentaje, nivel)
     VALUES ($1,$2::jsonb,$3,$4,$5,$6)`,
    [s.id, JSON.stringify([
      { material: 'carton', peso_gr: 420, cantidad: 12, reciclable: true },
      { material: 'plastico', peso_gr: 85, cantidad: 30, reciclable: true },
      { material: 'film', peso_gr: 40, cantidad: 8, reciclable: false },
    ]), 8210, 6600, 80.4, 'Alto']
  );
  return s;
});

const { rows: facturas } = await query(`SELECT * FROM facturas WHERE sesion_id = $1 ORDER BY eslabon`, [sesion.id]);
for (const f of facturas) {
  const { rows } = await query(`SELECT descripcion, cantidad, co2e, porcentaje_total, metodo FROM line_items WHERE factura_id = $1`, [f.id]);
  f.items = rows;
}

console.log('\nGenerando documentos…');

// ---------- Informe consolidado (el central) ----------
guardar('01-informe-consolidado.pdf', await pdf.generateReport({ sesion, facturas }));

// ---------- Informe mensual (sesión sintética por período) ----------
const sesionMes = {
  id: `202603${'764321098'}`, nombre_cliente: sesion.nombre_cliente, rut_cliente: sesion.rut_cliente,
  fecha: new Date(2026, 2, 1), total_co2e: sesion.total_co2e, periodo_texto: 'Marzo 2026',
};
for (const f of facturas) f.fecha = f.created_at;
guardar('02-informe-mensual.pdf', await pdf.generateReport({ sesion: sesionMes, facturas }));

// ---------- Etiqueta por factura (con QR de verificación) ----------
guardar('03-etiqueta-factura.pdf', await pdf.generateLabel({ sesion, factura: facturas[0] }));

// ---------- Estado de Capital Natural ----------
guardar('04-capital-natural.pdf', await pdf.generateBalanceNatural({
  balance: [
    { codigo: 'ATM', nombre: 'Atmósfera — CO2e', tipo: 'pasivo', unidad: 'tCO2e', saldo: 9.2157, n_movimientos: 4, activo: true },
    { codigo: 'AGU', nombre: 'Agua', tipo: 'pasivo', unidad: 'm3', saldo: 143.5, n_movimientos: 2, activo: true },
    { codigo: 'RES', nombre: 'Residuos de embalaje', tipo: 'pasivo', unidad: 'kg', saldo: 8.21, n_movimientos: 1, activo: true },
    { codigo: 'BOS', nombre: 'Bosque nativo en conservación', tipo: 'activo', unidad: 'ha', saldo: 12, n_movimientos: 1, activo: true },
  ],
  movimientos: [
    { fecha: new Date(2026, 2, 4), cuenta_codigo: 'ATM', tipo: 'cargo', cantidad: 3.8412, glosa: 'F-8841 · Suministro eléctrico marzo' },
    { fecha: new Date(2026, 2, 11), cuenta_codigo: 'ATM', tipo: 'cargo', cantidad: 3.2160, glosa: 'F-1220 · Petróleo diésel 1.200 L' },
    { fecha: new Date(2026, 2, 18), cuenta_codigo: 'ATM', tipo: 'cargo', cantidad: 1.7400, glosa: 'F-0455 · Flete Santiago–Antofagasta' },
    { fecha: new Date(2026, 2, 25), cuenta_codigo: 'RES', tipo: 'cargo', cantidad: 8.21, glosa: 'Declaración de embalaje del período' },
  ],
  activos: [
    { cuenta_codigo: 'BOS', nombre: 'Predio El Peumo, Cordillera', condicion: 'buena', extension: 12, unidad: 'ha', valor_origen: 'Tasación 2025', valor_clp_efectivo: 0 },
  ],
  integridad: [
    { codigo: 'ATM', valido: true, total_eslabones: 4, ultimo_hash: facturas[3].hash_cadena },
    { codigo: 'RES', valido: true, total_eslabones: 1, ultimo_hash: facturas[0].hash_documento },
  ],
  periodo: { desde: '2026-03-01', hasta: '2026-03-31' },
}));

// ---------- Contrato ----------
const datosContrato = {
  razon_social: 'Áridos del Maipo SpA', rut: '76.432.109-8',
  domicilio: 'Av. Vicuña Mackenna 4860, Macul, Santiago',
  representante: 'A completar', representante_rut: 'A completar',
  contacto_email: 'sustentabilidad@aridosdelmaipo.cl',
  precio_uf: null, plazo_meses: 12, fecha: '2026-03-01',
};
const cl = clausulas(datosContrato, 'asesoria');
guardar('05-contrato-asesoria.pdf', await pdf.generateContrato({
  contrato: { datos: datosContrato, tipo: 'asesoria', created_at: new Date() },
  clausulas: cl,
  pendientes: ['Precio en UF', 'Personería del representante'],
  titulo: 'CONTRATO DE PRESTACIÓN DE SERVICIOS',
  codigo: 'SICR3P-LEGAL-05',
}));

// ---------- Constancia de curso ----------
guardar('06-constancia-curso.pdf', await pdf.generateConstanciaCurso({
  constancia: { serial: 'CC-2026-0184', puntaje_pct: 92, emitida_at: new Date(2026, 2, 20) },
  curso: { titulo: 'Contabilidad de carbono para equipos de operaciones' },
  usuario: { nombre: 'Equipo de Operaciones' },
}));

// ---------- Carpeta del mandante ----------
guardar('07-carpeta-mandante.pdf', await pdf.generateCarpetaMandante({
  sesion, facturas,
  mandante: 'Minera Los Pelambres',
  contrapartes: [
    { rut: '96.800.570-7', nombre: 'Enel Distribución', n_documentos: 1, total_co2e: 3.8412 },
    { rut: '81.201.000-K', nombre: 'Copec', n_documentos: 1, total_co2e: 3.2160 },
  ],
}));

// ---------- Expediente de lote (Pasaporte de Origen) ----------
guardar('08-expediente-lote.pdf', await pdf.generateExpedienteLote({
  lote: {
    codigo: 'LM-2026-000318', tipo: 'mineral', material: 'Concentrado de cobre',
    codigo_nc: '2603', pais_origen: 'CL', faena_origen: 'Faena El Peumo',
    rut_titular: '76.432.109-8', cantidad: 850, unidad: 't', estado: 'cerrado',
    n_eslabones: 4, ultimo_hash: 'a3f9c1e8b2d4067f5a9c3e1b8d6f204a7c9e1b3d5f70826a4c9e1b3d5f708264',
  },
  // Nombres de campo tal como los lee el generador: `eslabon`, `fecha`,
  // `pais`, `divulgado`, `hash_cadena`.
  eslabones: [
    { eslabon: 1, rol: 'mina', visibilidad: 'publico', pais: 'CL', rut_empresa: '76.432.109-8', nombre_empresa: 'Áridos del Maipo SpA', cantidad: 850, fecha: new Date(2026, 1, 2), hash_cadena: '7c1e9b3d5f70826a4c9e1b3d5f708264a3f9c1e8b2d4067f5a9c3e1b8d6f204a', datos: { punto_control: 'Faena El Peumo' } },
    { eslabon: 2, rol: 'planta', visibilidad: 'publico', pais: 'CL', rut_empresa: '77.310.220-1', nombre_empresa: 'Planta Concentradora Alhué', cantidad: 848, fecha: new Date(2026, 1, 9), hash_cadena: 'b2d4067f5a9c3e1b8d6f204a7c9e1b3d5f70826a4c9e1b3d5f708264a3f9c1e8', datos: { punto_control: 'Alhué' } },
    { eslabon: 3, rol: 'transporte', visibilidad: 'publico', pais: 'CL', rut_empresa: '77.905.310-4', nombre_empresa: 'Transportes Cordillera', cantidad: 848, fecha: new Date(2026, 1, 14), hash_cadena: '5f70826a4c9e1b3d5f708264a3f9c1e8b2d4067f5a9c3e1b8d6f204a7c9e1b3d', datos: { punto_control: 'Ruta 5 · Los Vilos' } },
    // Este actor no autorizó divulgar su identidad: el expediente lo muestra
    // reservado y aun así el eslabón queda sellado y verificable.
    { eslabon: 4, rol: 'exportador', visibilidad: 'privado', pais: 'CL', rut_empresa: '96.520.100-3', nombre_empresa: 'Comercializadora Pacífico', cantidad: 845, fecha: new Date(2026, 1, 20), hash_cadena: 'a3f9c1e8b2d4067f5a9c3e1b8d6f204a7c9e1b3d5f70826a4c9e1b3d5f708264', datos: { punto_control: 'Puerto de Antofagasta' } },
  ],
  declaraciones: [],
  normativo: {
    cbam: { listo: true, aplicable: true, faltantes: [] },
    dpp: { listo: false, faltantes: ['composición detallada', 'reciclabilidad'] },
    oecd: { pasos_cubiertos: 4, pasos_total: 5, anexo2_cubiertas: 6, anexo2_total: 8 },
  },
  balance: { merma_pct: 0.59 },
  emisiones: { trazado_t: 41.8, declarado_t: 43.2, divergencia_pct: 3.24, fuente: 'motor propio' },
  anclaje: { eslabon: 4, hash_cadena: 'a3f9c1e8b2d4067f5a9c3e1b8d6f204a7c9e1b3d5f70826a4c9e1b3d5f708264', created_at: new Date(2026, 1, 21) },
  integra: true, documentos: [], tarjetas: [],
}));

// ---------- Credencial de tarjeta de viaje ----------
guardar('09-credencial-tarjeta.pdf', await pdf.generateCredencialTarjeta({
  tarjeta: { serial: 'TV-0472', portador: 'Transportes Cordillera Ltda.' },
  lote: { codigo: 'LM-2026-000318', material: 'Concentrado de cobre' },
}));

// ---------- Credencial de proveedor ----------
guardar('10-credencial-proveedor.pdf', await pdf.generateCredencialProveedor({
  credencial: { serial: 'FP-1195', rol: 'proveedor', rut_empresa: '77.310.220-1', nombre_empresa: 'Planta Concentradora Alhué' },
  lote: { codigo: 'LM-2026-000318', material: 'Concentrado de cobre' },
}));

// ---------- Reporte CBAM para el mandante ----------
guardar('11-reporte-cbam.pdf', await pdf.generateReporteCbam({
  mandante: 'Comercializadora Pacífico',
  lotes: [
    { codigo: 'LM-2026-000318', material: 'Concentrado de cobre', codigo_nc: '2603', pais_origen: 'CL', emisiones_directas_tco: 28.4, emisiones_indirectas_tco: 13.4, metodo_emisiones: 'motor propio', cbam: true },
    { codigo: 'LM-2026-000402', material: 'Cátodos de cobre', codigo_nc: '7403', pais_origen: 'CL', emisiones_directas_tco: 55.1, emisiones_indirectas_tco: 20.9, metodo_emisiones: 'motor propio', cbam: true },
  ],
}));

// ---------- Sello embebible (SVG) ----------
const svg = generarSelloSvg({
  empresa: sesion.nombre_cliente, t_co2e: Number(sesion.total_co2e),
  fecha: '2026-03-31', nivel_rep: 'Alto', cadena_intacta: true,
  verificar_url: `https://sicr3p.cl/verificar/${facturas[0].id}`,
});
guardar('12-sello.svg', Buffer.from(svg, 'utf8'));

// ---------- Export Alcance 3 GHG para el mandante (CSV y JSON) ----------
const { filasACsv } = await import(`${B}/services/csv.js`);
const filasA3 = [
  { rut_proveedor: '96.800.570-7', categoria_numero: 3, categoria_nombre: 'Actividades relacionadas con combustibles y energía', descripcion_motor: 'Energía eléctrica', n_documentos: 1, total_tco2e: 3.8412, fuente_factor: 'MMA Chile — HuellaChile (2023)' },
  { rut_proveedor: '81.201.000-K', categoria_numero: 3, categoria_nombre: 'Actividades relacionadas con combustibles y energía', descripcion_motor: 'Combustibles', n_documentos: 1, total_tco2e: 3.2160, fuente_factor: 'IPCC — Guías 2006 (v2)' },
  { rut_proveedor: '77.905.310-4', categoria_numero: 4, categoria_nombre: 'Transporte y distribución aguas arriba', descripcion_motor: 'Transporte y logística', n_documentos: 1, total_tco2e: 1.7400, fuente_factor: 'Smart Freight Centre — GLEC Framework (v3)' },
  { rut_proveedor: '76.115.220-9', categoria_numero: 1, categoria_nombre: 'Bienes y servicios adquiridos', descripcion_motor: 'Bienes y servicios', n_documentos: 1, total_tco2e: 0.4185, fuente_factor: 'WRI/WBCSD — GHG Protocol Corporate Standard (2004)' },
];
const headersA3 = ['rut_proveedor', 'categoria_numero', 'categoria_nombre_ghg_protocol', 'descripcion_motor', 'n_documentos', 'total_tco2e', 'fuente_factor'];
guardar('13-export-alcance3.csv', Buffer.from('﻿' + filasACsv(headersA3, filasA3.map((f) => ({
  rut_proveedor: f.rut_proveedor, categoria_numero: f.categoria_numero,
  categoria_nombre_ghg_protocol: f.categoria_nombre, descripcion_motor: f.descripcion_motor,
  n_documentos: f.n_documentos, total_tco2e: f.total_tco2e.toFixed(4), fuente_factor: f.fuente_factor,
})), 'utf8')));
guardar('14-export-alcance3.json', Buffer.from(JSON.stringify({
  mandante: { rut: '96.520.100-3', nombre: 'Comercializadora Pacífico' },
  anio: 2026,
  marco: 'GHG Protocol Corporate Value Chain (Scope 3) Standard — contexto ISSB / NCG 461',
  nota: 'Emisiones de proveedores calculadas por sicr3p sobre documentos tributarios reales. '
      + 'No constituye una verificación de tercera parte acreditada.',
  filas: filasA3,
}, null, 2), 'utf8'));

// ---------- Export CBAM (CSV) ----------
const headersCbam = ['codigo', 'pais_origen', 'material', 'codigo_nc', 'cbam_aplicable', 'metodo_emisiones', 'emisiones_directas_tco2e_t', 'emisiones_indirectas_tco2e_t', 'cbam_listo', 'cbam_faltantes'];
guardar('15-export-cbam.csv', Buffer.from('﻿' + filasACsv(headersCbam, [
  { codigo: 'LM-2026-000318', pais_origen: 'CL', material: 'Concentrado de cobre', codigo_nc: '2603', cbam_aplicable: 'si', metodo_emisiones: 'motor propio', emisiones_directas_tco2e_t: '28.4000', emisiones_indirectas_tco2e_t: '13.4000', cbam_listo: 'si', cbam_faltantes: '' },
  { codigo: 'LM-2026-000402', pais_origen: 'CL', material: 'Cátodos de cobre', codigo_nc: '7403', cbam_aplicable: 'si', metodo_emisiones: 'motor propio', emisiones_directas_tco2e_t: '55.1000', emisiones_indirectas_tco2e_t: '20.9000', cbam_listo: 'no', cbam_faltantes: 'instalación de origen' },
]), 'utf8'));

console.log('\nListo.');
process.exit(0);
