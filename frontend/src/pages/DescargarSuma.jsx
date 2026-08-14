import { Link } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout.jsx';
import BotonInstalar from '../components/BotonInstalar.jsx';
import { Icon } from '../components/icons.jsx';
import { useManifestSuma } from '../components/useManifest.js';

// ============================================================
// /descargar — la página que se manda por WhatsApp.
//
// POR QUÉ EXISTE. "Sube y Suma" ya estaba construida, era instalable y
// tenía su botón… y no había NINGÚN enlace hacia ella en todo el sitio
// público. Se llegaba solo con un magic link de campaña. Para alguien de
// afuera el juego, sencillamente, no existía.
//
// Esta página es la dirección corta que se pega en un mensaje. No pide
// código ni correo: explica qué es, deja instalarla, y recién entonces
// manda a pedir el acceso. El orden importa — pedir credenciales antes de
// contar de qué se trata es donde se pierde a la gente.
//
// SOBRE LA PALABRA "DESCARGAR". Una PWA no se baja de una tienda: se
// abre y se agrega a la pantalla de inicio. Pero "descargar" es lo que la
// persona escribe y busca, así que la ruta lo usa y el texto explica la
// diferencia sin hacer un problema de ella.
// ============================================================

const PASOS = [
  {
    icono: Icon.Qr,
    titulo: 'Escanea lo que ya botas',
    texto: 'Una foto a la boleta o al envase. La app lee el documento y calcula sus emisiones sola.',
  },
  {
    icono: Icon.Target,
    titulo: 'Suma puntos por hacerlo bien',
    texto: 'Cada carga y cada visita a un punto limpio suma. Hay misiones e insignias por cumplir.',
  },
  {
    icono: Icon.CheckCircle,
    titulo: 'Tu constancia queda sellada',
    texto: 'Lo que registras entra a una cadena verificable: cualquiera puede comprobarlo después.',
  },
];

export default function DescargarSuma() {
  // El manifiesto del juego, no el del sitio: es lo que decide QUÉ se
  // instala cuando la persona toca el botón.
  useManifestSuma();

  return (
    <PublicLayout>
      <div className="container" style={{ maxWidth: 720, padding: '40px 16px 72px' }}>

        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <img
            src="/icons/icono-suma-192.png"
            alt=""
            width="88"
            height="88"
            style={{ borderRadius: 20, boxShadow: '0 8px 24px -10px rgba(15,31,46,.35)' }}
          />
          <h1 style={{ fontSize: 30, margin: '18px 0 6px' }}>Sube y Suma</h1>
          <p className="muted" style={{ fontSize: 16, maxWidth: 440, margin: '0 auto' }}>
            El juego de escanear lo que botas y ver cuánto pesa de verdad.
          </p>

          <BotonInstalar
            nombre="Sube y Suma"
            className="btn btn-primary"
            style={{ marginTop: 24 }}
          />

          <p className="muted" style={{ fontSize: 13, marginTop: 14 }}>
            Se instala desde el navegador, sin pasar por ninguna tienda. Pesa menos de 1 MB.
          </p>
        </div>

        <div className="card card-pad" style={{ marginBottom: 24 }}>
          {PASOS.map((p, i) => (
            <div
              key={p.titulo}
              style={{
                display: 'flex', gap: 14, alignItems: 'flex-start',
                paddingTop: i ? 18 : 0, marginTop: i ? 18 : 0,
                borderTop: i ? '1px solid var(--border)' : 'none',
              }}
            >
              <div style={{ flexShrink: 0, marginTop: 2 }}><p.icono size={22} /></div>
              <div style={{ minWidth: 0 }}>
                <b>{p.titulo}</b>
                <div className="muted" style={{ fontSize: 14, marginTop: 2 }}>{p.texto}</div>
              </div>
            </div>
          ))}
        </div>

        {/* El acceso va DESPUÉS de explicar, no antes. Y se dice de frente
            que hace falta un código: descubrirlo recién en el formulario,
            después de haber instalado, es la peor manera de enterarse. */}
        <div className="card card-pad" style={{ marginBottom: 24 }}>
          <b>Para entrar necesitas un código de invitación</b>
          <p className="muted" style={{ fontSize: 14, margin: '6px 0 14px' }}>
            Lo entrega la empresa que organiza la campaña. Con él y tu correo entras sin
            contraseña — te llega un enlace y listo.
          </p>
          <Link to="/suma/login" className="btn btn-outline">Ya tengo mi código</Link>
        </div>

        <p className="muted" style={{ fontSize: 13, textAlign: 'center' }}>
          ¿Quieres esta campaña en tu empresa?{' '}
          <Link to="/inscripcion">Inscríbela acá</Link>.
        </p>
      </div>
    </PublicLayout>
  );
}
