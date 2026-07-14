// ============================================================
// regira — Página pública del concurso (la abre el QR)
// Copiar a: client/src/pages/Concurso.tsx
// Ruta (App.tsx): <Route path="/concurso/:id" component={Concurso} />
// ============================================================
import { useEffect, useState } from "react";
import { useRoute, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

type Row = { puesto: number; refId: string; nombre: string; total: number };
type ContestData = {
  id: string; title: string; description: string;
  scope: "empresas" | "equipos" | "personas";
  metric: "containers" | "points";
  startDate: string; endDate: string; status: string;
  prizes: { puesto: number; descripcion: string }[];
  leaderboard: Row[];
};

function useCountdown(endDate?: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!endDate) return null;
  const diff = new Date(endDate).getTime() - now;
  if (diff <= 0) return "Finalizado";
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return `${d}d ${h}h ${m}m ${s}s`;
}

const MEDALS = ["🥇", "🥈", "🥉"];

export default function Concurso() {
  const [, params] = useRoute("/concurso/:id");
  const id = params?.id;
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<ContestData>({
    queryKey: ["/api/concursos", id],
    queryFn: async () => {
      const res = await fetch(`/api/concursos/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Concurso no encontrado");
      return res.json();
    },
    enabled: !!id,
    refetchInterval: 30000, // ranking en vivo
  });

  const inscribir = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/concursos/${id}/inscribir`, { method: "POST", credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "No se pudo inscribir");
      return body;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/concursos", id] }),
  });

  const countdown = useCountdown(data?.endDate);

  if (isLoading) return <div className="min-h-screen grid place-items-center text-emerald-700">Cargando concurso…</div>;
  if (!data) return (
    <div className="min-h-screen grid place-items-center p-6 text-center">
      <div>
        <p className="text-4xl mb-2">🏆</p>
        <h1 className="text-xl font-bold">Concurso no encontrado</h1>
        <Link href="/" className="text-emerald-600 underline">Volver al inicio</Link>
      </div>
    </div>
  );

  const unidad = data.metric === "points" ? "puntos" : "envases";
  const cerrado = data.status === "closed";

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50 to-white">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="text-center mb-6">
          <span className={`inline-block text-xs font-bold px-3 py-1 rounded-full ${cerrado ? "bg-slate-200 text-slate-600" : "bg-emerald-100 text-emerald-700"}`}>
            {cerrado ? "Concurso finalizado" : "Concurso en curso"} · {data.scope}
          </span>
          <h1 className="text-3xl font-bold mt-3 text-slate-900">{data.title}</h1>
          {data.description && <p className="text-slate-600 mt-2">{data.description}</p>}
          {!cerrado && countdown && (
            <div className="mt-4 inline-block bg-slate-900 text-white rounded-xl px-5 py-3">
              <div className="text-xs text-slate-300 uppercase tracking-wide">Termina en</div>
              <div className="text-2xl font-bold tabular-nums">{countdown}</div>
            </div>
          )}
        </div>

        {/* Ranking */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-bold text-slate-900">{cerrado ? "Resultados finales" : "Ranking en vivo"}</h2>
            <span className="text-xs text-slate-500">{unidad} del período</span>
          </div>
          {data.leaderboard.length === 0 ? (
            <p className="p-6 text-center text-slate-500">Aún no hay inscritos. ¡Sé el primero!</p>
          ) : (
            <ul>
              {data.leaderboard.map((row) => (
                <li key={row.refId} className={`flex items-center gap-3 px-5 py-3 border-b border-slate-50 ${row.puesto <= 3 ? "bg-emerald-50/50" : ""}`}>
                  <span className="w-8 text-xl text-center">{MEDALS[row.puesto - 1] ?? <span className="text-sm text-slate-400">{row.puesto}</span>}</span>
                  <span className="flex-1 font-medium text-slate-800">{row.nombre}</span>
                  <span className="font-bold tabular-nums text-emerald-700">{row.total.toLocaleString("es-CL")}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Premios */}
        {data.prizes.length > 0 && (
          <div className="mt-6 bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
            <h2 className="font-bold text-slate-900 mb-3">Premios</h2>
            <ul className="space-y-2">
              {data.prizes.map((p) => (
                <li key={p.puesto} className="flex items-center gap-3">
                  <span className="text-xl">{MEDALS[p.puesto - 1] ?? "🎖️"}</span>
                  <span className="text-slate-700">{p.descripcion}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* CTA */}
        {!cerrado && (
          <div className="mt-6 text-center">
            <button
              onClick={() => inscribir.mutate()}
              disabled={inscribir.isPending}
              className="w-full sm:w-auto bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-xl px-8 py-4 min-h-12 transition"
            >
              {inscribir.isPending ? "Inscribiendo…" : "Inscribirme en el concurso"}
            </button>
            {inscribir.isSuccess && <p className="mt-3 text-emerald-700 font-semibold">¡Inscripción lista! A competir 🏆</p>}
            {inscribir.isError && (
              <p className="mt-3 text-red-600 font-medium">
                {(inscribir.error as Error).message}
                {" · "}
                <Link href="/login" className="underline">Inicia sesión</Link>
              </p>
            )}
            <p className="mt-4 text-xs text-slate-500">
              Cada envase que registres en el período suma al ranking. Validación con QR/GPS antifraude.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
