import PanelLogin from '../components/PanelLogin.jsx';
import { auth } from '../api.js';

// Se entra a /admin/paneles, no directo a /admin: ahí se elige a qué panel
// ir (admin/SelectorPanel.jsx). Para un admin normal esa pantalla no tiene
// nada que ofrecer y rebota sola al dashboard, así que no le agrega un paso.
export default function Login() {
  return (
    <PanelLogin
      panel="sicrep"
      authStore={auth}
      redirect="/admin/paneles"
      titulo="Acceso — sicrep"
      placeholder="admin@sicrep.cl"
    />
  );
}
