import { Routes, Route } from 'react-router-dom';
import CatalogoCursos from '../capacitacion/CatalogoCursos.jsx';
import CursoDetalle from '../capacitacion/CursoDetalle.jsx';
import QuizCurso from '../capacitacion/QuizCurso.jsx';

// Envoltorio fino: mismo módulo compartido que admin/Capacitacion.jsx,
// solo cambia `av=true` (usa el token de authAv) y la base de rutas.
const BASE = '/panel-verde/capacitacion';

export default function CapacitacionAv() {
  return (
    <Routes>
      <Route index element={<CatalogoCursos av basePath={BASE} />} />
      <Route path=":slug" element={<CursoDetalle av basePath={BASE} />} />
      <Route path=":slug/quiz" element={<QuizCurso av basePath={BASE} />} />
    </Routes>
  );
}
