import PanelLogin from '../components/PanelLogin.jsx';
import { authAv } from '../api.js';

// El canal presencial es **terreno**: el copy visible dice eso.
// `panel="aduana_verde"` NO es copy — es el valor que la base guarda en
// `usuarios.panel` (CHECK de la migración 027) y que el backend compara
// en /auth/login. Cambiarlo dejaría fuera a todas las cuentas ya creadas.
export default function LoginAv() {
  return (
    <PanelLogin
      panel="aduana_verde"
      authStore={authAv}
      redirect="/panel-verde"
      titulo="Acceso — Panel de terreno"
      subtitulo="Panel de terreno"
      placeholder="operador@sicrep.cl"
    />
  );
}
