import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Icon } from '../components/icons.jsx';

// Catálogo de cursos de capacitación interna — compartido entre /admin y
// /panel-verde (el flag `av` decide el almacén de token; `basePath` decide
// a dónde apuntan los links, para que cada panel navegue dentro de sí mismo).
export default function CatalogoCursos({ av, basePath }) {
  const [cursos, setCursos] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.cursos(av).then((d) => setCursos(d.cursos)).catch((e) => setErr(e.message));
  }, [av]);

  if (err) return <div className="badge badge-red" style={{ padding: 14 }}>{err}</div>;

  return (
    <div>
      <div className="admin-head">
        <div>
          <h1 style={{ margin: 0 }}>Capacitación</h1>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 14 }}>
            Cursos internos para el personal de mostrador. Al aprobar la evaluación de un
            curso recibes una constancia de participación con QR verificable.
          </p>
        </div>
      </div>

      {!cursos && <p className="muted"><span className="spinner dark" /> Cargando…</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
        {(cursos || []).map((c) => (
          <Link key={c.id} to={`${basePath}/${c.slug}`} className="card card-pad" style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ color: 'var(--green-600)', display: 'inline-flex' }}><Icon.Book size={20} /></span>
              <b>{c.titulo}</b>
            </div>
            <p className="muted" style={{ fontSize: 13, margin: '0 0 10px' }}>{c.descripcion}</p>
            {c.mi_estado === 'aprobado'
              ? <span className="badge badge-green">✓ Aprobado</span>
              : c.mi_estado === 'en_curso'
                ? <span className="badge badge-amber">En curso</span>
                : <span className="badge badge-gray">Sin iniciar</span>}
          </Link>
        ))}
      </div>

      {cursos && cursos.length === 0 && <p className="muted">No hay cursos disponibles todavía.</p>}
    </div>
  );
}
