import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api.js';
import { Icon } from '../components/icons.jsx';

// Evaluación de opción múltiple. Envía todas las respuestas juntas — el
// servidor califica y, si aprueba (≥70%), devuelve la constancia recién
// emitida (o la ya existente, si el operador vuelve a rendir aprobado).
export default function QuizCurso({ av, basePath }) {
  const { slug } = useParams();
  const [preguntas, setPreguntas] = useState(null);
  const [respuestas, setRespuestas] = useState({});
  const [resultado, setResultado] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [err, setErr] = useState('');

  function cargar() {
    setResultado(null);
    setRespuestas({});
    setErr('');
    api.quizCurso(slug, av).then((d) => setPreguntas(d.preguntas)).catch((e) => setErr(e.message));
  }
  useEffect(cargar, [slug, av]); // eslint-disable-line react-hooks/exhaustive-deps

  function elegir(preguntaId, opcionId) {
    setRespuestas((r) => ({ ...r, [preguntaId]: opcionId }));
  }

  async function enviar() {
    setEnviando(true);
    setErr('');
    try {
      const body = Object.entries(respuestas).map(([pregunta_id, opcion_id]) => ({ pregunta_id, opcion_id }));
      const r = await api.responderQuiz(slug, body, av);
      setResultado(r);
    } catch (e) { setErr(e.message); }
    finally { setEnviando(false); }
  }

  if (err && !preguntas) return <div className="badge badge-red" style={{ padding: 14 }}>{err}</div>;
  if (!preguntas) return <p className="muted"><span className="spinner dark" /> Cargando…</p>;

  if (resultado) {
    return (
      <div className="card card-pad" style={{ textAlign: 'center', maxWidth: 480, margin: '0 auto' }}>
        <div style={{ color: resultado.aprobado ? 'var(--green-600)' : '#b91c1c', display: 'flex', justifyContent: 'center' }} className="send-check-pop">
          <Icon.CheckCircle size={40} />
        </div>
        <h2>{resultado.aprobado ? '¡Aprobado!' : 'No aprobado todavía'}</h2>
        <p>{resultado.n_correctas} de {resultado.n_preguntas} correctas ({resultado.puntaje_pct}%)</p>
        {resultado.aprobado && resultado.constancia ? (
          <a className="btn btn-primary" href={api.constanciaUrl(resultado.constancia.serial)} target="_blank" rel="noreferrer">
            <Icon.Download size={16} /> Descargar constancia
          </a>
        ) : (
          <button className="btn btn-primary" onClick={cargar}>Reintentar</button>
        )}
        <div style={{ marginTop: 14 }}>
          <Link to={`${basePath}/${slug}`} className="btn btn-outline btn-sm">← Volver al curso</Link>
        </div>
      </div>
    );
  }

  const faltan = preguntas.length - Object.keys(respuestas).length;

  return (
    <div>
      <div className="admin-head"><h1>Evaluación</h1></div>
      {preguntas.map((p, i) => (
        <div key={p.id} className="card card-pad" style={{ marginBottom: 12 }}>
          <b>{i + 1}. {p.enunciado}</b>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            {p.opciones.map((o) => (
              <label key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}>
                <input type="radio" name={p.id} checked={respuestas[p.id] === o.id} onChange={() => elegir(p.id, o.id)} />
                {o.texto}
              </label>
            ))}
          </div>
        </div>
      ))}
      {err && <div className="badge badge-red" style={{ display: 'block', padding: '10px 14px', marginBottom: 12 }}>{err}</div>}
      <button className="btn btn-primary" onClick={enviar} disabled={enviando || faltan > 0}>
        {enviando ? <span className="spinner" /> : faltan > 0 ? `Responde las ${faltan} preguntas restantes` : 'Enviar respuestas'}
      </button>
    </div>
  );
}
