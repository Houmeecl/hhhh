import PanelLogin from '../components/PanelLogin.jsx';
import { authTrazador } from '../api.js';

export default function LoginTrazador() {
  return (
    <PanelLogin
      panel="trazador"
      authStore={authTrazador}
      redirect="/panel-trazador"
      titulo="Acceso — Trazador"
      subtitulo="Panel de Trazador"
      descripcion="Consulta la trazabilidad de los RUT que tienes autorizados."
      placeholder="contacto@empresa.cl"
    />
  );
}
