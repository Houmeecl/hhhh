// ============================================================
// Qué documento agrega cada frontera del corredor.
//
// Es la pregunta que hace todo exportador antes de la primera carga —
// "¿qué me van a pedir en cada paso?"— y la landing no la respondía en
// ninguna parte.
//
// ESPEJO DE `migrations-corredor/003` Y `004`, NO UNA COPIA SUELTA. Hay un
// test en el backend (documentosPorFronteraLanding.test.js) que compara
// esta lista contra lo que siembran las migraciones y falla si se
// separan. Se mantiene acá y no se pide por API a propósito: la landing
// es pública y tiene que verse aunque el Corredor esté apagado en el
// servidor, que es exactamente su estado en una instalación nueva.
//
// LO QUE NO SE NOMBRA ACÁ, Y ES DELIBERADO: el organismo emisor de cada
// certificado. En la revisión normativa aparecieron atribuciones dudosas
// —el DOF es del IBAMA y no del MAPA, y el SAG exige el fitosanitario al
// ingreso pero no lo emite para carga argentina, que la emite el SENASA—
// y ninguna está confirmada contra fuente primaria todavía. Nombrar mal a
// una autoridad en una página pública es peor que no nombrarla: se dice
// "la autoridad sanitaria del país de origen" hasta poder citarla.

export const EN_TODO_TRAMO = [
  { doc: 'Factura comercial', para: 'Respalda la operación y su valor. La necesita el comprador y el importador europeo.' },
  { doc: 'Certificado de origen', para: 'Acredita de qué país salió la mercancía.' },
  { doc: 'Carta de porte internacional (CRT)', para: 'Acredita que la carga recorrió el tramo, con quién y cuándo.' },
  { doc: 'Lista de empaque', para: 'Permite cuadrar la cantidad declarada con la que llegó. Opcional.' },
];

export const FRONTERAS = [
  {
    cruce: 'BR → PY',
    de: 'Brasil', a: 'Paraguay',
    estado: 'definido',
    agrega: [
      { doc: 'Certificado fitosanitario', nota: 'Para producto de origen vegetal. Es la evidencia de legalidad en el país de producción que pide el EUDR.' },
      { doc: 'Documento de origen forestal', nota: 'Solo si la carga es madera de origen nativo. La de plantación no lo requiere.', opcional: true },
    ],
  },
  {
    cruce: 'PY → AR',
    de: 'Paraguay', a: 'Argentina',
    estado: 'definido',
    agrega: [
      { doc: 'Certificado fitosanitario', nota: 'Si el producto es de origen vegetal y salió de Paraguay. Una carga en tránsito puro conserva el de su país de origen.' },
      { doc: 'Guía de circulación forestal', nota: 'Solo si la carga es madera o derivados.', opcional: true },
    ],
  },
  {
    cruce: 'AR → CL',
    de: 'Argentina', a: 'Chile',
    estado: 'en_incorporacion',
    agrega: [],
    nota: 'Este cruce todavía no está incorporado: sicr3p no te va a exigir nada por ahí hasta haber confirmado qué se pide al ingreso. Chile es el destino — donde la carga llega a puerto y donde se emite el informe.',
  },
];

export default function DocumentosPorFrontera({ t }) {
  const titulo = t ? t('cor.fronteras_titulo') : 'Qué pide cada frontera';
  const sub = t ? t('cor.fronteras_sub') : null;

  return (
    <section className="sec-pad">
      <div className="container">
        <h2 style={{ textAlign: 'center', fontSize: 28, margin: '0 0 10px' }}>{titulo}</h2>
        <p className="muted" style={{ textAlign: 'center', fontSize: 15, maxWidth: 620, margin: '0 auto 28px', lineHeight: 1.6 }}>
          {sub || 'La carga cruza tres fronteras y cada una suma lo suyo. sicr3p arma la lista del viaje concreto — no una lista genérica igual para todos.'}
        </p>

        <div className="cor-fronteras">
          {FRONTERAS.map((f) => (
            <div key={f.cruce} className={`cor-frontera av2-reveal ${f.estado === 'definido' ? '' : 'pendiente'}`}>
              <div className="cor-frontera-cab">
                <span className="cor-frontera-cruce">{f.cruce}</span>
                <span className="muted" style={{ fontSize: 12.5 }}>{f.de} a {f.a}</span>
              </div>
              {f.estado === 'definido' ? (
                <ul className="cor-frontera-lista">
                  {f.agrega.map((a) => (
                    <li key={a.doc}>
                      <b>{a.doc}</b>{a.opcional && <span className="muted" style={{ fontWeight: 400 }}> · según la carga</span>}
                      <span>{a.nota}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="cor-frontera-pendiente">{f.nota}</p>
              )}
            </div>
          ))}
        </div>

        <div className="cor-todo-tramo av2-reveal">
          <h3>Y en todo el viaje, cruce o no cruce fronteras</h3>
          <ul>
            {EN_TODO_TRAMO.map((x) => (
              <li key={x.doc}><b>{x.doc}</b><span>{x.para}</span></li>
            ))}
          </ul>
        </div>

        <p className="muted" style={{ textAlign: 'center', fontSize: 12.5, marginTop: 20, maxWidth: 680, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6 }}>
          sicr3p sella la huella de cada documento y la encadena; el archivo se queda contigo. Esto no
          es el trámite aduanero —el despacho y el tránsito los ve tu agente de aduana— sino el
          expediente de evidencia que después te van a pedir en destino.
        </p>
      </div>
    </section>
  );
}
