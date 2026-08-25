import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout.jsx';
import LeadCta from '../components/LeadForm.jsx';
import { api } from '../api.js';
import { useIdioma } from '../lib/i18n.js';

// ============================================================
// Portada del Programa SICR3P Norte 2026-2030.
//
// EL ORDEN QUE ESTA PÁGINA RESPETA. Primero se construye el MODELO de
// auditoría; la auditoría sostenible como servicio viene después. Por eso
// todo está en futuro o en presente continuo —"estamos formando", "a
// diciembre queremos mostrar"— y no hay una sola frase que ofrezca un
// servicio disponible hoy. Convocar a construir algo y vender ese algo son
// dos páginas distintas, y esta es la primera.
//
// LA REGLA DE LAS SECCIONES VACÍAS. Participantes, eventos y tienda se
// OCULTAN cuando no hay nada que mostrar, en vez de aparecer vacías. Una
// grilla titulada "Quiénes acompañan" sin nadie adentro dice algo peor que
// el silencio: dice que nadie quiso.
// ============================================================

// Las 12 etapas de la metodología. Van acá y no en la base porque son el
// método, no datos: cambian cuando cambia la metodología, y eso pasa en un
// commit revisado, no en un formulario del panel.
const ETAPAS = [
  ['Alcance', 'Contrato, activo, período, usuarios del informe y criterios.'],
  ['Ingreso', 'Documentos tributarios, ERP, contratos, órdenes, kilómetros, horas y consumos.'],
  ['Validación', 'Fuente, estructura, emisor, folio, fecha, sello y duplicidad.'],
  ['Conciliación', 'Cruzar documento contra ERP, contrato, activo, período y operación.'],
  ['Integridad', 'Faltantes, notas de crédito, cortes, duplicados y poblaciones omitidas.'],
  ['Línea base', 'Consumo, costo, intensidad, disponibilidad y mantenimiento.'],
  ['Forense', 'Anomalías, contradicciones, reutilización de documentos y excepciones.'],
  ['Cálculo', 'Separar dato de origen, dato derivado y conclusión; documentar fórmula y factor.'],
  ['Evidencia', 'Suficiencia, adecuación, cobertura y limitaciones.'],
  ['Revisión', 'Revisión profesional y de calidad independiente.'],
  ['Informe', 'Resultado, hallazgos, limitaciones y anexo de trazabilidad.'],
  ['Seguimiento', 'Repetición periódica para comparar desempeño y crear historial.'],
];

// El respaldo normativo, con su fuente. Cada enlace va al organismo, no a
// una nota de prensa nuestra: quien quiera comprobarlo llega al original.
const PORQUE = [
  ['prog.porque_1_t', 'prog.porque_1_d', 'https://www.cmfchile.cl/portal/prensa/625/w4-article-112141.html'],
  ['prog.porque_2_t', 'prog.porque_2_d', 'https://www.iaasb.org/focus-areas/understanding-international-standard-sustainability-assurance-5000'],
  ['prog.porque_3_t', 'prog.porque_3_d', 'https://www.bcn.cl/leychile/navegar?idNorma=1008668'],
  ['prog.porque_4_t', 'prog.porque_4_d', null],
];

function Etapa({ n, titulo, texto }) {
  return (
    <li style={{ display: 'flex', gap: 14, marginBottom: 14, listStyle: 'none' }}>
      <span
        aria-hidden
        style={{
          flex: '0 0 30px', height: 30, borderRadius: '50%',
          background: 'var(--navy)', color: '#fff',
          display: 'grid', placeItems: 'center',
          fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
        }}
      >
        {n}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>{titulo}</div>
        <div className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>{texto}</div>
      </div>
    </li>
  );
}

