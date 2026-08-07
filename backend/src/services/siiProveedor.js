// ============================================================
// Selector del proveedor de datos del SII (RCV/DTE). Expone la MISMA
// superficie que baseapiSii (validarCredencialesSii / descargarComprasVentas)
// y despacha al adaptador activo según config.sii.proveedor. Así las rutas y
// el cálculo (analisisSiiProveedor.js) no saben ni les importa qué proveedor
// hay detrás.
//
// Los tests inyectan { fetcher, cfg } por opts; con cfg presente se respeta
// el proveedor pedido igual (el cfg simplemente reemplaza la configuración
// de red de ese adaptador).
// ============================================================
import { config } from '../config.js';
import * as baseapi from './baseapiSii.js';
import * as simpleapi from './siiSimpleapi.js';
import * as apigateway from './siiApigateway.js';

const ADAPTADORES = { simpleapi, apigateway };

function adaptador(nombre = config.sii?.proveedor) {
  return ADAPTADORES[String(nombre).toLowerCase()] || baseapi;
}

export function validarCredencialesSii(cred, opts = {}) {
  return adaptador(opts.proveedor).validarCredencialesSii(cred, opts);
}

export function descargarComprasVentas(args, opts = {}) {
  return adaptador(opts.proveedor).descargarComprasVentas(args, opts);
}
