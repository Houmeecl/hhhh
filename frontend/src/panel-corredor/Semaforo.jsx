// El semáforo del Corredor, en un solo lugar.
//
// La doctrina del proyecto (semaforoExportacion / semaforoTramo /
// semaforoExpediente en el backend) tiene TRES lecturas y no dos: gris no
// es "casi rojo", es «no hay con qué comparar». Estaba escrito como un
// mapa suelto en cada pantalla y por lo tanto se podía desincronizar.
//
// El color NO es el único canal: .badge-sem le agrega a cada estado un
// punto propio —lleno para verde/ámbar/rojo, HUECO para gris— porque a un
// metro de distancia, o para quien no distingue rojo de verde, tres
// píldoras pastel del mismo tamaño se veían iguales. La forma dice lo
// mismo que el color y no depende de él.
export const CLASE_SEMAFORO = {
  verde: 'badge-green',
  amarillo: 'badge-amber',
  rojo: 'badge-red',
  gris: 'badge-gray',
};

export default function Semaforo({ estado, children, titulo }) {
  return (
    <span className={`badge badge-sem ${CLASE_SEMAFORO[estado] || 'badge-gray'}`} title={titulo}>
      {children}
    </span>
  );
}
