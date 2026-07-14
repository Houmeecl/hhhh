// ============================================================
// regira — Modo CONCURSO (Ley REP → concursos por mérito)
// Copiar a: shared/concursos.ts
// Tablas nuevas: contests + contest_participants. No modifica tablas existentes.
// ============================================================
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, json, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./schema";

// Un concurso: competencia por ranking en un período, con premios por posición.
export const contests = pgTable("contests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  // Quiénes compiten: empresas entre sí, equipos entre sí, o personas.
  scope: text("scope").notNull().default("empresas"), // 'empresas' | 'equipos' | 'personas'
  // Qué se mide en el período: envases contados o puntos otorgados.
  metric: text("metric").notNull().default("containers"), // 'containers' | 'points'
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  status: text("status").notNull().default("draft"), // 'draft' | 'active' | 'closed'
  // Premios por posición: [{ puesto: 1, descripcion: "..." }, ...]
  prizes: json("prizes").$type<{ puesto: number; descripcion: string }[]>().notNull().default([]),
  // Ganadores calculados al cierre: [{ puesto, refId, nombre, total }]
  winners: json("winners").$type<{ puesto: number; refId: string; nombre: string; total: number }[]>(),
  createdBy: varchar("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Inscripción al concurso (empresa, equipo o persona, según el scope).
export const contestParticipants = pgTable("contest_participants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contestId: varchar("contest_id").notNull().references(() => contests.id),
  kind: text("kind").notNull(), // 'company' | 'team' | 'user' (coherente con el scope)
  refId: varchar("ref_id").notNull(),
  name: text("name").notNull(), // snapshot del nombre para mostrar en el ranking
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("contest_participants_unique").on(t.contestId, t.kind, t.refId),
  byContest: index("contest_participants_contest_idx").on(t.contestId),
}));

export const insertContestSchema = createInsertSchema(contests).omit({
  id: true,
  status: true,
  winners: true,
  createdBy: true,
  createdAt: true,
}).extend({
  title: z.string().min(3, "El título es requerido"),
  scope: z.enum(["empresas", "equipos", "personas"]).default("empresas"),
  metric: z.enum(["containers", "points"]).default("containers"),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  prizes: z.array(z.object({ puesto: z.number().int().min(1), descripcion: z.string().min(1) })).default([]),
}).refine((d) => d.endDate > d.startDate, { message: "La fecha de término debe ser posterior al inicio" });

export type Contest = typeof contests.$inferSelect;
export type InsertContest = z.infer<typeof insertContestSchema>;
export type ContestParticipant = typeof contestParticipants.$inferSelect;
