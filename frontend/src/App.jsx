import { Routes, Route, Navigate } from 'react-router-dom';
import Landing from './pages/Landing.jsx';
import Cargar from './pages/Cargar.jsx';
import Resultado from './pages/Resultado.jsx';
import Verificar from './pages/Verificar.jsx';
import Ingresar from './pages/Ingresar.jsx';
import Prueba from './pages/Prueba.jsx';
import Acceso from './pages/Acceso.jsx';
import MisSesiones from './pages/MisSesiones.jsx';
import PosTerminal from './pages/PosTerminal.jsx';
import AduanaVerde from './pages/AduanaVerde.jsx';
import Cadena from './pages/Cadena.jsx';
import Login from './admin/Login.jsx';
import Activar from './admin/Activar.jsx';
import AdminApp from './admin/AdminApp.jsx';

export default function App() {
  return (
    <Routes>
      {/* Flujo público (sin login) */}
      <Route path="/" element={<Landing />} />
      <Route path="/cargar" element={<Cargar />} />
      <Route path="/resultado/:id" element={<Resultado />} />
      <Route path="/verificar/:id" element={<Verificar />} />
      <Route path="/ingresar" element={<Ingresar />} />
      <Route path="/prueba" element={<Prueba />} />
      <Route path="/acceso" element={<Acceso />} />
      <Route path="/mis-sesiones" element={<MisSesiones />} />
      <Route path="/pos" element={<PosTerminal />} />
      <Route path="/pos-demo" element={<Navigate to="/pos" replace />} />
      <Route path="/aduana-verde" element={<AduanaVerde />} />
      <Route path="/cadena" element={<Cadena />} />

      {/* Admin */}
      <Route path="/admin/login" element={<Login />} />
      <Route path="/admin/activar" element={<Activar />} />
      <Route path="/admin/*" element={<AdminApp />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
