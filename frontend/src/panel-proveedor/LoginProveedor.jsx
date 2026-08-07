import PanelLogin from '../components/PanelLogin.jsx';
import { authProveedor } from '../api.js';

// Este panel lo usan hoy dos perfiles distintos que comparten la misma fila
// de `proveedores`: la empresa que se enroló para su contabilidad de carbono
// (entra con correo y contraseña, viene del enlace de invitación) y el
// proveedor de un lote que firma con llave USB FIDO2. La descripción tiene
// que servirle a los dos: si solo habla de firmar lotes, la empresa recién
// enrolada llega a una pantalla que no le habla a ella. `conLlave` deja las
// dos vías disponibles — ver components/PanelLogin.jsx.
export default function LoginProveedor() {
  return (
    <PanelLogin
      panel="proveedor"
      authStore={authProveedor}
      redirect="/panel-proveedor"
      titulo="Acceso — Empresa"
      subtitulo="Panel de la empresa"
      descripcion="Entra con el correo con que te enrolamos para ver tu contabilidad de carbono, conectar el SII y mantener los datos de tu empresa. Si además firmas lotes, puedes ingresar con tu llave USB."
      placeholder="contacto@empresa.cl"
      conLlave
    />
  );
}
