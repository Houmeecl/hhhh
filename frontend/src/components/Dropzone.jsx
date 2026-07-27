import { useRef, useState } from 'react';
import { Icon } from './icons.jsx';

// Zona de carga reusable: arrastrar y soltar, seleccionar archivos, o
// tomar la foto directo con la cámara del celular (input con `capture`).
// En desktop se ve como un solo dropzone; en móvil (o pantalla táctil)
// aparecen además los dos botones de acción.
export default function Dropzone({ onFiles, accept = '.pdf,.xml,.jpg,.jpeg,.png,.heic' }) {
  const fileRef = useRef();
  const cameraRef = useRef();
  const [drag, setDrag] = useState(false);

  function onDrop(e) {
    e.preventDefault();
    setDrag(false);
    onFiles(e.dataTransfer.files);
  }

  return (
    <div
      className={`dropzone ${drag ? 'drag' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={onDrop}
      onClick={() => fileRef.current.click()}
    >
      <div style={{ color: 'var(--green-600)' }}><Icon.Cloud size={44} /></div>
      <div style={{ fontWeight: 700, marginTop: 8 }}>Arrastra y suelta tus archivos aquí</div>
      <div className="muted">o selecciona desde tu dispositivo</div>
      <button className="btn btn-primary" style={{ marginTop: 14 }} type="button">Seleccionar archivos</button>

      {/* En móvil: dos acciones explícitas — la cámara abre directo, sin pasar por el selector. */}
      <div className="capture-actions" onClick={(e) => e.stopPropagation()}>
        <button className="btn btn-outline" type="button" onClick={() => cameraRef.current.click()}>
          <Icon.Camera size={16} /> Tomar foto
        </button>
        <button className="btn btn-outline" type="button" onClick={() => fileRef.current.click()}>
          <Icon.Doc size={16} /> Elegir archivos
        </button>
      </div>

      <div className="muted" style={{ fontSize: 13, marginTop: 12 }}>
        Formatos permitidos: PDF, XML, JPG, PNG (o HEIC de iPhone)
      </div>

      <input
        ref={fileRef} type="file" multiple hidden
        accept={accept}
        onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }}
      />
      <input
        ref={cameraRef} type="file" hidden
        accept="image/*" capture="environment"
        onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }}
      />
    </div>
  );
}
