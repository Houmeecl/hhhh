import { Routes, Route } from 'react-router-dom';
import CatalogoCursos from '../capacitacion/CatalogoCursos.jsx';
import CursoDetalle from '../capacitacion/CursoDetalle.jsx';
import QuizCurso from '../capacitacion/QuizCurso.jsx';

// Envoltorio fino: la capacitación es transversal a los dos paneles (ver
// backend/src/routes/capacitacion.js), así que la UI vive una sola vez en
// frontend/src/capacitacion/ — este archivo solo fija `av=false` y las
// rutas propias del panel núcleo.
const BASE = '/admin/capacitacion';

export default function Capacitacion() {
  return (
    <Routes>
      <Route index element={<CatalogoCursos av={false} basePath={BASE} />} />
      <Route path=":slug" element={<CursoDetalle av={false} basePath={BASE} />} />
      <Route path=":slug/quiz" element={<QuizCurso av={false} basePath={BASE} />} />
    </Routes>
  );
}
