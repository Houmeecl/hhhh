import PanelLogin from '../components/PanelLogin.jsx';
import { authMandante } from '../api.js';

export default function LoginMandante() {
  return (
    <PanelLogin
      panel="mandante"
      authStore={authMandante}
      redirect="/panel-mandante"
      titulo="Acceso — Mandante"
      subtitulo="Panel de Mandante"
      descripcion="Consulta la trazabilidad y el CO2e que tus proveedores te han emitido."
      placeholder="contacto@empresa.cl"
    />
  );
}
