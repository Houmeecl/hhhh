import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLANTILLA_VERSION, PUNTOS_PENDIENTES, ESTADOS, TIPOS, TIPO_POR_DEFECTO, PRESTADOR,
  generarNumeroContrato, snapshotCliente, clausulas, clausulasPendientes,
  puedeEmitirse, hashContrato, tipoValido, TIPOS_DE, snapshotDe, PENDIENTE,
} from '../src/services/contrato.js';

const CLIENTE = {
  id: 'c1',
  rut: '76.123.456-7',
  nombre_empresa: 'ACME SpA',
  contacto_email: 'pagos@acme.cl',
  plan: 'piloto',
  estado_contrato: 'piloto',
  fecha_inicio: '2026-08-01',
  fecha_fin: '2027-07-31',
};

// ---------- número ----------

test('generarNumeroContrato tiene el formato CT-XXXXXX y no se repite', () => {
  const vistos = new Set();
  for (let i = 0; i < 200; i += 1) {
    const n = generarNumeroContrato();
    assert.match(n, /^CT-[0-9A-F]{6}$/);
    vistos.add(n);
  }
  // 200 sorteos sobre 16^6: una colisión sería anecdótica, pero varias
  // significarían que el generador no es aleatorio.
  assert.ok(vistos.size >= 199, `demasiadas colisiones: ${200 - vistos.size}`);
});

// ---------- snapshot ----------

test('snapshotCliente congela solo las condiciones del contrato', () => {
  const d = snapshotCliente(CLIENTE);
  assert.deepEqual(Object.keys(d).sort(), [
    'contacto_email', 'estado_contrato', 'fecha_fin', 'fecha_inicio', 'plan', 'razon_social', 'rut',
  ]);
  assert.equal(d.razon_social, 'ACME SpA');
  assert.equal(d.fecha_inicio, '2026-08-01');
  // El id del cliente NO entra: el contrato lo referencia por FK, y meterlo
  // en el snapshot lo haría parte del hash sin aportar nada al documento.
  assert.equal(d.id, undefined);
});

test('snapshotCliente normaliza fechas y tolera un cliente vacío', () => {
  assert.equal(snapshotCliente({ fecha_inicio: new Date('2026-08-01T12:00:00Z') }).fecha_inicio, '2026-08-01');
  assert.equal(snapshotCliente({ fecha_inicio: 'no es fecha' }).fecha_inicio, null);
  const vacio = snapshotCliente({});
  assert.equal(vacio.razon_social, '');
  assert.equal(vacio.plan, 'piloto');
});

// ---------- cláusulas ----------

test('las cláusulas son puras: mismas condiciones, mismo texto', () => {
  const a = clausulas(snapshotCliente(CLIENTE), 'mandante');
  const b = clausulas(snapshotCliente(CLIENTE), 'mandante');
  assert.deepEqual(a, b);
  assert.ok(a.length >= 10);
  assert.deepEqual(a.map((c) => c.n), a.map((_, i) => i + 1)); // numeración correlativa
});

test('las cláusulas nombran a la empresa y su vigencia real', () => {
  const texto = clausulas(snapshotCliente(CLIENTE), 'mandante').flatMap((c) => c.parrafos).join(' ');
  assert.ok(texto.includes('ACME SpA'));
  assert.ok(texto.includes('76.123.456-7'));
  assert.ok(texto.includes('2026-08-01') && texto.includes('2027-07-31'));
});

test('sin fechas, la vigencia no inventa un plazo', () => {
  const texto = clausulas(snapshotCliente({ nombre_empresa: 'X', rut: '1-9' }), 'mandante')
    .flatMap((c) => c.parrafos).join(' ');
  assert.ok(texto.includes(PENDIENTE), 'debe marcar la vigencia como pendiente, no inventarla');
});

// ---------- tipos del paquete ----------

test('los dos tipos del paquete apuntan a su documento de origen', () => {
  assert.equal(TIPOS.mandante.codigo, 'SICR3P-LEGAL-02');
  assert.equal(TIPOS.asesoria.codigo, 'SICR3P-LEGAL-05');
  assert.equal(TIPO_POR_DEFECTO, 'asesoria');
  assert.ok(tipoValido('mandante') && tipoValido('asesoria'));
  assert.equal(tipoValido('otro'), false);
});

test('cada tipo produce un cuerpo distinto', () => {
  const d = snapshotCliente(CLIENTE);
  const m = clausulas(d, 'mandante').map((c) => c.titulo);
  const a = clausulas(d, 'asesoria').map((c) => c.titulo);
  assert.notDeepEqual(m, a);
  assert.ok(m.includes('Proveedores y autorizaciones'));       // solo 02
  assert.ok(a.includes('No asesoría crediticia ni garantía')); // solo 05
});

