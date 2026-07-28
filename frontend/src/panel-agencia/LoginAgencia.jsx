import PanelLogin from '../components/PanelLogin.jsx';
import { authAgencia } from '../api.js';

// La agencia sigue realizando la tramitación oficial; sicr3p es su
// infraestructura documental y de trazabilidad — nunca se presenta como
// agencia de aduanas. Eso queda dicho en la descripción.
export default function LoginAgencia() {
  return (
    <PanelLogin
      panel="agencia"
      authStore={authAgencia}
      redirect="/panel-agencia"
      titulo="Acceso — Agencia"
      subtitulo="Panel de Agencia de Aduana"
      descripcion="Consulta y captura los documentos de los expedientes de tu agencia en el Corredor Bioceánico. sicr3p es la infraestructura documental y de trazabilidad; la tramitación oficial la realiza tu agencia."
      placeholder="operador@agencia.cl"
    />
  );
}
