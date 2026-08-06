// Calculadora pública "¿Cuánto compensarías?" para los landings.
// Usa los factores REALES del motor propio (GET /publico/calculadora) y la
// tarifa vigente; el cálculo replica la matemática del motor:
//   físico: t = cantidad × factor_fisico_kgco2e / 1000
//   gasto:  t = (monto_clp / 1000) × factor_gasto_kgco2e_clp1000 / 1000
// Si el endpoint falla, el componente no se renderiza (null): el landing
// nunca se rompe por la calculadora. Siempre se rotula como estimación
// referencial — el número exacto sale de los documentos del cliente.
// Etiquetas con i18n (es/en/pt); los montos CLP mantienen formato chileno.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtInt } from '../api.js';
import { Skeleton } from './Skeleton.jsx';
import { Icon } from './icons.jsx';
import { useIdioma } from '../lib/i18n.js';

// Entradas del formulario, buscadas por código en las categorías del motor.
// Si una categoría no existe (o no trae el factor que necesita), su fila se
// omite en vez de mostrar un cálculo inventado. label/unidad son claves i18n.
const ENTRADAS = [
  { codigo: 'electricidad', tipo: 'fisico', labelKey: 'calc.electricidad', unidadKey: 'calc.u.kwh', icon: 'Plug', inicial: '2.500' },
  // `combustible` en singular: es el código de la categoría en el motor
  // (migración 010), no el rótulo. Estuvo en plural y como la fila se omite
  // cuando el código no existe, la entrada desaparecía sin avisar y la
  // estimación salía casi a la mitad para quien quema combustible.
  { codigo: 'combustible', tipo: 'fisico', labelKey: 'calc.combustibles', unidadKey: 'calc.u.litros', icon: 'Cog', inicial: '300' },
  { codigo: 'transporte', tipo: 'fisico', labelKey: 'calc.transporte', unidadKey: 'calc.u.km', icon: 'Package', inicial: '1.000' },
  { codigo: 'servicios', tipo: 'gasto', labelKey: 'calc.otros_gastos', unidadKey: 'calc.u.clp', icon: 'CreditCard', inicial: '500.000' },
];

// Parseo de números escritos a la chilena: "." de miles y "," decimal.
const parseCL = (s) => {
  const n = Number(String(s ?? '').replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const fmt3 = (n) => (Number(n) || 0).toLocaleString('es-CL', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

export default function CalculadoraCompensacion() {
  const { t } = useIdioma();
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
    // "ton" y no "t": el nombre corto quedó tomado por t() del i18n.
    const ton = filas.reduce((acc, f) => {
      const v = parseCL(valores[f.codigo]);
      if (f.tipo === 'fisico') return acc + (v * f.factor) / 1000;
      return acc + ((v / 1000) * f.factor) / 1000;
    }, 0);
    return { totalT: ton, compensacion: Math.round(ton * (Number(data?.tarifa_clp_tco2e) || 0)) };
  }, [filas, valores, data]);

  // USD referencial: solo si el backend expone tipo_cambio_usd_clp (> 0).
  // Si viene null/undefined o el endpoint aún no lo trae, no se muestra nada.
  const tipoCambio = Number(data?.tipo_cambio_usd_clp) || 0;
  const usd = tipoCambio > 0 ? Math.round(compensacion / tipoCambio) : null;

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

  return (
    <div className="card card-pad" style={{ maxWidth: 920, margin: '0 auto' }}>
      <div className="two-col-grid" style={{ gap: 28, alignItems: 'start' }}>
        {/* Entradas */}
        <div>
          <p className="muted" style={{ fontSize: 13, margin: '0 0 14px', lineHeight: 1.5 }}>
            {t('calc.ajusta')}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filas.map((f) => {
              const Ico = Icon[f.icon] || Icon.Doc;
              return (
                <div className="field" key={f.codigo} style={{ minWidth: 0 }}>
                  <label htmlFor={`calc-${f.codigo}`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: 'var(--green-600)', display: 'inline-flex' }}><Ico size={15} /></span>
                    {t(f.labelKey)} <span className="muted" style={{ fontWeight: 400 }}>({t(f.unidadKey)})</span>
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
              $ {fmtInt(compensacion)} CLP {t('calc.clp_mes')}
            </div>
            {usd != null && (
              <div className="muted" style={{ fontSize: 13, marginTop: 4, fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>
                ≈ US$ {usd.toLocaleString('en-US')} ({t('comun.referencial')})
              </div>
            )}
            <div className="l" style={{ marginTop: 10, lineHeight: 1.5 }}>
              {t('calc.nota')}
            </div>
          </div>
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
            <Link to="/inscripcion" className="btn btn-primary">{t('calc.cta')}</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
