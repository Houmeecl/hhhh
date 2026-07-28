import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Landing from './pages/Landing.jsx';
import Cargar from './pages/Cargar.jsx';
import Resultado from './pages/Resultado.jsx';
import Verificar from './pages/Verificar.jsx';
import Pasaporte from './pages/Pasaporte.jsx';
import PasaporteLote from './pages/PasaporteLote.jsx';
import TarjetaViaje from './pages/TarjetaViaje.jsx';
import FirmaProveedor from './pages/FirmaProveedor.jsx';
import Ingresar from './pages/Ingresar.jsx';
import Prueba from './pages/Prueba.jsx';
import Acceso from './pages/Acceso.jsx';
import MisSesiones from './pages/MisSesiones.jsx';
import AduanaVerde from './pages/AduanaVerde.jsx';
import CorredorLanding from './pages/CorredorLanding.jsx';
import SolicitarAuspicio from './pages/SolicitarAuspicio.jsx';
import MisDatos from './pages/MisDatos.jsx';
import Cadena from './pages/Cadena.jsx';
import ConstanciaPublica from './pages/ConstanciaPublica.jsx';
import Login from './admin/Login.jsx';
import ActivarCuenta from './components/ActivarCuenta.jsx';
import LoginAv from './admin-av/LoginAv.jsx';
import LoginPuerto from './panel-puerto/LoginPuerto.jsx';
import LoginMandante from './panel-mandante/LoginMandante.jsx';
import LoginAgencia from './panel-agencia/LoginAgencia.jsx';

// Code-splitting: los paneles admin son la mitad del bundle y solo los
// usan operadores logueados — se cargan bajo demanda para que las
// páginas públicas (pasaportes, verificación) abran rápido en el
// teléfono de un tercero que escanea un QR.
const AdminApp = lazy(() => import('./admin/AdminApp.jsx'));
const AdminAvApp = lazy(() => import('./admin-av/AdminAvApp.jsx'));
const PuertoApp = lazy(() => import('./panel-puerto/PuertoApp.jsx'));
const MandanteApp = lazy(() => import('./panel-mandante/MandanteApp.jsx'));
const AgenciaApp = lazy(() => import('./panel-agencia/AgenciaApp.jsx'));
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
      <Route path="/f/:serial" element={<FirmaProveedor />} />
      <Route path="/torre" element={<TorreFlota />} />
      <Route path="/torre/:codigo" element={<Torre />} />
      <Route path="/ingresar" element={<Ingresar />} />
      <Route path="/prueba" element={<Prueba />} />
      <Route path="/acceso" element={<Acceso />} />
      <Route path="/mis-sesiones" element={<MisSesiones />} />
      <Route path="/aduana-verde" element={<AduanaVerde />} />
      <Route path="/corredor" element={<CorredorLanding />} />
      <Route path="/auspicio" element={<SolicitarAuspicio />} />
      {/* Ejercicio de derechos ARCOP sin cuenta: el titular se identifica
          por RUT o correo (Ley 21.719). */}
      <Route path="/mis-datos" element={<MisDatos />} />
      <Route path="/cadena" element={<Cadena />} />
      <Route path="/constancia/:serial" element={<ConstanciaPublica />} />

      {/* Admin — panel sicrep (núcleo/plataforma) */}
      <Route path="/admin/login" element={<Login />} />
      <Route path="/admin/activar" element={<ActivarCuenta loginPath="/admin/login" />} />
      <Route path="/admin/*" element={<AdminApp />} />

      {/* Panel del mostrador presencial — compensación, tarifa y REP, cuentas propias */}
      <Route path="/panel-verde/login" element={<LoginAv />} />
      <Route path="/panel-verde/activar" element={<ActivarCuenta loginPath="/panel-verde/login" titulo="el panel del mostrador presencial" />} />
      <Route path="/panel-verde/*" element={<AdminAvApp />} />

      {/* Panel de Puerto — lectura completa de tránsitos por su propio punto del Corredor */}
      <Route path="/panel-puerto/login" element={<LoginPuerto />} />
      <Route path="/panel-puerto/activar" element={<ActivarCuenta loginPath="/panel-puerto/login" titulo="el panel de Puerto" />} />
      <Route path="/panel-puerto/*" element={<PuertoApp />} />

      {/* Panel de Mandante — trazabilidad y CO2e de sus proveedores */}
      <Route path="/panel-mandante/login" element={<LoginMandante />} />
      <Route path="/panel-mandante/activar" element={<ActivarCuenta loginPath="/panel-mandante/login" titulo="el panel de Mandante" />} />
      <Route path="/panel-mandante/*" element={<MandanteApp />} />

      {/* Panel de Agencia de Aduana — expedientes del Corredor + captura de documentos (tablet/PC) */}
      <Route path="/panel-agencia/login" element={<LoginAgencia />} />
      <Route path="/panel-agencia/activar" element={<ActivarCuenta loginPath="/panel-agencia/login" titulo="el panel de Agencia" />} />
      <Route path="/panel-agencia/*" element={<AgenciaApp />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}
