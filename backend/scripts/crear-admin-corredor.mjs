#!/usr/bin/env node
// ============================================================
// Crea el PRIMER administrador del Corredor Bioceánico.
//
// POR QUÉ EXISTE. El Corredor vive en su propia base, con sus propios
// usuarios: `usuarios_corredor` no tiene ninguna relación con `usuarios`
// de sicr3p, y el `node src/seed.js` de la instalación no la toca. Sin
// esto, una base del Corredor recién creada no tiene por dónde entrar:
// crear exportadores exige un admin, y crear el admin exigía… un admin.
//
// Uso (desde backend/, con backend/.env ya configurado):
//   node scripts/crear-admin-corredor.mjs correo@dominio.cl "Nombre Apellido"
//
// La clave temporal se imprime UNA vez y no queda en ninguna bitácora.
// Nace con must_reset_password = true: el middleware
// `requireClaveDefinida` no deja operar con ella, así que una clave
// dictada por teléfono no puede quedar funcionando indefinidamente.
//
// Es idempotente en lo que importa: si el correo ya existe NO se
// sobrescribe la cuenta ni se rota su clave. Para eso está el flujo de
// reset, que deja rastro; un script de instalación que le cambia la clave
// a un usuario existente es una forma silenciosa de tomarle la cuenta.
// ============================================================

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { config } from '../src/config.js';
import { queryCorredor, corredorDisponible, cerrarCorredor } from '../src/lib/dbCorredor.js';

const [email, nombre = 'Administrador del Corredor'] = process.argv.slice(2);

function salir(mensaje, codigo = 1) {
  console.error(mensaje);
  process.exit(codigo);
}

if (!email) {
  salir('Uso: node scripts/crear-admin-corredor.mjs correo@dominio.cl "Nombre Apellido"');
}
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  salir(`"${email}" no parece un correo válido.`);
}
if (!corredorDisponible()) {
  salir('El Corredor no está configurado: falta DATABASE_URL_CORREDOR en backend/.env.\n'
    + 'Corre primero: bash deploy/encender-corredor.sh');
}

// Mismo alfabeto que usa el alta de exportadores en routes/corredorApi.js:
// sin 0/O ni 1/l/I, porque esta clave se dicta por teléfono cuando el
// correo no llega.
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const bytes = crypto.randomBytes(14);
let temporal = '';
for (let i = 0; i < 14; i += 1) temporal += ALFABETO[bytes[i] % ALFABETO.length];

try {
  const { rows: existe } = await queryCorredor(
    'SELECT id, rol, estado FROM usuarios_corredor WHERE lower(email) = lower($1)', [email]
  );
  if (existe[0]) {
    console.log(`==> Ya existe una cuenta con ${email} (rol ${existe[0].rol}, ${existe[0].estado}).`);
    console.log('    No se toca su clave: para rotarla, usa el flujo de reset, que deja rastro.');
    await cerrarCorredor();
    process.exit(0);
  }

  const hash = await bcrypt.hash(temporal, config.bcryptRounds);
  const { rows } = await queryCorredor(
    `INSERT INTO usuarios_corredor (email, nombre, password_hash, rol, must_reset_password)
     VALUES ($1, $2, $3, 'admin', true)
     RETURNING id, email, nombre, rol`,
    [email, nombre, hash]
  );

  console.log('============================================================');
  console.log(' Administrador del Corredor creado');
  console.log('============================================================');
  console.log(`  Correo:          ${rows[0].email}`);
  console.log(`  Nombre:          ${rows[0].nombre}`);
  console.log(`  Clave temporal:  ${temporal}`);
  console.log('');
  console.log('  Se muestra UNA sola vez y no queda en ninguna bitácora.');
  console.log('  Al entrar hay que definir una clave propia: con la temporal');
  console.log('  no se puede operar.');
  console.log('============================================================');
} catch (err) {
  salir(`No se pudo crear el administrador: ${err.message}`);
} finally {
  await cerrarCorredor().catch(() => {});
}
