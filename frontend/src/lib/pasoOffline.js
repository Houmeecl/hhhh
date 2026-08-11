// ============================================================
// Cola local de pasos pendientes de la Tarjeta de Viaje — el chofer
// puede escanear un punto de control sin señal (los pasos fronterizos
// del corredor son justo los lugares con peor conectividad). El
// escaneo del QR es 100% local (no necesita red); lo que sí necesita
// red es REGISTRAR el paso (POST /api/tarjeta/paso). Si esa llamada
// falla por conectividad, el paso queda guardado acá para no perderse,
// y TarjetaViaje.jsx lo reintenta apenas hay una autenticación fresca
// (evento 'online' con el token de la sesión en memoria, o el próximo
// login del portador).
//
// Deliberadamente NO se guarda la clave del portador acá — solo el
// paso detectado (punto/país/hora de captura). Sin clave no hay nada
// sensible que proteger en localStorage; el reenvío se hace con un
// token ya obtenido en memoria, nunca con uno persistido.
// ============================================================

function clave(serial) {
  return `sicr3p_tv_pendientes_${serial}`;
}

export function listarPendientes(serial) {
  try {
    const raw = localStorage.getItem(clave(serial));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function guardar(serial, lista) {
  try { localStorage.setItem(clave(serial), JSON.stringify(lista)); }
  catch { /* localStorage lleno o inaccesible: el paso se pierde, pero no rompe la app */ }
}

// Agrega un paso a la cola. `entrada` es el mismo body que se le manda a
// api.tarjetaPaso (punto_control, punto_id, pais, via_qr).
export function encolarPaso(serial, entrada) {
  const id = (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random()}`;
  const lista = listarPendientes(serial);
  lista.push({ id, capturado_en: new Date().toISOString(), ...entrada });
  guardar(serial, lista);
  return id;
}

export function quitarPendiente(serial, id) {
  guardar(serial, listarPendientes(serial).filter((p) => p.id !== id));
}

// fetch() que ni siquiera llega al servidor lanza un TypeError (mensaje
// varía por navegador: "Failed to fetch", "NetworkError...", "Load
// failed" en Safari) — es la señal de "sin conexión". Un error de
// credenciales o validación ya viene resuelto por el servidor como un
// Error con mensaje propio (ver request() en api.js), nunca un TypeError.
export function esErrorDeConexion(err) {
  return err instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(err?.message || '');
}
