import { useEffect, useState } from 'react';
import { api, fmtFecha } from '../api.js';
import { Icon } from '../components/icons.jsx';

const TIPO_DOCUMENTO_LABEL = {
  factura: 'Factura comercial', packing_list: 'Packing list', carta_porte: 'Carta de porte',
  mic_dta: 'MIC/DTA', cert_origen: 'Certificado de origen', sag: 'Documento SAG',
  seguro: 'Seguro', pesaje: 'Comprobante de pesaje', foto: 'Fotografía',
  comprobante_frontera: 'Comprobante fronterizo', otro: 'Otro',
};
const SEMAFORO_BADGE = { verde: 'badge-green', amarillo: 'badge-amber', rojo: 'badge-red', gris: 'badge-gray' };
const SEMAFORO_LABEL = { verde: 'Completo', amarillo: 'Parcial', rojo: 'Sin documentos', gris: 'Sin criterio' };

// Lista de expedientes (lotes documentales) de ESTA agencia — el backend
// ya filtra por agencia_id de la sesión, nunca se ve el expediente de otra
// agencia — + detalle con documentos, semáforo y cadena de custodia.
// Solo lectura: la captura de documentos vive en CapturarDocumentos.jsx.
export default function Expedientes() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [seleccionado, setSeleccionado] = useState(null);
  const [detalle, setDetalle] = useState(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [errorDetalle, setErrorDetalle] = useState('');

  useEffect(() => {
    api.agenciaExpedientes().then(setData).catch((e) => setError(e.message));
  }, []);

  async function abrir(codigo) {
    setSeleccionado(codigo);
    setDetalle(null);
    setErrorDetalle('');
    setCargandoDetalle(true);
    try {
      const d = await api.agenciaExpediente(codigo);
      setDetalle(d);
    } catch (e) {
      setErrorDetalle(e.message);
    } finally {
      setCargandoDetalle(false);
    }
  }

  if (error) return <div className="badge badge-red" style={{ display: 'block', padding: 14 }}>{error}</div>;
  if (!data) return <div style={{ padding: 40, textAlign: 'center' }}><span className="spinner dark" /> Cargando…</div>;

  const nAbiertos = data.expedientes.filter((l) => l.estado === 'abierto').length;
  const nCerrados = data.expedientes.length - nAbiertos;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Expedientes de {data.agencia.nombre}</h1>
      <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>
        Solo se muestran las cargas del Corredor Bioceánico asignadas a tu agencia.
      </p>

      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <div className="stat"><div className="n">{data.expedientes.length}</div><div className="l">Expedientes totales</div></div>
        <div className="stat"><div className="n green">{nAbiertos}</div><div className="l">Abiertos</div></div>
        <div className="stat"><div className="n">{nCerrados}</div><div className="l">Cerrados</div></div>
      </div>

      <div className="two-col-grid" style={{ gap: 16, alignItems: 'flex-start' }}>
        <div className="card card-pad">
          {!data.expedientes.length ? (
            <p className="muted" style={{ fontSize: 13 }}>Sin expedientes asignados todavía.</p>
          ) : (
            <div className="table-scroll">
              <table className="data">
                <thead><tr><th>Código</th><th>Material</th><th>Estado</th><th>Docs.</th><th>Actualizado</th><th></th></tr></thead>
                <tbody>
                  {data.expedientes.map((l) => (
                    <tr key={l.id} className={seleccionado === l.codigo ? 'active' : ''}>
                      <td style={{ fontFamily: 'monospace' }}>{l.codigo}</td>
                      <td>{l.material}</td>
                      <td><span className={`badge ${l.estado === 'abierto' ? 'badge-green' : 'badge-gray'}`}>{l.estado}</span></td>
                      <td>{l.doc_n_documentos}</td>
                      <td>{fmtFecha(l.updated_at)}</td>
                      <td><button className="btn btn-sm btn-outline" onClick={() => abrir(l.codigo)}>Ver</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card card-pad">
          {!seleccionado ? (
            <p className="muted" style={{ fontSize: 13 }}>Selecciona un expediente para ver sus documentos.</p>
          ) : cargandoDetalle ? (
            <div style={{ textAlign: 'center', padding: 20 }}><span className="spinner dark" /> Cargando…</div>
          ) : errorDetalle ? (
            <div className="badge badge-red" style={{ display: 'block', padding: 12 }}>{errorDetalle}</div>
          ) : detalle && (
            <>
              <h3 style={{ marginTop: 0 }}>{detalle.lote.codigo}</h3>
              <p className="muted" style={{ fontSize: 13 }}>
                {detalle.lote.material} · {detalle.lote.cantidad} {detalle.lote.unidad} · origen {detalle.lote.pais_origen}
              </p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
                <span className={`badge ${detalle.integridad.valido ? 'badge-green' : 'badge-red'}`}>
                  <Icon.Shield size={12} /> {detalle.integridad.valido ? 'Cadena íntegra' : 'Cadena alterada'}
                </span>
                {detalle.semaforo && (
                  <span className={`badge ${SEMAFORO_BADGE[detalle.semaforo.color] || 'badge-gray'}`}>
                    📄 {SEMAFORO_LABEL[detalle.semaforo.color] || detalle.semaforo.color}
                  </span>
                )}
                <a className="btn btn-sm btn-outline" onClick={() => api.abrirExpedienteAgenciaPdf(detalle.lote.codigo)}>
                  Expediente PDF
                </a>
              </div>

              <h4 style={{ margin: '10px 0 6px' }}>Documentos</h4>
              {!detalle.documentos?.length ? (
                <p className="muted" style={{ fontSize: 13 }}>Sin documentos cargados todavía.</p>
              ) : (
                <div className="table-scroll" style={{ marginBottom: 14 }}>
                  <table className="data">
                    <thead><tr><th>Tipo</th><th>Estado</th><th>Fecha</th></tr></thead>
                    <tbody>
                      {detalle.documentos.map((d) => (
                        <tr key={d.id}>
                          <td>{TIPO_DOCUMENTO_LABEL[d.tipo_documento] || d.tipo_documento}</td>
                          <td><span className={`badge ${d.estado === 'leido' ? 'badge-green' : 'badge-gray'}`}>{d.estado}</span></td>
                          <td>{fmtFecha(d.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <h4 style={{ margin: '10px 0 6px' }}>Cadena de custodia</h4>
              <div className="table-scroll">
                <table className="data">
                  <thead><tr><th>#</th><th>Rol</th><th>Empresa</th><th>País</th><th>Fecha</th></tr></thead>
                  <tbody>
                    {detalle.eslabones.map((e) => (
                      <tr key={e.eslabon}>
                        <td>{e.eslabon}</td>
                        <td>{e.rol}</td>
                        <td>{e.nombre_empresa || '—'}</td>
                        <td>{e.pais}</td>
                        <td>{fmtFecha(e.fecha)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
