import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Landing from './pages/Landing.jsx';
import Programa from './pages/Programa.jsx';
import Lanzamiento from './pages/Lanzamiento.jsx';
import { yaLanzo } from './lib/cuentaRegresiva.js';
import Cargar from './pages/Cargar.jsx';
import Resultado from './pages/Resultado.jsx';
import Verificar from './pages/Verificar.jsx';
import Pasaporte from './pages/Pasaporte.jsx';
import PasaporteLote from './pages/PasaporteLote.jsx';
import PuntoControl from './pages/PuntoControl.jsx';
import FirmaProveedor from './pages/FirmaProveedor.jsx';
import AccesoUnico from './pages/AccesoUnico.jsx';
import Prueba from './pages/Prueba.jsx';
import Pagar from './pages/Pagar.jsx';
import DescargarSuma from './pages/DescargarSuma.jsx';
import Acceso from './pages/Acceso.jsx';
import MisSesiones from './pages/MisSesiones.jsx';
import CorredorLanding from './pages/CorredorLanding.jsx';
import InstitutoLanding from './pages/InstitutoLanding.jsx';
import Inscripcion from './pages/Inscripcion.jsx';
import SolicitarAuspicio from './pages/SolicitarAuspicio.jsx';
import MisDatos from './pages/MisDatos.jsx';
import Cadena from './pages/Cadena.jsx';
import ConstanciaPublica from './pages/ConstanciaPublica.jsx';
import LoginSuma from './juego/Login.jsx';
import ConstanciaPublicaSuma from './juego/ConstanciaPublica.jsx';
import Login from './admin/Login.jsx';
import ActivarCuenta from './components/ActivarCuenta.jsx';
import EntrarComoSuperadmin from './components/EntrarComoSuperadmin.jsx';
import LoginAv from './admin-av/LoginAv.jsx';
import LoginPuerto from './panel-puerto/LoginPuerto.jsx';
import LoginMandante from './panel-mandante/LoginMandante.jsx';
import LoginAgencia from './panel-agencia/LoginAgencia.jsx';
import LoginTrazador from './panel-trazador/LoginTrazador.jsx';
import LoginProveedor from './panel-proveedor/LoginProveedor.jsx';
import LoginCorredor from './panel-corredor/LoginCorredor.jsx';

// Code-splitting: los paneles admin son la mitad del bundle y solo los
// usan operadores logueados — se cargan bajo demanda para que las
// páginas públicas (pasaportes, verificación) abran rápido en el
// teléfono de un tercero que escanea un QR.
const AdminApp = lazy(() => import('./admin/AdminApp.jsx'));
const AdminAvApp = lazy(() => import('./admin-av/AdminAvApp.jsx'));
const PuertoApp = lazy(() => import('./panel-puerto/PuertoApp.jsx'));
const MandanteApp = lazy(() => import('./panel-mandante/MandanteApp.jsx'));
const AgenciaApp = lazy(() => import('./panel-agencia/AgenciaApp.jsx'));
const TrazadorApp = lazy(() => import('./panel-trazador/TrazadorApp.jsx'));
const ProveedorApp = lazy(() => import('./panel-proveedor/ProveedorApp.jsx'));
const CorredorApp = lazy(() => import('./panel-corredor/CorredorApp.jsx'));
// La torre de control carga Leaflet (mapa): chunk aparte por lo mismo.
const Torre = lazy(() => import('./pages/Torre.jsx'));
const TorreFlota = lazy(() => import('./pages/TorreFlota.jsx'));
// La Tarjeta de Viaje carga jsQR (escaneo de punto de control): chunk
// aparte para no pesarle el bundle a las páginas públicas de mayor
// tráfico (portador de tarjeta es un flujo operativo, no de visitantes).
const TarjetaViaje = lazy(() => import('./pages/TarjetaViaje.jsx'));
const JuegoApp = lazy(() => import('./juego/JuegoApp.jsx'));

const CargandoModulo = () => (
  <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
    <span className="spinner" />
  </div>
);

