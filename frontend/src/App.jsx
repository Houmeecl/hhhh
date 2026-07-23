import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Landing from './pages/Landing.jsx';
import Cargar from './pages/Cargar.jsx';
import Resultado from './pages/Resultado.jsx';
import Verificar from './pages/Verificar.jsx';
import Pasaporte from './pages/Pasaporte.jsx';
import PasaporteLote from './pages/PasaporteLote.jsx';
import TarjetaViaje from './pages/TarjetaViaje.jsx';
import Ingresar from './pages/Ingresar.jsx';
import Prueba from './pages/Prueba.jsx';
import Acceso from './pages/Acceso.jsx';
import MisSesiones from './pages/MisSesiones.jsx';
import AduanaVerde from './pages/AduanaVerde.jsx';
import CorredorLanding from './pages/CorredorLanding.jsx';
import Cadena from './pages/Cadena.jsx';
import Login from './admin/Login.jsx';
import Activar from './admin/Activar.jsx';
import LoginAv from './admin-av/LoginAv.jsx';

// Code-splitting: el panel admin y el terminal POS son la mitad del
// bundle y solo los usan operadores logueados — se cargan bajo demanda
// para que las páginas públicas (pasaportes, verificación) abran rápido
// en el teléfono de un tercero que escanea un QR.
const AdminApp = lazy(() => import('./admin/AdminApp.jsx'));
const AdminAvApp = lazy(() => import('./admin-av/AdminAvApp.jsx'));
const PosTerminal = lazy(() => import('./pages/PosTerminal.jsx'));
// La torre de control carga Leaflet (mapa): chunk aparte por lo mismo.
const Torre = lazy(() => import('./pages/Torre.jsx'));
const TorreFlota = lazy(() => import('./pages/TorreFlota.jsx'));

const CargandoModulo = () => (
  <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
    <span className="spinner" />
  </div>
);

export default function App() {
  return (
    <Suspense fallback={<CargandoModulo />}>
    <Routes>
      {/* Flujo público (sin login) */}
      <Route path="/" element={<Landing />} />
      <Route path="/cargar" element={<Cargar />} />
      <Route path="/resultado/:id" element={<Resultado />} />
      <Route path="/verificar/:id" element={<Verificar />} />
      <Route path="/pasaporte/:id" element={<Pasaporte />} />
      <Route path="/lote/:codigo" element={<PasaporteLote />} />
      <Route path="/v/:serial" element={<TarjetaViaje />} />
      <Route path="/torre" element={<TorreFlota />} />
      <Route path="/torre/:codigo" element={<Torre />} />
      <Route path="/ingresar" element={<Ingresar />} />
      <Route path="/prueba" element={<Prueba />} />
      <Route path="/acceso" element={<Acceso />} />
      <Route path="/mis-sesiones" element={<MisSesiones />} />
      <Route path="/pos" element={<PosTerminal />} />
      <Route path="/pos-demo" element={<Navigate to="/pos" replace />} />
      <Route path="/aduana-verde" element={<AduanaVerde />} />
      <Route path="/corredor" element={<CorredorLanding />} />
      <Route path="/cadena" element={<Cadena />} />

      {/* Admin — panel sicrep (núcleo/plataforma) */}
      <Route path="/admin/login" element={<Login />} />
      <Route path="/admin/activar" element={<Activar />} />
      <Route path="/admin/*" element={<AdminApp />} />

      {/* Panel Aduana Verde — compensación, tarifa y REP, cuentas propias */}
      <Route path="/panel-verde/login" element={<LoginAv />} />
      <Route path="/panel-verde/*" element={<AdminAvApp />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}
