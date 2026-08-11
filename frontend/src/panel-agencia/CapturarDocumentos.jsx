import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Dropzone from '../components/Dropzone.jsx';

const TIPO_DOCUMENTO_LABEL = {
  factura: 'Factura comercial', packing_list: 'Packing list', carta_porte: 'Carta de porte',
  mic_dta: 'MIC/DTA', cert_origen: 'Certificado de origen', sag: 'Documento SAG',
  seguro: 'Seguro', pesaje: 'Comprobante de pesaje', foto: 'Fotografía',
  comprobante_frontera: 'Comprobante fronterizo', otro: 'Otro',
};
const TIPOS_DOCUMENTO_CARGA = Object.keys(TIPO_DOCUMENTO_LABEL);

// Pantalla de captura de documentos para tablet/PC — sin marca de POS, sin
// cobro ni compensación: la agencia elige el expediente y el tipo de
// documento, y sube archivos con el mismo Dropzone del resto del sitio
// (drag&drop, selector o cámara). Cada archivo entra a la cadena de hash
// de documentos del lote (o a la cola de revisión si no se lee bien).
export default function CapturarDocumentos() {
  const [expedientes, setExpedientes] = useState(null);
  const [codigo, setCodigo] = useState('');
  const [tipoDocumento, setTipoDocumento] = useState(TIPOS_DOCUMENTO_CARGA[0]);
  const [subiendo, setSubiendo] = useState(false);
  const [subidos, setSubidos] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api.agenciaExpedientes()
      .then((r) => {
        const abiertos = r.expedientes.filter((l) => l.estado === 'abierto');
        setExpedientes(abiertos);
        if (abiertos.length) setCodigo(abiertos[0].codigo);
      })
      .catch((e) => setError(e.message));
  }, []);

  async function subir(files) {
    if (!files?.length || !codigo) return;
    setSubiendo(true);
    setError('');
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append('archivo', file);
        fd.append('tipo_documento', tipoDocumento);
        const r = await api.agenciaSubirDocumento(codigo, fd);
        setSubidos((s) => [{
          nombre: file.name,
          tipo: tipoDocumento,
          estado: r.documento.estado,
          hora: new Date(),
        }, ...s]);
      }
    } catch (e) { setError(e.message); }
    finally { setSubiendo(false); }
  }

  if (error && !expedientes) return <div className="badge badge-red" style={{ display: 'block', padding: 14 }}>{error}</div>;
  if (!expedientes) return <div style={{ padding: 40, textAlign: 'center' }}><span className="spinner dark" /> Cargando…</div>;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Capturar documentos</h1>
      <p className="muted" style={{ fontSize: 13, marginTop: -6, maxWidth: 640 }}>
        Elige el expediente y el tipo de documento, y sube el archivo (foto o PDF). Cada documento entra
        directo a la cadena de hash del expediente; si no se lee automáticamente, queda en revisión de sicrep.
      </p>

      {!expedientes.length ? (
        <div className="card card-pad"><p className="muted">Sin expedientes abiertos asignados a tu agencia.</p></div>
      ) : (
        <div className="card card-pad" style={{ maxWidth: 560 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            <div className="field" style={{ margin: 0, flex: 1, minWidth: 180 }}>
              <label>Expediente</label>
              <select value={codigo} onChange={(e) => setCodigo(e.target.value)}>
                {expedientes.map((l) => <option key={l.id} value={l.codigo}>{l.codigo} — {l.material}</option>)}
              </select>
            </div>
            <div className="field" style={{ margin: 0, flex: 1, minWidth: 180 }}>
              <label>Tipo de documento</label>
              <select value={tipoDocumento} onChange={(e) => setTipoDocumento(e.target.value)}>
                {TIPOS_DOCUMENTO_CARGA.map((v) => <option key={v} value={v}>{TIPO_DOCUMENTO_LABEL[v]}</option>)}
              </select>
            </div>
          </div>

          {error && <div className="badge badge-red" style={{ display: 'block', padding: 10, marginBottom: 12 }}>{error}</div>}

          {subiendo ? (
            <div style={{ padding: 30, textAlign: 'center' }}><span className="spinner dark" /> Subiendo…</div>
          ) : (
            <Dropzone onFiles={subir} />
          )}

          {subidos.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h4 style={{ margin: '0 0 8px' }}>Subidos en esta sesión</h4>
              <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                {subidos.map((s, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span>{s.nombre} — {TIPO_DOCUMENTO_LABEL[s.tipo]}</span>
                    <span className={`badge ${s.estado === 'leido' ? 'badge-green' : 'badge-amber'}`}>
                      {s.estado === 'leido' ? 'Sellado' : 'En revisión'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
