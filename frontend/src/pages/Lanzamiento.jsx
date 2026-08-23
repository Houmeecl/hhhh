import { useEffect, useState } from 'react';
import Logo from '../components/Logo.jsx';
import LeadCta from '../components/LeadForm.jsx';
import {
  LANZAMIENTO, msHasta, desglose, dosDigitos, fechaLegible, horaLegible, desfaseConServidor,
} from '../lib/cuentaRegresiva.js';

// ============================================================
// Portada de cuenta regresiva. Se muestra hasta la hora del lanzamiento y
// después deja su lugar a la landing de siempre, sin desplegar nada: el
// cambio lo decide App.jsx comparando fechas.
//
// SOBRE LA ILUSTRACIÓN. Es la cadena de integridad: eslabones sellados,
// cada uno tomando el hash del anterior. No es un adorno ni una captura
// inventada del producto —las imágenes de producto son capturas reales o
// no son— sino el dibujo de lo único que sicr3p promete: que un registro
// no se puede cambiar sin que se note.
// ============================================================

// Un eslabón sellado. `i` mueve la fase para que la cadena respire.
function Eslabon({ x, y, r, i, activo }) {
  return (
    <g style={{ animation: `latido 4s ease-in-out ${i * 0.35}s infinite` }}>
      <circle cx={x} cy={y} r={r} fill="none" stroke={activo ? 'var(--green)' : '#334155'} strokeWidth="2" />
      <circle cx={x} cy={y} r={r * 0.28} fill={activo ? 'var(--green)' : '#334155'} />
    </g>
  );
}

function CadenaSellada() {
  // Los eslabones se cuelgan de una curva suave; el último queda abierto
  // porque la cadena de un lote nunca está "terminada": el próximo hito
  // todavía puede llegar.
  const puntos = [0, 1, 2, 3, 4, 5].map((i) => ({
    x: 40 + i * 62,
    y: 60 + Math.sin(i * 0.9) * 18,
  }));

  return (
    <svg
      viewBox="0 0 400 120"
      width="100%"
      style={{ maxWidth: 'min(420px, 88%)', height: 'auto', maxHeight: 'clamp(54px, 11vh, 120px)', display: 'block', margin: '0 auto' }}
      role="img"
      aria-label="Una cadena de eslabones sellados, cada uno enlazado al anterior"
    >
      <style>{`
        @keyframes latido { 0%,100% { opacity: .55 } 50% { opacity: 1 } }
        @media (prefers-reduced-motion: reduce) { svg g { animation: none !important } }
      `}</style>
      {puntos.slice(0, -1).map((p, i) => (
        <line
          key={`l${i}`}
          x1={p.x} y1={p.y}
          x2={puntos[i + 1].x} y2={puntos[i + 1].y}
          stroke="#334155" strokeWidth="2" strokeDasharray="4 5"
        />
      ))}
      {puntos.map((p, i) => (
        <Eslabon key={i} x={p.x} y={p.y} r={14} i={i} activo={i < puntos.length - 1} />
      ))}
    </svg>
  );
}

// Lo que hace el producto, en cuatro frases. Cada una es comprobable en
// código, y ninguna promete lo que todavía no existe.
//
// LO QUE SE DEJÓ FUERA A PROPÓSITO. El README del panel de aseguramiento
// también nombra estrés hídrico bajo TNFD, detección de greenwashing e
// integración con SICEP y The Copper Mark. Nada de eso está construido: no
// hay tabla, endpoint ni servicio que lo respalde. Una landing que lo
// anuncie es el mismo verde falso que este producto existe para no emitir,
// solo que apuntando al cliente en vez de al auditor.
const PUNTOS = [
  {
    titulo: 'Evidencia sellada, no declaraciones',
    texto: 'Cada archivo que entra al expediente queda con su SHA-256, su fecha y quién lo '
      + 'aportó. Si el archivo cambia, el sello deja de calzar y se ve cuál fue.',
  },
  {
    titulo: 'Tres áreas de práctica',
    texto: 'Aseguramiento de sostenibilidad, forense e investigaciones, y cumplimiento del '
      + 'Modelo de Prevención de Delitos de la Ley 21.595. El expediente se abre por área '
      + 'y por período fiscal.',
  },
  {
    titulo: 'Los datos no salen del equipo',
    texto: 'La base es un archivo local y el análisis de documentos corre con un modelo que '
      + 'se ejecuta en la misma máquina. La información financiera del proveedor no viaja '
      + 'a una nube pública.',
  },
  {
    titulo: 'Emisiones con Alcance 3',
    texto: 'Alcance 1, 2 y 3 con las 15 categorías del GHG Protocol, cada cifra enlazada al '
      + 'documento que la respalda. Lo que no se puede contrastar se muestra como '
      + 'pendiente, nunca en verde.',
  },
];

