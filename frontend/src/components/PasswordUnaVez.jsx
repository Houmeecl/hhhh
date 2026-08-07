import { useState } from 'react';

// El backend ya no manda correo de activación (no es confiable): la
// contraseña temporal viaja una sola vez en este response y nunca vuelve
// a estar disponible — quien crea la cuenta debe copiarla ahora y
// entregarla a la persona por un canal seguro, fuera de este sistema.
export default function PasswordUnaVez({
  password,
  mensaje = 'Cuenta creada. Copia esta contraseña temporal ahora — no volverá a mostrarse. '
    + 'Entrégasela a la persona de forma segura (no por este mismo sistema). '
    + 'Deberá cambiarla en su primer inicio de sesión.',
}) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(password);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Algunos navegadores bloquean el portapapeles fuera de HTTPS/foco;
      // la persona igual puede seleccionar el texto a mano.
    }
  }

  return (
    <>
      <div className="badge badge-green" style={{ display: 'block', padding: 12, marginBottom: 10 }}>
        {mensaje}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ flex: 1, fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all', background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
          {password}
        </div>
        <button type="button" className="btn btn-outline btn-sm" onClick={copiar}>{copiado ? 'Copiado' : 'Copiar'}</button>
      </div>
    </>
  );
}