// El mismo bundle sirve también el subdominio del Instituto
// (instituto.sicrep.cl / instituto.sicr3p.cl, ver deploy/INSTITUTO-SUBDOMINIO.md):
// bajo ese host la raíz muestra la landing del Instituto en vez de la
// portada general. Todas las demás rutas siguen operativas en ambos hosts.
const ES_SUBDOMINIO_INSTITUTO = window.location.hostname.startsWith('instituto.');
// corredor.sicr3p.cl aterriza en la landing del Corredor, igual que
// instituto.sicr3p.cl en la suya. El Corredor es otro producto: otra
// base, otro login, otra marca.
const ES_SUBDOMINIO_CORREDOR = window.location.hostname.startsWith('corredor.');

// Hasta la hora del lanzamiento la portada de sicr3p.cl es la cuenta
// regresiva; después es la landing de siempre. El cambio NO necesita un
// despliegue: lo decide `yaLanzo()` comparando fechas, y esa función tiene
// tests propios porque es lo único que separa "se ve la cuenta regresiva"
// de "se ve el sitio".
//
// Se evalúa acá, al cargar el módulo, y no en cada render: una pestaña que
// quedó abierta desde antes no cambia sola de portada a mitad de lectura.
// Quien recargue después de las 16:00 entra al sitio.
//
// Los subdominios del Instituto y del Corredor NO se tapan: son otros
// productos, con su propio calendario.
//
// `?ver=landing` salta la cuenta regresiva. Es para revisar la portada
// real antes de la hora sin bajar la página, no un secreto: quien la
// descubra ve la landing, que igual va a ser pública en unas horas.
const VER_LANDING = new URLSearchParams(window.location.search).get('ver') === 'landing';
const EN_CUENTA_REGRESIVA = !VER_LANDING && !yaLanzo(Date.now());

