import PanelLogin from '../components/PanelLogin.jsx';
import { auth } from '../api.js';

export default function Login() {
  return (
    <PanelLogin
      panel="sicrep"
      authStore={auth}
      redirect="/admin"
      titulo="Acceso — sicrep"
      placeholder="admin@sicrep.cl"
    />
  );
}
