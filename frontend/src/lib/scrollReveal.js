import { useEffect } from 'react';

// Aparición al hacer scroll (estilo landing moderna): los elementos con
// .av2-reveal entran cuando cruzan el viewport. Con prefers-reduced-motion
// el CSS los muestra fijos y este hook no molesta. Compartido entre
// Landing.jsx y CorredorLanding.jsx.
export function useScrollReveal() {
  useEffect(() => {
    if (!('IntersectionObserver' in window)) return undefined;
    const io = new IntersectionObserver(
      (entradas) => entradas.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('on'); io.unobserve(e.target); } }),
      { threshold: 0.15 }
    );
    document.querySelectorAll('.av2-reveal').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}