test('un tipo desconocido es un error, no un contrato genérico', () => {
  assert.throws(() => clausulas(snapshotCliente(CLIENTE), 'inventado'), /desconocido/);
});

// ---------- prestador ----------

test('el prestador sale del certificado del SII, no del paquete', () => {
  assert.equal(PRESTADOR.rut, '65.279.032-1');
  assert.equal(PRESTADOR.tipo_entidad, 'Fundación');
  const texto = clausulas(snapshotCliente(CLIENTE)).flatMap((c) => c.parrafos).join(' ');
  assert.ok(texto.includes('65.279.032-1'));
  // La discrepancia con "SICR3P SpA" tiene que quedar impresa, no escondida.
  assert.ok(texto.includes('SICR3P SpA'), 'debe advertir la discrepancia de razón social');
});

test('la marca de campo pendiente usa un glifo que el PDF sabe imprimir', () => {
  // "●" (U+25CF) del .docx no existe en WinAnsi y Helvetica lo imprime como
  // basura; el contrato saldría con caracteres rotos donde van los vacíos.
  for (const ch of PENDIENTE) {
    assert.ok(ch.codePointAt(0) < 0x2023, `"${ch}" (U+${ch.codePointAt(0).toString(16)}) puede no existir en WinAnsi`);
  }
});

test('lo que no está decidido queda marcado con el [•] del paquete', () => {
  for (const tipo of ['mandante', 'asesoria']) {
    const pendientes = clausulasPendientes(snapshotCliente(CLIENTE), tipo);
    assert.ok(pendientes.length >= 2, `${tipo} debería tener cláusulas pendientes`);
    for (const c of pendientes) {
      assert.ok(
        c.parrafos.some((p) => p.includes(PENDIENTE) || p.includes('SICR3P SpA')),
        `la cláusula "${c.titulo}" de ${tipo} está marcada pendiente pero no muestra el vacío`
      );
    }
  }
});

test('ninguna cláusula promete certificación ni verificación acreditada', () => {
  for (const tipo of ['mandante', 'asesoria']) {
    const lista = clausulas(snapshotCliente(CLIENTE), tipo)
      // La cláusula de referencias cita el NOMBRE de leyes ("...servicios de
      // certificación de dicha firma"), que no es una promesa del servicio.
      .filter((c) => c.titulo !== 'Referencias normativas');

    assert.ok(!lista.flatMap((c) => c.parrafos).join(' ').toLowerCase().includes('huella'));

    for (const c of lista) {
      // El título es parte del contexto: bajo "Servicios excluidos" un ítem
      // como "verificación acreditada" ya está negado por su encabezado.
      const contexto = c.titulo.toLowerCase();
      for (const frase of c.parrafos.join(' ').toLowerCase().split(/\.\s+/)) {
        if (!/certificaci|acreditad|assurance/.test(frase)) continue;
        const negado = /\bno\b|nunca|\bni\b|excluid|\bsin\b/.test(`${contexto} ${frase}`);
        assert.ok(negado, `${tipo} · ${c.titulo}: afirmación sin negar → ${frase.trim()}`);
      }
    }
  }
});

test('el contrato no puede emitirse mientras la plantilla tenga vacíos', () => {
  assert.ok(PUNTOS_PENDIENTES.length > 0, 'si ya no hay pendientes, este test debe actualizarse');
  assert.equal(puedeEmitirse(), false);
  assert.ok(ESTADOS.includes('borrador'));
});

// ---------- hash ----------

test('hashContrato es determinista y no depende del orden de las claves', () => {
  const base = { numero: 'CT-ABC123', plantilla_version: PLANTILLA_VERSION, created_at: '2026-07-28T10:00:00Z' };
  const h1 = hashContrato({ ...base, datos: snapshotCliente(CLIENTE) });
  const h2 = hashContrato({ ...base, datos: { ...snapshotCliente(CLIENTE) } });
  const revuelto = Object.fromEntries(Object.entries(snapshotCliente(CLIENTE)).reverse());
  const h3 = hashContrato({ ...base, datos: revuelto });
  assert.equal(h1, h2);
  assert.equal(h1, h3);
  assert.match(h1, /^[0-9a-f]{64}$/);
});

test('hashContrato sella también el TEXTO de las cláusulas', () => {
  // Sin esto, editar una cláusula sin subir PLANTILLA_VERSION cambiaría el
  // contrato entregado dejando el sello intacto.
  const base = { numero: 'CT-ABC123', plantilla_version: PLANTILLA_VERSION, created_at: '2026-07-28T10:00:00Z', datos: snapshotCliente(CLIENTE) };
  assert.notEqual(
    hashContrato({ ...base, tipo: 'mandante' }),
    hashContrato({ ...base, tipo: 'asesoria' }),
    'dos contratos con texto distinto no pueden compartir sello'
  );
});

