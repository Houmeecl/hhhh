import PanelLogin from '../components/PanelLogin.jsx';
import { authProveedor } from '../api.js';

// El proveedor entra sin contraseña con su llave USB FIDO2 (registrada
// antes por un admin) — la contraseña temporal solo sirve la primera vez,
// antes de registrar la llave. Ver components/PanelLogin.jsx (prop
// conLlave) y el plan "Proveedor como entidad persistente con login FIDO2".
export default function LoginProveedor() {
  return (
    <PanelLogin
      panel="proveedor"
      authStore={authProveedor}
      redirect="/panel-proveedor"
      titulo="Acceso — Proveedor"
      subtitulo="Panel de Proveedor"
      descripcion="Firma acá los lotes que sicr3p te asignó, con tu llave USB. Es una atestación sellada por hash sobre tu identidad ya registrada — no reemplaza ninguna firma electrónica con validez legal."
      placeholder="contacto@proveedor.cl"
      conLlave
    />
  );
}
