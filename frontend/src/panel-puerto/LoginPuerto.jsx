import PanelLogin from '../components/PanelLogin.jsx';
import { authPuerto } from '../api.js';

export default function LoginPuerto() {
  return (
    <PanelLogin
      panel="puerto"
      authStore={authPuerto}
      redirect="/panel-puerto"
      titulo="Acceso — Puerto"
      subtitulo="Panel de Puerto"
      descripcion="Consulta los tránsitos del Corredor Bioceánico que pasan por tu propio punto."
      placeholder="operador@puerto.cl"
    />
  );
}