function Hito({ titulo, texto }) {
  return (
    <div style={{ borderLeft: '3px solid var(--green)', paddingLeft: 16 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{titulo}</div>
      <div className="muted" style={{ fontSize: 14, lineHeight: 1.55 }}>{texto}</div>
    </div>
  );
}

export default function Programa() {
  const { t } = useIdioma();
  const [participantes, setParticipantes] = useState([]);
  const [eventos, setEventos] = useState([]);
  const [cupos, setCupos] = useState(null);

  // Las tres listas fallan en silencio a propósito: si el backend no
  // responde, la portada se muestra igual con sus secciones ocultas. Una
  // página de convocatoria que queda en blanco porque falló una consulta
  // es peor que una a la que le falta un bloque.
  useEffect(() => {
    api.programaParticipantes().then((r) => setParticipantes(r.participantes || [])).catch(() => {});
    api.programaEventos().then((r) => setEventos(r.eventos || [])).catch(() => {});
    api.programaCupos('auditoria-sostenible').then(setCupos).catch(() => {});
  }, []);

  const fecha = (iso) => new Date(iso).toLocaleDateString('es-CL', {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  });

  return (
    <PublicLayout>
      <div className="av2-hero">
        <div className="container">
          <div className="fade-up" style={{ maxWidth: 760 }}>
            <span className="av2-eyebrow"><span className="av-led" /> {t('prog.eyebrow')}</span>
            <h1 className="av2-h1">{t('prog.h1')}</h1>
            <p className="av2-sub">{t('prog.sub')}</p>
            <div className="hero-actions">
              <LeadCta
                origen="programa"
                etiqueta={t('prog.cta_postular')}
                className="btn btn-primary"
              />
              <Link to="/auspicio" className="btn av2-btn-ghost">{t('prog.cta_patrocinar')}</Link>
            </div>
          </div>
        </div>
      </div>

      {/* Por qué ahora — cada punto con su fuente oficial */}
      <section className="sec-pad">
        <div className="container">
          <h2 className="sec-head">{t('prog.porque_t')}</h2>
          <div className="av2-bento" style={{ marginTop: 24 }}>
            {PORQUE.map(([titulo, desc, url]) => (
              <div key={titulo} className="card card-pad">
                <h3 style={{ fontSize: 17, marginBottom: 8 }}>{t(titulo)}</h3>
                <p className="muted" style={{ fontSize: 14, lineHeight: 1.6, marginBottom: url ? 10 : 0 }}>
                  {t(desc)}
                </p>
                {url && (
                  <a href={url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13 }}>
                    Ver la fuente
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Metodología */}
      <section className="sec-pad sec-alt" style={{ paddingTop: 0 }}>
        <div className="container">
          <h2 className="sec-head">{t('prog.metodo_t')}</h2>
          <p className="sec-head-sub">{t('prog.metodo_sub')}</p>
          <ul style={{ padding: 0, margin: '28px 0 0', columnGap: 40, columnCount: 'var(--cols, 1)' }}>
            {ETAPAS.map(([titulo, texto], i) => (
              <Etapa key={titulo} n={i + 1} titulo={titulo} texto={texto} />
            ))}
          </ul>
        </div>
      </section>

      {/* Piloto */}
      <section className="sec-pad">
        <div className="container">
          <h2 className="sec-head">{t('prog.piloto_t')}</h2>
          <p className="sec-head-sub">{t('prog.piloto_sub')}</p>
          <p className="muted" style={{ maxWidth: 720, margin: '20px auto 0', fontSize: 13, lineHeight: 1.6, textAlign: 'center' }}>
            {t('prog.piloto_limite')}
          </p>
        </div>
      </section>

      {/* Cronograma */}
      <section className="sec-pad sec-alt" style={{ paddingTop: 0 }}>
        <div className="container">
          <h2 className="sec-head">{t('prog.crono_t')}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 24, marginTop: 28 }}>
            <Hito titulo={t('prog.crono_sep_t')} texto={t('prog.crono_sep_d')} />
            <Hito titulo={t('prog.crono_oct_t')} texto={t('prog.crono_oct_d')} />
            <Hito titulo={t('prog.crono_nov_t')} texto={t('prog.crono_nov_d')} />
            <Hito titulo={t('prog.crono_dic_t')} texto={t('prog.crono_dic_d')} />
          </div>
        </div>
      </section>

      {/* Formación y cupos */}
      <section className="sec-pad">
        <div className="container" style={{ textAlign: 'center' }}>
          <h2 className="sec-head">{t('prog.formacion_t')}</h2>
          <p className="sec-head-sub">{t('prog.formacion_sub')}</p>

          {/* El contador solo aparece si el servidor declaró un cupo. Sin
              cupo declarado no se inventa un número ni se insinúa
              urgencia. */}
          {cupos && (
            <p style={{ marginTop: 20, fontWeight: 700 }}>
              {cupos.lleno
                ? t('prog.cupos_lleno')
                : (cupos.total
                  ? t('prog.cupos_quedan').replace('{n}', cupos.quedan).replace('{total}', cupos.total)
                  : t('prog.cupos_abierto'))}
            </p>
          )}

          <div style={{ marginTop: 22 }}>
            <LeadCta
              origen="programa"
              etiqueta={t('prog.cta_postular')}
              className="btn btn-primary"
            />
          </div>
        </div>
      </section>

      {/* Eventos: si no hay ninguno cargado, se dice, no se inventa */}
      <section className="sec-pad sec-alt" style={{ paddingTop: 0 }}>
        <div className="container">
          <h2 className="sec-head">{t('prog.eventos_t')}</h2>
          {eventos.length === 0 ? (
            <p className="sec-head-sub">{t('prog.eventos_vacio')}</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 18, marginTop: 26 }}>
              {eventos.map((e, i) => (
                <div key={`${e.titulo}-${i}`} className="card card-pad">
                  <div style={{ fontSize: 12, color: 'var(--green)', fontWeight: 700, marginBottom: 6 }}>
                    {e.ciudad} · {fecha(e.inicia_at)}
                  </div>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>{e.titulo}</div>
                  {e.lugar && <div className="muted" style={{ fontSize: 13 }}>{e.lugar}</div>}
                  {e.descripcion && (
                    <p className="muted" style={{ fontSize: 14, lineHeight: 1.55, marginTop: 8 }}>{e.descripcion}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Participantes: la sección entera desaparece si nadie aceptó */}
      {participantes.length > 0 && (
        <section className="sec-pad">
          <div className="container" style={{ textAlign: 'center' }}>
            <h2 className="sec-head">{t('prog.participantes_t')}</h2>
            <p className="sec-head-sub">{t('prog.participantes_nota')}</p>
            <div
              style={{
                display: 'flex', flexWrap: 'wrap', gap: 14,
                justifyContent: 'center', marginTop: 28,
              }}
            >
              {participantes.map((p, i) => (
                <span key={`${p.nombre}-${i}`} className="badge" style={{ padding: '10px 18px', fontSize: 15 }}>
                  {p.nombre}
                </span>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Cómo aportar */}
      <section className="sec-pad sec-alt">
        <div className="container">
          <h2 className="sec-head">{t('prog.aportar_t')}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 22, marginTop: 28 }}>
            <div className="card card-pad">
              <h3 style={{ fontSize: 18, marginBottom: 8 }}>{t('prog.aportar_empresa_t')}</h3>
              <p className="muted" style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
                {t('prog.aportar_empresa_d')}
              </p>
              <Link to="/auspicio" className="btn btn-primary">{t('prog.cta_patrocinar')}</Link>
            </div>
            <div className="card card-pad">
              <h3 style={{ fontSize: 18, marginBottom: 8 }}>{t('prog.aportar_persona_t')}</h3>
              <p className="muted" style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
                {t('prog.aportar_persona_d')}
              </p>
              {/* El botón de la tienda solo existe si hay tienda. Un enlace
                  que no lleva a ninguna parte es peor que ningún enlace. */}
              {import.meta.env.VITE_TIENDA_URL && (
                <a
                  href={import.meta.env.VITE_TIENDA_URL}
                  target="_blank" rel="noopener noreferrer"
                  className="btn btn-outline"
                >
                  {t('prog.tienda_cta')}
                </a>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="sec-pad">
        <div className="container" style={{ textAlign: 'center' }}>
          <Link to="/plataforma" className="btn btn-outline">{t('prog.plataforma_cta')}</Link>
          <p className="muted" style={{ maxWidth: 680, margin: '28px auto 0', fontSize: 13, lineHeight: 1.65 }}>
            {t('prog.cierre')}
          </p>
        </div>
      </section>
    </PublicLayout>
  );
}
