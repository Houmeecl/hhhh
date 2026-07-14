import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { pool, query } from './lib/db.js';
import { runMigrations } from './lib/migrate.js';

// Genera una contraseña segura y legible (sin caracteres ambiguos).
function generatePassword(len = 18) {
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const nums = '23456789';
  const sym = '!@#$%&*?';
  const all = alpha + nums + sym;
  const pick = (set) => set[crypto.randomInt(set.length)];
  let pwd = pick(alpha) + pick(nums) + pick(sym);
  for (let i = pwd.length; i < len; i++) pwd += pick(all);
  // mezcla
  return pwd.split('').sort(() => crypto.randomInt(3) - 1).join('');
}

async function seed() {
  await runMigrations();

  const email = config.admin.email.toLowerCase();
  const password = config.admin.password || generatePassword();
  const hash = await bcrypt.hash(password, config.bcryptRounds);

  const { rows } = await query(`SELECT id FROM usuarios WHERE email = $1`, [email]);
  if (rows[0]) {
    // Actualiza la contraseña del admin existente.
    await query(
      `UPDATE usuarios SET password_hash = $1, rol = 'admin', estado = 'activo', must_reset_password = false WHERE email = $2`,
      [hash, email]
    );
    console.log(`\n[seed] Usuario admin actualizado.`);
  } else {
    await query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol, estado, must_reset_password)
       VALUES ($1,$2,'Administrador sicr3p','admin','activo',false)`,
      [email, hash]
    );
    console.log(`\n[seed] Usuario admin creado.`);
  }

  // Datos demo para el panel (clientes, prospectos) — solo si están vacíos.
  const { rows: cCount } = await query(`SELECT count(*)::int AS n FROM clientes`);
  if (cCount[0].n === 0) {
    await query(
      `INSERT INTO clientes (rut, nombre_empresa, contacto_email, estado_contrato, fecha_inicio, fecha_fin, plan) VALUES
       ('76.123.456-0','Minera del Norte SpA','contacto@mineranorte.cl','activo', CURRENT_DATE - INTERVAL '60 days', CURRENT_DATE + INTERVAL '20 days','pro'),
       ('77.987.654-3','Áridos Antofagasta Ltda','ops@aridosantof.cl','piloto', CURRENT_DATE - INTERVAL '10 days', CURRENT_DATE + INTERVAL '80 days','piloto'),
       ('78.222.333-K','Transportes Atacama SA','gerencia@transatacama.cl','vencido', CURRENT_DATE - INTERVAL '400 days', CURRENT_DATE - INTERVAL '35 days','pro')`
    );
    await query(
      `INSERT INTO prospectos (nombre_empresa, rut, contacto, etapa, origen, notas, proxima_accion) VALUES
       ('Cobre Andino SpA','79.111.222-2','jefe.sustentabilidad@cobreandino.cl','demo','referido','Interesados en trazabilidad de facturas', CURRENT_DATE + INTERVAL '3 days'),
       ('Logística Pampa Ltda','80.444.555-2','contacto@logpampa.cl','contactado','web','Pidieron propuesta piloto', CURRENT_DATE + INTERVAL '7 days')`
    );
    console.log('[seed] Datos demo (clientes y prospectos) insertados.');
  }

  // Metodología por país del Corredor Bioceánico (editable por admin).
  const { rows: mCount } = await query(`SELECT count(*)::int AS n FROM metodologias_pais`);
  if (mCount[0].n === 0) {
    // Chile: factor real HuellaChile (SEN 2023). Resto: borrador a validar por admin.
    await query(
      `INSERT INTO metodologias_pais (pais, nombre, factores, referencia, fuente, vigencia, activo, notas) VALUES
       ('CL','Chile — HuellaChile', $1, 'GHG Protocol Scope 3 · ISO 14064-1', 'HuellaChile (MMA) — SEN 2023', '2023', true,  'Electricidad SEN 2023: 0,2421 kgCO2e/kWh.'),
       ('AR','Argentina',          $2, 'GHG Protocol Scope 3',                'Borrador — validar (SEsco/AR)',   '2023', false, 'Factores borrador. Validar fuente oficial antes de activar.'),
       ('PY','Paraguay',           $3, 'GHG Protocol Scope 3',                'Borrador — validar',              '2023', false, 'Matriz muy hídrica; factor eléctrico bajo. Validar.'),
       ('BR','Brasil',             $4, 'GHG Protocol Scope 3',                'Borrador — validar (SIRENE/BR)',  '2023', false, 'Factores borrador. Validar fuente oficial antes de activar.')`,
      [
        JSON.stringify({ electricidad_kgco2e_kwh: 0.2421, diesel_kgco2e_l: 2.68 }),
        JSON.stringify({ electricidad_kgco2e_kwh: 0.35, diesel_kgco2e_l: 2.68 }),
        JSON.stringify({ electricidad_kgco2e_kwh: 0.05, diesel_kgco2e_l: 2.68 }),
        JSON.stringify({ electricidad_kgco2e_kwh: 0.10, diesel_kgco2e_l: 2.68 }),
      ]
    );
    console.log('[seed] Metodologías por país del corredor insertadas (CL activo; AR/PY/BR borrador).');
  }

  // Plan de cuentas de Capital Natural (SEEA simplificado).
  const { rows: cnCount } = await query(`SELECT count(*)::int AS n FROM cuentas_naturales`);
  if (cnCount[0].n === 0) {
    await query(
      `INSERT INTO cuentas_naturales (codigo, nombre, unidad, tipo, activo, factores, marco, fuente, notas) VALUES
       ('AGUA','Agua','m3','flujo', true,  $1,'SEEA Marco Central (ONU)','Factor referencial agua potable — editable','Consumo hídrico derivado de documentos.'),
       ('ENER','Energía','kWh','flujo', true, $2,'SEEA Marco Central (ONU)','HuellaChile — SEN 2023','Energía eléctrica estimada desde facturas.'),
       ('CO2E','Carbono','tCO2e','flujo', true, '{}'::jsonb,'GHG Protocol · ISO 14064-1','HuellaChile (MMA)','Cuenta espejo del Libro Mayor de Carbono.'),
       ('MATR','Materiales y residuos','t','flujo', true, $3,'SEEA / Ley REP','Factor genérico de insumos — editable','Conecta con trazabilidad Ley REP.'),
       ('SUEL','Suelo y ecosistemas','ha','stock', false, '{}'::jsonb,'SEEA Cuentas de Ecosistemas','—','Solo activos (stock); sin flujo automático en v1.'),
       ('BIOD','Biodiversidad','índice','stock', false, '{}'::jsonb,'TNFD / SEEA EA','—','Índice de condición 0–100 por activo; sin flujo automático en v1.')`,
      [
        JSON.stringify({ agua_kgco2e_m3: 0.344 }),
        JSON.stringify({ electricidad_kgco2e_kwh: 0.2421 }),
        JSON.stringify({ materiales_kgco2e_kg: 1.5 }),
      ]
    );
    console.log('[seed] Plan de cuentas de Capital Natural insertado (AGUA/ENER/CO2E/MATR activas).');
  }

  console.log('\n============================================================');
  console.log('  CREDENCIALES ADMIN sicr3p');
  console.log('============================================================');
  console.log(`  Email:      ${email}`);
  console.log(`  Contraseña: ${password}`);
  console.log('============================================================\n');

  await pool.end();
  return { email, password };
}

seed().catch((err) => {
  console.error('[seed] error:', err);
  process.exit(1);
});
