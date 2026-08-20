import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// ============================================================
// Las fuentes oficiales que sicr3p cita, y si están verificadas.
//
// EL PROBLEMA QUE RESUELVE. El 20-08-2026 una revisión normativa produjo
// veinte hallazgos sobre el EUDR, CBAM y los documentos por frontera. Ni
// una sola cita pudo contrastarse contra el texto oficial: el egreso de
// red bloquea eur-lex.europa.eu y los sitios de los organismos. Las
// conclusiones salieron de fuentes secundarias y quedaron marcadas como
// no verificadas —en un informe que nadie vuelve a abrir.
//
// Este módulo mueve ese hecho de un informe a un estado del sistema. Lo
// que antes era una nota al pie ahora es un valor que se puede consultar,
// imprimir y romper el build.
//
// LA REGLA. No verificado NO bloquea: bloquea DECLARARSE verificado sin
// poder demostrarlo. Es la misma doctrina del resto del producto — el
// nivel de confianza lo calcula el servidor leyendo la evidencia, no lo
// declara quien la aporta; el nivel 5 no se emite nunca. Acá igual: el
// estado sale de comparar el hash del archivo, no de lo que diga el JSON.
// ============================================================

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, '..', '..', '..', 'docs', 'official');
const MANIFIESTO = path.join(RAIZ, 'manifest.json');

// El estado que el manual del proyecto nombra para el caso en que la
// fuente oficial requerida no está o su hash no calza. Se exporta con ese
// nombre a propósito: es vocabulario compartido con el documento.
export const INCOMPLETE_OFFICIAL_SOURCE = 'INCOMPLETE_OFFICIAL_SOURCE';

export const ESTADOS = ['verificada', 'pendiente'];
const CAMPOS = ['id', 'pais', 'autoridad', 'titulo', 'sourceUrl', 'estado'];

export function leerManifiesto(ruta = MANIFIESTO) {
  const crudo = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  return (crudo.fuentes || []).map((f) => ({ ...f }));
}

const sha256De = (ruta) => crypto.createHash('sha256').update(fs.readFileSync(ruta)).digest('hex');

// El estado REAL de una fuente, calculado del disco y no del JSON.
//
// Devuelve `{ estado, problema }`. `estado` es uno de:
//   'verificada'  archivo presente y hash calzado
//   'pendiente'   declarada, sin archivo, y el manifiesto lo dice
//   'rota'        cualquier desacuerdo entre lo declarado y lo que hay
//
// 'rota' es el único fatal, y cubre los dos casos que importan: un
// archivo que cambió bajo nuestros pies (alguien reemplazó el PDF) y una
// fuente que se declara verificada sin tener con qué.
export function estadoRealDe(fuente, raiz = RAIZ) {
  const faltan = CAMPOS.filter((c) => !fuente?.[c]);
  if (faltan.length) {
    return { estado: 'rota', problema: `le faltan campos obligatorios: ${faltan.join(', ')}` };
  }
  if (!ESTADOS.includes(fuente.estado)) {
    return { estado: 'rota', problema: `estado desconocido "${fuente.estado}"` };
  }

  if (fuente.estado === 'pendiente') {
    if (fuente.archivo) {
      return { estado: 'rota', problema: 'dice estar pendiente pero declara un archivo. Si el archivo está, séllala.' };
    }
    if (!fuente.motivo) {
      return { estado: 'rota', problema: 'está pendiente sin decir por qué. "Todavía no" sin motivo es una excusa.' };
    }
    return { estado: 'pendiente', problema: null };
  }

  // estado declarado 'verificada': hay que poder demostrarlo.
  if (!fuente.archivo || !fuente.sha256) {
    return { estado: 'rota', problema: 'se declara verificada sin archivo ni sha256. Eso es justo lo que no se hace acá.' };
  }
  const ruta = path.join(raiz, fuente.pais, fuente.archivo);
  if (!fs.existsSync(ruta)) {
    return { estado: 'rota', problema: `se declara verificada y el archivo no está en ${path.relative(raiz, ruta)}` };
  }
  const real = sha256De(ruta);
  if (real !== fuente.sha256) {
    return {
      estado: 'rota',
      problema: `el archivo cambió: el manifiesto dice ${fuente.sha256.slice(0, 12)}… y el archivo es ${real.slice(0, 12)}…`,
    };
  }
  return { estado: 'verificada', problema: null };
}

// El estado del conjunto. `ok` es false SOLO si hay alguna rota.
export function revisarFuentes(ruta = MANIFIESTO, raiz = RAIZ) {
  const fuentes = leerManifiesto(ruta).map((f) => ({ ...f, ...estadoRealDe(f, raiz) }));
  const rotas = fuentes.filter((f) => f.estado === 'rota');
  const pendientes = fuentes.filter((f) => f.estado === 'pendiente');
  const verificadas = fuentes.filter((f) => f.estado === 'verificada');
  return {
    ok: rotas.length === 0,
    // El código que el manual nombra para este caso. Que haya pendientes
    // no es un error: es el estado honesto de un expediente a medio armar.
    codigo: rotas.length ? INCOMPLETE_OFFICIAL_SOURCE : null,
    fuentes, rotas, pendientes, verificadas,
    total: fuentes.length,
  };
}

// ¿Se puede afirmar que una cita está respaldada por su fuente oficial?
// Lo usa el PDF para no imprimir "según el Reglamento (UE) 2023/1115"
// como si lo hubiéramos leído.
export function fuenteVerificada(id, ruta = MANIFIESTO, raiz = RAIZ) {
  const f = leerManifiesto(ruta).find((x) => x.id === id);
  if (!f) return false;
  return estadoRealDe(f, raiz).estado === 'verificada';
}
