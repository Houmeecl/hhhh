// Genera el PDF de muestra (datos de ejemplo) para el correo de confirmación
// de la lista de espera del landing de pre-lanzamiento.
// Uso: cd backend && node scripts/generar-muestra-informe.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateReport } from '../src/services/pdf.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEST = path.resolve(__dirname, '../../prelanzamiento-empresas/public/muestra-informe.pdf');

const sesion = {
  id: 'muestra-00000000-0000-0000-0000-000000000000',
  nombre_cliente: 'Empresa Ejemplo SpA',
  rut_cliente: '76.123.456-0',
  fecha: new Date('2026-06-30'),
  total_co2e: 18.4235,
};
const facturas = [
  {
    numero_venta: 'V-100234', fecha: new Date('2026-06-05'), categoria: 'Energía eléctrica', total_co2e: 7.8210,
    items: [
      { descripcion: 'Suministro eléctrico SEN', cantidad: 3200, co2e: 5.1240, porcentaje_total: 65.5 },
      { descripcion: 'Consumo kWh planta', cantidad: 1680, co2e: 2.6970, porcentaje_total: 34.5 },
    ],
  },
  {
    numero_venta: 'V-100235', fecha: new Date('2026-06-14'), categoria: 'Combustibles', total_co2e: 6.5310,
    items: [
      { descripcion: 'Diésel B5 flota', cantidad: 45.2, co2e: 4.9820, porcentaje_total: 76.3 },
      { descripcion: 'Gas licuado GLP', cantidad: 12.0, co2e: 1.5490, porcentaje_total: 23.7 },
    ],
  },
  {
    numero_venta: 'V-100236', fecha: new Date('2026-06-22'), categoria: 'Transporte y logística', total_co2e: 4.0715,
    items: [
      { descripcion: 'Flete regional', cantidad: 8, co2e: 2.4020, porcentaje_total: 59.0 },
      { descripcion: 'Distribución última milla', cantidad: 22, co2e: 1.6695, porcentaje_total: 41.0 },
    ],
  },
];

const pdf = await generateReport({ sesion, facturas });
fs.writeFileSync(DEST, pdf);
console.log(`[muestra] generado: ${DEST} (${pdf.length} bytes)`);
