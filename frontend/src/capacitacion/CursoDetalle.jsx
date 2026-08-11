import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api.js';
import { Icon } from '../components/icons.jsx';

function fmtFecha(v) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('es-CL');
}

// Detalle de un curso: lecciones ordenadas, marcar como vista, y el botón
// para rendir la evaluación una vez completadas todas.
export default function CursoDetalle({ av, basePath }) {
  const { slug } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [marcando, setMarcando] = useState(null);
  const [inscribiendo, setInscribiendo] = useState(false);

  function cargar() {
    api.curso(slug, av).then(setData).catch((e) => setErr(e.message));
  }
  useEffect(cargar, [slug, av]); // eslint-disable-line react-hooks/exhaustive-deps

  async function inscribirse() {
    setInscribiendo(true);
    try { await api.inscribirCurso(slug, av); cargar(); }
    catch (e) { setErr(e.message); }
    finally { setInscribiendo(false); }
  }

  async function completar(leccionId) {
    setMarcando(leccionId);
    try { await api.completarLeccion(slug, leccionId, av); cargar(); }
    catch (e) { setErr(e.message); }
    finally { setMarcando(null); }
  }

  if (err) return <div className="badge badge-red" style={{ padding: 14 }}>{err}</div>;
  if (!data) return <p className="muted"><span className="spinner dark" /> Cargando…</p>;

  const { curso, lecciones, inscripcion, progreso } = data;
  const todasCompletas = lecciones.length > 0 && lecciones.every((l) => progreso.includes(l.id));
  const aprobado = inscripcion?.estado === 'aprobado';

  return (
    <div>
      <div className="admin-head">
        <div>
          <h1 style={{ margin: 0 }}>{curso.titulo}</h1>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 14 }}>{curso.descripcion}</p>
        </div>
        <Link to={basePath} className="btn btn-outline btn-sm">← Volver al catálogo</Link>
      </div>

      {err && <div className="badge badge-red" style={{ display: 'block', padding: '10px 14px', marginBottom: 14 }}>{err}</div>}

      {!inscripcion && (
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <p style={{ marginTop: 0 }}>Inscríbete para comenzar este curso.</p>
          <button className="btn btn-primary" onClick={inscribirse} disabled={inscribiendo}>
            {inscribiendo ? <span className="spinner" /> : 'Inscribirme'}
          </button>
        </div>
      )}

      {aprobado && (
        <div className="badge badge-green send-check-pop" style={{ display: 'block', padding: '10px 14px', marginBottom: 16 }}>
          ✓ Curso aprobado el {fmtFecha(inscripcion.completado_at)}
        </div>
      )}

      {inscripcion && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {lecciones.map((l, i) => {
            const hecha = progreso.includes(l.id);
            return (
              <div key={l.id} className="card card-pad">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span className={`badge ${hecha ? 'badge-green' : 'badge-gray'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {hecha ? <Icon.Check size={13} /> : i + 1}
                  </span>
                  <b>{l.titulo}</b>
                </div>
                <p style={{ fontSize: 14, lineHeight: 1.6, margin: '0 0 10px' }}>{l.contenido}</p>
                {!hecha && !aprobado && (
                  <button className="btn btn-outline btn-sm" onClick={() => completar(l.id)} disabled={marcando === l.id}>
                    {marcando === l.id ? <span className="spinner dark" /> : 'Marcar como vista'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {inscripcion && !aprobado && (
        <div className="card card-pad" style={{ marginTop: 16, textAlign: 'center' }}>
          {todasCompletas
            ? <button className="btn btn-primary" onClick={() => nav(`${basePath}/${slug}/quiz`)}>Rendir evaluación</button>
            : <p className="muted" style={{ margin: 0 }}>Completa todas las lecciones para habilitar la evaluación.</p>}
        </div>
      )}
    </div>
  );
}