test('hashContrato cambia si cambia cualquier condición del contrato', () => {
  const base = { numero: 'CT-ABC123', plantilla_version: PLANTILLA_VERSION, created_at: '2026-07-28T10:00:00Z', datos: snapshotCliente(CLIENTE) };
  const original = hashContrato(base);
  const variantes = {
    numero: { ...base, numero: 'CT-ABC124' },
    plantilla: { ...base, plantilla_version: 'otra' },
    fecha: { ...base, created_at: '2026-07-28T10:00:01Z' },
    plan: { ...base, datos: snapshotCliente({ ...CLIENTE, plan: 'activo' }) },
    razon_social: { ...base, datos: snapshotCliente({ ...CLIENTE, nombre_empresa: 'ACME Spa' }) },
    vigencia: { ...base, datos: snapshotCliente({ ...CLIENTE, fecha_fin: '2027-08-01' }) },
  };
  for (const [campo, v] of Object.entries(variantes)) {
    assert.notEqual(hashContrato(v), original, `el hash ignora un cambio en ${campo}`);
  }
});

// ---------- contratos de auspicio (SICR3P-LEGAL-01 y 06) ----------

const AUSPICIADOR = {
  id: 'a1',
  rut: '97.000.000-1',
  nombre_empresa: 'Banco Ejemplo',
  contacto_email: 'auspicios@banco.cl',
  aporta_vehiculo: true,
  vehiculo: { marca: 'Toyota', modelo: 'Hilux', patente: 'ABCD12', anio: '2025' },
  fecha_inicio: '2026-09-01',
  fecha_fin: '2027-08-31',
};

test('los tipos de auspicio se firman con un auspiciador, no con un cliente', () => {
  assert.equal(TIPOS.auspicio.sujeto, 'auspiciador');
  assert.equal(TIPOS.comodato.sujeto, 'auspiciador');
  assert.equal(TIPOS.mandante.sujeto, 'cliente');
  assert.deepEqual(TIPOS_DE('auspiciador').sort(), ['auspicio', 'comodato']);
  assert.deepEqual(TIPOS_DE('cliente').sort(), ['asesoria', 'mandante']);
});

test('snapshotDe elige el snapshot correcto según el tipo', () => {
  const a = snapshotDe(AUSPICIADOR, 'auspicio');
  assert.equal(a.razon_social, 'Banco Ejemplo');
  assert.equal(a.vehiculo.patente, 'ABCD12');
  // Un tipo de cliente sobre la misma entidad no arrastra el vehículo.
  assert.equal(snapshotDe(AUSPICIADOR, 'asesoria').vehiculo, undefined);
});

test('el convenio nombra el vehículo aportado, y dice cuando no hay', () => {
  const con = clausulas(snapshotDe(AUSPICIADOR, 'auspicio'), 'auspicio').flatMap((c) => c.parrafos).join(' ');
  assert.ok(con.includes('Toyota') && con.includes('ABCD12'));
  const sin = clausulas(snapshotDe({ ...AUSPICIADOR, aporta_vehiculo: false }, 'auspicio'), 'auspicio')
    .flatMap((c) => c.parrafos).join(' ');
  assert.ok(sin.includes('no comprendido'));
});

test('en el comodato SICR3P es el Comodatario, no el Comodante', () => {
  // Escribirlo al revés cambiaría quién responde por el vehículo: el
  // Comodante es el auspiciador que lo entrega.
  const partes = clausulas(snapshotDe(AUSPICIADOR, 'comodato'), 'comodato')[0];
  assert.equal(partes.titulo, 'Partes');
  const texto = partes.parrafos.join(' ');
  assert.ok(texto.includes('"Comodatario"'), 'SICR3P debe figurar como Comodatario');
  assert.ok(texto.includes('"Comodante"'), 'el auspiciador debe figurar como Comodante');
});

test('el comodato exige los datos del vehículo que faltan', () => {
  const pend = clausulasPendientes(snapshotDe(AUSPICIADOR, 'comodato'), 'comodato');
  const titulos = pend.map((c) => c.titulo);
  assert.ok(titulos.includes('Vehículo'));      // VIN y kilometraje siguen [●]
  assert.ok(titulos.includes('Conductores'));   // sin conductores autorizados
  assert.ok(titulos.includes('Seguro y siniestros'));
});

test('el sello distingue dos auspiciadores con distinto vehículo', () => {
  const base = { numero: 'CT-ZZZ999', plantilla_version: PLANTILLA_VERSION, tipo: 'comodato', created_at: '2026-09-01T10:00:00Z' };
  const uno = hashContrato({ ...base, datos: snapshotDe(AUSPICIADOR, 'comodato') });
  const otro = hashContrato({ ...base, datos: snapshotDe({ ...AUSPICIADOR, vehiculo: { ...AUSPICIADOR.vehiculo, patente: 'WXYZ99' } }, 'comodato') });
  assert.notEqual(uno, otro);
});