export default function App() {
  return (
    <Suspense fallback={<CargandoModulo />}>
    <Routes>
      {/* Flujo público (sin login) */}
      {/* La portada es el Programa Norte 2026-2030. La landing de producto
          NO se borró: vive en /plataforma y sigue enlazada desde el
          programa y desde el menú. Los subdominios y la cuenta regresiva
          mandan por sobre esto, en ese orden. */}
      <Route path="/" element={ES_SUBDOMINIO_INSTITUTO ? <InstitutoLanding /> : ES_SUBDOMINIO_CORREDOR ? <CorredorLanding /> : EN_CUENTA_REGRESIVA ? <Lanzamiento /> : <Programa />} />
      <Route path="/plataforma" element={<Landing />} />
      <Route path="/cargar" element={<Cargar />} />
      <Route path="/resultado/:id" element={<Resultado />} />
      <Route path="/verificar/:id" element={<Verificar />} />
      <Route path="/pasaporte/:id" element={<Pasaporte />} />
      <Route path="/lote/:codigo" element={<PasaporteLote />} />
      <Route path="/v/:serial" element={<TarjetaViaje />} />
      <Route path="/pc/:puntoId" element={<PuntoControl />} />
      <Route path="/f/:serial" element={<FirmaProveedor />} />
      <Route path="/torre" element={<TorreFlota />} />
      <Route path="/torre/:codigo" element={<Torre />} />
      {/* Acceso único del sitio: paneles (detección automática) + clientes
          (magic link). /panel/ingresar queda como redirect: está enlazado
          desde builds ya desplegados y posibles marcadores. */}
      <Route path="/ingresar" element={<AccesoUnico />} />
      <Route path="/panel/ingresar" element={<Navigate to="/ingresar" replace />} />
      <Route path="/prueba" element={<Prueba />} />
      {/* Link de pago del correo comercial. Las tres rutas comparten
          componente: /listo es el retorno desde la pasarela (espera la
          confirmación del webhook) y /baja ejerce la oposición a recibir
          más correos — un GET, para que baste un clic desde el correo. */}
      <Route path="/pagar/:token" element={<Pagar />} />
      <Route path="/pagar/:token/listo" element={<Pagar modo="listo" />} />
      <Route path="/pagar/:token/baja" element={<Pagar modo="baja" />} />
      <Route path="/acceso" element={<Acceso />} />
      <Route path="/mis-sesiones" element={<MisSesiones />} />
      {/* /aduana-verde era una segunda landing del canal presencial, con sus
          propios header y footer y los mismos destinos que la portada. Su
          contenido útil vive ahora en "/". La ruta se conserva como
          redirección porque el enlace ya salió repartido en material impreso
          y en versiones anteriores del sitio. */}
      <Route path="/aduana-verde" element={<Navigate to="/" replace />} />
      <Route path="/corredor" element={<CorredorLanding />} />
      <Route path="/instituto" element={<InstitutoLanding />} />
      <Route path="/inscripcion" element={<Inscripcion />} />
      <Route path="/auspicio" element={<SolicitarAuspicio />} />
      {/* Ejercicio de derechos ARCOP sin cuenta: el titular se identifica
          por RUT o correo (Ley 21.719). */}
      <Route path="/mis-datos" element={<MisDatos />} />
      <Route path="/cadena" element={<Cadena />} />
      <Route path="/constancia/:serial" element={<ConstanciaPublica />} />
      <Route path="/suma/constancia/:serial" element={<ConstanciaPublicaSuma />} />

      {/* Puente de la vista de superadmin: guarda el token de vista en el
          almacén del panel elegido y redirige a su raíz (ver
          EntrarComoSuperadmin.jsx). */}
      <Route path="/impersonar/:panel" element={<EntrarComoSuperadmin />} />

      {/* Admin — panel sicrep (núcleo/plataforma) */}
      <Route path="/admin/login" element={<Login />} />
      <Route path="/admin/activar" element={<ActivarCuenta loginPath="/admin/login" />} />
      <Route path="/admin/*" element={<AdminApp />} />

      {/* Panel de terreno — compensación, tarifa y REP, cuentas propias */}
      <Route path="/panel-verde/login" element={<LoginAv />} />
      <Route path="/panel-verde/activar" element={<ActivarCuenta loginPath="/panel-verde/login" titulo="el panel de terreno" />} />
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

      {/* Panel de Trazador — cruces de los RUT que tiene autorizados por whitelist */}
      <Route path="/panel-trazador/login" element={<LoginTrazador />} />
      <Route path="/panel-trazador/activar" element={<ActivarCuenta loginPath="/panel-trazador/login" titulo="el panel de Trazador" />} />
      <Route path="/panel-trazador/*" element={<TrazadorApp />} />

      {/* Panel de Proveedor — entidad persistente con login FIDO2; firma
          los lotes tipo 'producto' que le asignó el admin desde Origen.jsx */}
      <Route path="/panel-proveedor/login" element={<LoginProveedor />} />
      <Route path="/panel-proveedor/activar" element={<ActivarCuenta loginPath="/panel-proveedor/login" titulo="el panel de Proveedor" />} />
      <Route path="/panel-proveedor/*" element={<ProveedorApp />} />

      {/* Corredor Bioceánico — panel del exportador. Sin ruta de
          /activar: su backend entrega clave temporal y obliga a cambiarla
          al entrar, no manda enlace de activación. */}
      <Route path="/panel-corredor/login" element={<LoginCorredor />} />
      <Route path="/panel-corredor/*" element={<CorredorApp />} />

      {/* "Sube y Suma" — escaneo gamificado con código de campaña de una
          empresa cliente. Sin /activar: el jugador entra por magic link,
          nunca con contraseña. */}
      {/* Va ANTES del comodín /suma/*, que exige sesión: esta es la
          página pública que se manda por WhatsApp. Vive bajo /suma y no
          en /descargar porque el manifiesto declara scope "/suma" — fuera
          de ese ámbito el navegador no ofrece instalar nada. */}
      <Route path="/suma/descargar" element={<DescargarSuma />} />
      <Route path="/descargar" element={<Navigate to="/suma/descargar" replace />} />
      <Route path="/suma/login" element={<LoginSuma />} />
      <Route path="/suma/*" element={<JuegoApp />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}
