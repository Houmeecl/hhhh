// Calculadora pública "¿Cuánto compensarías?" para los landings.
// Usa los factores REALES del motor propio (GET /publico/calculadora) y la
// tarifa vigente; el cálculo replica la matemática del motor:
//   físico: t = cantidad × factor_fisico_kgco2e / 1000
//   gasto:  t = (monto_clp / 1000) × factor_gasto_kgco2e_clp1000 / 1000
// Si el endpoint falla, el componente no se renderiza (null): el landing
// nunca se rompe por la calculadora. Siempre se rotula como estimación
// referencial — el número exacto sale de los documentos del cliente.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtInt } from '../api.js';
import { Skeleton } from './Skeleton.jsx';
import { Icon } from './icons.jsx';

// Entradas del formulario, buscadas por código en las categorías del motor.
// Si una categoría no existe (o no trae el factor que necesita), su fila se
// omite en vez de mostrar un cálculo inventado.
const ENTRADAS = [
  { codigo: 'electricidad', tipo: 'fisico', label: 'Electricidad', unidad: 'kWh/mes', icon: 'Plug', inicial: '2.500' },
  { codigo: 'combustibles', tipo: 'fisico', label: 'Combustibles', unidad: 'litros/mes', icon: 'Cog', inicial: '300' },
  { codigo: 'transporte', tipo: 'fisico', label: 'Transporte', unidad: 'km/mes', icon: 'Package', inicial: '1.000' },
  { codigo: 'servicios', tipo: 'gasto', label: 'Otros gastos', unidad: '$/mes', icon: 'CreditCard', inicial: '500.000' },
];

// Parseo de números escritos a la chilena: "." de miles y "," decimal.
const parseCL = (s) => {
  const n = Number(String(s ?? '').replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const fmt3 = (n) => (Number(n) || 0).toLocaleString('es-CL', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

export default function CalculadoraCompensacion({ contexto = 'sicr3p' }) {
  const [data, setData] = useState(null);
  const [estado, setEstado] = useState('cargando'); // cargando | ok | error
  const [valores, setValores] = useState(() =>
    Object.fromEntries(ENTRADAS.map((e) => [e.codigo, e.inicial])));

  useEffect(() => {
    let vivo = true;
    api.calculadora()
      .then((d) => { if (vivo) { setData(d); setEstado('ok'); } })
      .catch(() => { if (vivo) setEstado('error'); });
    return () => { vivo = false; };
  }, []);

  // Filas visibles: solo las categorías que el motor realmente expone con el
  // factor correspondiente a su tipo (físico o gasto).
  const filas = useMemo(() => {
    if (!data?.categorias) return [];
    return ENTRADAS.map((e) => {
      const cat = data.categorias.find((c) => c.codigo === e.codigo);
      if (!cat) return null;
      const factor = e.tipo === 'fisico' ? cat.factor_fisico_kgco2e : cat.factor_gasto_kgco2e_clp1000;
      if (factor == null || !(Number(factor) > 0)) return null;
      return { ...e, factor: Number(factor) };
    }).filter(Boolean);
  }, [data]);

  const { totalT, compensacion } = useMemo(() => {
    const t = filas.reduce((acc, f) => {
      const v = parseCL(valores[f.codigo]);
      if (f.tipo === 'fisico') return acc + (v * f.factor) / 1000;
      return acc + ((v / 1000) * f.factor) / 1000;
    }, 0);
    return { totalT: t, compensacion: Math.round(t * (Number(data?.tarifa_clp_tco2e) || 0)) };
  }, [filas, valores, data]);

  // Skeleton discreto mientras llega la respuesta.
  if (estado === 'cargando') {
    return (
      <div className="card card-pad" style={{ maxWidth: 920, margin: '0 auto' }}>
        <div className="two-col-grid" style={{ gap: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} h={46} />)}
          </div>
          <div>
            <Skeleton h={46} w="70%" />
            <Skeleton h={20} w="55%" style={{ marginTop: 12 }} />
            <Skeleton h={14} w="90%" style={{ marginTop: 18 }} />
          </div>
        </div>
      </div>
    );
  }
  // Sin datos no hay calculadora — y el landing sigue intacto.
  if (estado === 'error' || filas.length === 0) return null;

  const enAduana = contexto === 'aduana';

  return (
    <div className="card card-pad" style={{ maxWidth: 920, margin: '0 auto' }}>
      <div className="two-col-grid" style={{ gap: 28, alignItems: 'start' }}>
        {/* Entradas */}
        <div>
          <p className="muted" style={{ fontSize: 13, margin: '0 0 14px', lineHeight: 1.5 }}>
            Ajusta tu consumo mensual aproximado y mira el número en vivo.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filas.map((f) => {
              const Ico = Icon[f.icon] || Icon.Doc;
              return (
                <div className="field" key={f.codigo} style={{ minWidth: 0 }}>
                  <label htmlFor={`calc-${f.codigo}`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: 'var(--green-600)', display: 'inline-flex' }}><Ico size={15} /></span>
                    {f.label} <span className="muted" style={{ fontWeight: 400 }}>({f.unidad})</span>
                  </label>
                  <input
                    id={`calc-${f.codigo}`}
                    type="text"
                    inputMode="decimal"
                    value={valores[f.codigo]}
                    onChange={(e) => setValores((v) => ({ ...v, [f.codigo]: e.target.value }))}
                    onBlur={() => setValores((v) => {
                      const n = parseCL(v[f.codigo]);
                      return { ...v, [f.codigo]: n ? n.toLocaleString('es-CL', { maximumFractionDigits: 2 }) : '0' };
                    })}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Resultado en vivo, estilo stat */}
        <div style={{ minWidth: 0 }}>
          <div
            className="stat"
            style={{
              background: 'linear-gradient(160deg, var(--green-50, #eaf6ef) 0%, #fff 70%)',
              borderColor: 'rgba(40, 167, 69, 0.35)',
            }}
          >
            <div className="n green" style={{ fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>
              ≈ {fmt3(totalT)} t CO2e
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--navy)', marginTop: 6, overflowWrap: 'anywhere' }}>
              $ {fmtInt(compensacion)} CLP de compensación al mes
            </div>
            <div className="l" style={{ marginTop: 10, lineHeight: 1.5 }}>
              Estimación referencial con los factores reales del motor sicr3p y
              la tarifa vigente — tu número exacto sale de tus documentos.
            </div>
          </div>
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
            <Link to="/cargar" className="btn btn-primary">Calcula el tuyo con tus facturas</Link>
            {enAduana
              ? <span className="muted" style={{ fontSize: 13 }}>o <Link to="/pos">conoce el terminal</Link></span>
              : <span className="muted" style={{ fontSize: 13 }}>o en una <Link to="/aduana-verde">oficina Aduana Verde</Link></span>}
          </div>
        </div>
      </div>
    </div>
  );
}