function Punto({ titulo, texto }) {
  return (
    <li style={{ margin: '0 0 18px', paddingLeft: 16, borderLeft: '2px solid #1e3a52' }}>
      <div style={{ color: '#fff', fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{titulo}</div>
      <div style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.55 }}>{texto}</div>
    </li>
  );
}

function Casilla({ valor, rotulo }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 0 }}>
      <div
        style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 'clamp(34px, 11vw, 64px)',
          fontWeight: 700, color: '#fff', lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {valor}
      </div>
      <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#94a3b8', marginTop: 8 }}>
        {rotulo}
      </div>
    </div>
  );
}

export default function Lanzamiento() {
  // `desfase` corrige el reloj del visitante con el del servidor. Arranca
  // en 0 y se ajusta en cuanto responde: la página nunca espera a la red
  // para pintar.
  const [desfase, setDesfase] = useState(0);
  const [restante, setRestante] = useState(() => msHasta(Date.now()));

  useEffect(() => {
    let vivo = true;
    desfaseConServidor().then((d) => { if (vivo) setDesfase(d); });
    return () => { vivo = false; };
  }, []);

  // El título de la pestaña mientras dura la cuenta regresiva: es lo que
  // se ve al compartir el enlace. Se restaura al desmontar para no dejarlo
  // pegado cuando la portada pase a ser la landing.
  useEffect(() => {
    const previo = document.title;
    document.title = 'sicr3p — Aseguramiento, forense y cumplimiento';
    return () => { document.title = previo; };
  }, []);

  useEffect(() => {
    const tic = () => setRestante(msHasta(Date.now() + desfase));
    tic();
    const timer = setInterval(tic, 1000);
    return () => clearInterval(timer);
  }, [desfase]);

  const { dias, horas, minutos, segundos } = desglose(restante);

  return (
    <main
      style={{
        minHeight: '100dvh',
        background: 'linear-gradient(170deg, var(--navy) 0%, #16293b 100%)',
        color: '#e2e8f0',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: 'clamp(24px, 5vh, 48px) 20px', textAlign: 'center',
      }}
    >
      <div style={{ width: '100%', maxWidth: 720 }}>
        <Logo size={44} light />

        <p
          style={{
            marginTop: 'clamp(18px, 3.5vh, 34px)', marginBottom: 10, fontSize: 11,
            letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--green)',
          }}
        >
          Aseguramiento independiente
        </p>

        <h1 style={{ fontSize: 'clamp(24px, 6vw, 42px)', margin: '0 0 12px', color: '#fff', lineHeight: 1.15 }}>
          La evidencia que su mandante va a pedirle
        </h1>

        <p style={{ margin: '0 auto clamp(20px, 4vh, 38px)', maxWidth: 520, color: '#94a3b8', fontSize: 'clamp(14px, 3.6vw, 16px)', lineHeight: 1.55 }}>
          Aseguramiento, contabilidad forense y cumplimiento para proveedores de la industria
          y la minería. Cada documento entra a un expediente y queda sellado con su hash: lo
          que se puede demostrar se demuestra, y lo que no, se dice.
        </p>

        <div
          style={{
            display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: 8, maxWidth: 480, margin: '0 auto clamp(20px, 4vh, 38px)',
          }}
        >
          <Casilla valor={dosDigitos(dias)} rotulo={dias === 1 ? 'día' : 'días'} />
          <Casilla valor={dosDigitos(horas)} rotulo="horas" />
          <Casilla valor={dosDigitos(minutos)} rotulo="min" />
          <Casilla valor={dosDigitos(segundos)} rotulo="seg" />
        </div>

        <CadenaSellada />

        <p style={{ marginTop: 'clamp(20px, 4vh, 34px)', color: '#cbd5e1', fontSize: 15 }}>
          Abrimos el <b style={{ color: '#fff' }}>{fechaLegible(LANZAMIENTO)}</b>
          {' '}a las <b style={{ color: '#fff' }}>{horaLegible(LANZAMIENTO)}</b>.
        </p>

        <ul
          style={{
            listStyle: 'none', padding: 0, textAlign: 'left',
            maxWidth: 560, margin: 'clamp(28px, 5vh, 48px) auto 0',
          }}
        >
          {PUNTOS.map((p) => <Punto key={p.titulo} {...p} />)}
        </ul>

        {/* Sin ingreso: hasta el lanzamiento la única acción es dejar el
            correo. Un enlace a /ingresar acá invitaría a probar puertas que
            todavía no queremos que se toquen. */}
        <div style={{ marginTop: 'clamp(22px, 4vh, 36px)' }}>
          <LeadCta
            origen="lanzamiento"
            etiqueta="Anótate en la lista"
            className="btn btn-primary"
          />
        </div>

        <p style={{ marginTop: 'clamp(24px, 4vh, 40px)', color: '#475569', fontSize: 12, lineHeight: 1.6 }}>
          Hora de Chile continental. sicr3p estructura y sella evidencia; no es autoridad,
          certificadora ni auditor acreditado, y no emite opinión de auditoría.
        </p>
      </div>
    </main>
  );
}
