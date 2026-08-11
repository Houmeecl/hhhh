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

// Si el proveedor de datos activo PUEDE traer la glosa real de los ítems.
//
// Existe para que la interfaz no ofrezca lo que este despliegue no puede
// cumplir. El botón "Clasificar N documentos" vuelve a descargar el período
// con la idea de que esta vez llegue el detalle; con simpleapi o apigateway
// eso no puede pasar nunca —fabrican UN ítem sintético cuya glosa es la razón
// social de la contraparte— así que el contador bajaba a cero, el alcance GHG
// seguía sin existir, y el usuario quedaba creyendo que lo había arreglado.
//
// `puede`, no `trae`: con baseapi el reintento PUEDE cambiar el resultado
// (depende de si el emisor publicó el XML), que es justo lo que hace honesto
// ofrecer el botón.
//
// Devuelve SOLO la capacidad, sin el nombre del proveedor: esto viaja al
// navegador de la empresa dentro del análisis del período, y con qué tercero
// consultamos el SII es asunto nuestro, no información que el cliente
// necesite. Nadie lo consumía.
export function proveedorSiiActivo(opts = {}) {
  return { puede_traer_detalle: adaptador(opts.proveedor).PUEDE_TRAER_DETALLE === true };
}
