// ============================================================
// regira — Administración de concursos
// Copiar a: client/src/pages/AdminConcursos.tsx
// Ruta (App.tsx): <Route path="/admin/concursos"><ProtectedRoute adminOnly><AdminConcursos /></ProtectedRoute></Route>
// ============================================================
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

type Contest = {
  id: string; title: string; scope: string; metric: string;
  startDate: string; endDate: string; status: string;
  prizes: { puesto: number; descripcion: string }[];
  winners?: { puesto: number; nombre: string; total: number }[] | null;
};

async function api(path: string, method = "GET", body?: unknown) {
  const res = await fetch(path, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "Error");
  return data;
}

const VACIO = { title: "", description: "", scope: "empresas", metric: "containers", startDate: "", endDate: "", premio1: "", premio2: "", premio3: "" };

export default function AdminConcursos() {
  const qc = useQueryClient();
  const [form, setForm] = useState(VACIO);
  const [msg, setMsg] = useState("");

  const { data: concursos = [] } = useQuery<Contest[]>({
    queryKey: ["/api/admin/concursos"],
    queryFn: () => api("/api/admin/concursos"),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["/api/admin/concursos"] });

  const crear = useMutation({
    mutationFn: () => api("/api/admin/concursos", "POST", {
      title: form.title,
      description: form.description,
      scope: form.scope,
      metric: form.metric,
      startDate: form.startDate,
      endDate: form.endDate,
      prizes: [form.premio1, form.premio2, form.premio3]
        .map((d, i) => ({ puesto: i + 1, descripcion: d }))
        .filter((p) => p.descripcion.trim().length > 0),
    }),
    onSuccess: () => { setForm(VACIO); setMsg("Concurso creado (borrador). Actívalo cuando quieras."); invalidate(); },
    onError: (e) => setMsg((e as Error).message),
  });

  const activar = useMutation({
    mutationFn: (id: string) => api(`/api/admin/concursos/${id}/activar`, "PATCH"),
    onSuccess: invalidate,
  });
  const cerrar = useMutation({
    mutationFn: (id: string) => api(`/api/admin/concursos/${id}/cerrar`, "POST"),
    onSuccess: invalidate,
  });

  const badge = (s: string) =>
    s === "active" ? "bg-emerald-100 text-emerald-700" : s === "closed" ? "bg-slate-200 text-slate-600" : "bg-amber-100 text-amber-700";

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <h1 className="text-2xl font-bold text-slate-900">🏆 Concursos</h1>

      {/* Crear */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <h2 className="font-bold mb-4">Nuevo concurso</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <input className="border rounded-lg px-3 py-2 min-h-11 sm:col-span-2" placeholder="Título (ej: Copa Reciclaje Empresas · Julio)"
            value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <input className="border rounded-lg px-3 py-2 min-h-11 sm:col-span-2" placeholder="Descripción corta"
            value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <select className="border rounded-lg px-3 py-2 min-h-11" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}>
            <option value="empresas">Compiten: empresas</option>
            <option value="equipos">Compiten: equipos</option>
            <option value="personas">Compiten: personas</option>
          </select>
          <select className="border rounded-lg px-3 py-2 min-h-11" value={form.metric} onChange={(e) => setForm({ ...form, metric: e.target.value })}>
            <option value="containers">Métrica: envases registrados</option>
            <option value="points">Métrica: puntos del período</option>
          </select>
          <label className="text-sm text-slate-600">Inicio
            <input type="datetime-local" className="border rounded-lg px-3 py-2 min-h-11 w-full" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
          </label>
          <label className="text-sm text-slate-600">Término
            <input type="datetime-local" className="border rounded-lg px-3 py-2 min-h-11 w-full" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
          </label>
          <input className="border rounded-lg px-3 py-2 min-h-11" placeholder="🥇 Premio 1º lugar" value={form.premio1} onChange={(e) => setForm({ ...form, premio1: e.target.value })} />
          <input className="border rounded-lg px-3 py-2 min-h-11" placeholder="🥈 Premio 2º lugar" value={form.premio2} onChange={(e) => setForm({ ...form, premio2: e.target.value })} />
          <input className="border rounded-lg px-3 py-2 min-h-11" placeholder="🥉 Premio 3º lugar" value={form.premio3} onChange={(e) => setForm({ ...form, premio3: e.target.value })} />
        </div>
        <button onClick={() => crear.mutate()} disabled={crear.isPending}
          className="mt-4 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-xl px-6 py-3 min-h-11">
          {crear.isPending ? "Creando…" : "Crear concurso"}
        </button>
        {msg && <p className="mt-2 text-sm font-medium text-slate-600">{msg}</p>}
      </div>

      {/* Lista */}
      <div className="space-y-3">
        {concursos.map((c) => (
          <div key={c.id} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <span className={`text-xs font-bold px-3 py-1 rounded-full ${badge(c.status)}`}>{c.status}</span>
              <h3 className="font-bold text-slate-900 flex-1">{c.title}</h3>
              <span className="text-xs text-slate-500">{c.scope} · {c.metric === "points" ? "puntos" : "envases"}</span>
            </div>
            <p className="text-sm text-slate-500 mt-1">
              {new Date(c.startDate).toLocaleString("es-CL")} → {new Date(c.endDate).toLocaleString("es-CL")}
            </p>
            {c.winners && c.winners.length > 0 && (
              <p className="mt-2 text-sm font-medium text-emerald-700">
                🥇 {c.winners[0].nombre} ({c.winners[0].total.toLocaleString("es-CL")})
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {c.status === "draft" && (
                <button onClick={() => activar.mutate(c.id)} className="bg-emerald-500 text-white text-sm font-bold rounded-lg px-4 py-2">Activar</button>
              )}
              {c.status === "active" && (
                <button onClick={() => cerrar.mutate(c.id)} className="bg-slate-900 text-white text-sm font-bold rounded-lg px-4 py-2">Cerrar y premiar</button>
              )}
              <a href={`/concurso/${c.id}`} target="_blank" rel="noreferrer" className="border text-sm font-bold rounded-lg px-4 py-2 text-slate-700">Ver página</a>
              <a href={`/api/concursos/${c.id}/qr`} download className="border text-sm font-bold rounded-lg px-4 py-2 text-slate-700">Descargar QR</a>
            </div>
          </div>
        ))}
        {concursos.length === 0 && <p className="text-slate-500 text-center py-6">Sin concursos aún. Crea el primero arriba.</p>}
      </div>
    </div>
  );
}
