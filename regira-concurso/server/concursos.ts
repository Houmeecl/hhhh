// ============================================================
// regira — Modo CONCURSO · rutas de API
// Copiar a: server/concursos.ts
// Montaje (en server/routes.ts, dentro de registerRoutes):
//   import { registerConcursoRoutes } from "./concursos";
//   registerConcursoRoutes(app);
// ============================================================
import type { Express, Request, Response, NextFunction } from "express";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, and, gte, lte, inArray, sql } from "drizzle-orm";
import QRCode from "qrcode";
import * as schema from "@shared/schema";
import { contests, contestParticipants, insertContestSchema } from "@shared/concursos";
import { storage } from "./storage";

const db = drizzle(neon(process.env.DATABASE_URL!));

// ---------- Guards de sesión (mismo modelo que el resto de la app) ----------
function sessionUserId(req: Request): string | undefined {
  return (req as any).session?.userId;
}

async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const userId = sessionUserId(req);
  if (!userId) return res.status(401).json({ message: "No autenticado" });
  (req as any).currentUser = await storage.getUser(userId);
  if (!(req as any).currentUser) return res.status(401).json({ message: "Sesión inválida" });
  next();
}

async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  await requireAuth(req, res, async () => {
    const user = (req as any).currentUser;
    if (user.role !== "admin") return res.status(403).json({ message: "Solo administradores" });
    next();
  });
}

// ---------- Ranking del período ----------
// Suma envases (o puntos) SOLO dentro de [startDate, endDate], agrupado según el scope,
// y SOLO entre inscritos. Desempate: quien se inscribió primero.
async function computeLeaderboard(contest: typeof contests.$inferSelect) {
  const participants = await db.select().from(contestParticipants)
    .where(eq(contestParticipants.contestId, contest.id));
  if (participants.length === 0) return [];

  const ids = participants.map((p) => p.refId);
  const isPoints = contest.metric === "points";
  const total = isPoints
    ? sql<number>`coalesce(sum(${schema.containers.pointsAwarded}), 0)::int`
    : sql<number>`count(*)::int`;

  const scopeCol = contest.scope === "empresas"
    ? schema.users.companyId
    : contest.scope === "equipos"
      ? schema.users.teamId
      : schema.containers.userId;

  const rows = await db.select({ refId: scopeCol, total })
    .from(schema.containers)
    .innerJoin(schema.users, eq(schema.containers.userId, schema.users.id))
    .where(and(
      gte(schema.containers.createdAt, contest.startDate),
      lte(schema.containers.createdAt, contest.endDate),
      inArray(scopeCol, ids),
    ))
    .groupBy(scopeCol);

  const totals = new Map(rows.map((r) => [r.refId as string, r.total]));
  return participants
    .map((p) => ({ refId: p.refId, nombre: p.name, total: totals.get(p.refId) ?? 0, joinedAt: p.joinedAt }))
    .sort((a, b) => b.total - a.total || a.joinedAt.getTime() - b.joinedAt.getTime())
    .map((r, i) => ({ puesto: i + 1, refId: r.refId, nombre: r.nombre, total: r.total }));
}

export function registerConcursoRoutes(app: Express) {
  // ---------- Público ----------
  app.get("/api/concursos", async (_req, res) => {
    const rows = await db.select().from(contests)
      .where(inArray(contests.status, ["active", "closed"]));
    res.json(rows);
  });

  // Detalle + ranking en vivo. Es la página que abre el QR.
  app.get("/api/concursos/:id", async (req, res) => {
    const [contest] = await db.select().from(contests).where(eq(contests.id, req.params.id));
    if (!contest || contest.status === "draft") return res.status(404).json({ message: "Concurso no encontrado" });
    const leaderboard = contest.status === "closed" && contest.winners
      ? contest.winners
      : await computeLeaderboard(contest);
    res.json({ ...contest, leaderboard });
  });

  // QR del concurso (apunta a la página pública /concurso/:id).
  app.get("/api/concursos/:id/qr", async (req, res) => {
    const [contest] = await db.select().from(contests).where(eq(contests.id, req.params.id));
    if (!contest) return res.status(404).json({ message: "Concurso no encontrado" });
    const base = process.env.APP_URL || `${req.protocol}://${req.get("host")}`;
    const png = await QRCode.toBuffer(`${base}/concurso/${contest.id}`, { width: 512, margin: 1 });
    res.type("png").send(png);
  });

  // Inscribirse (empresa/equipo/persona según el scope del concurso).
  app.post("/api/concursos/:id/inscribir", requireAuth, async (req, res) => {
    const user = (req as any).currentUser;
    const [contest] = await db.select().from(contests).where(eq(contests.id, req.params.id));
    if (!contest || contest.status !== "active") return res.status(400).json({ message: "El concurso no está activo" });

    let kind: string, refId: string | null, name: string;
    if (contest.scope === "empresas") {
      kind = "company"; refId = user.companyId;
      if (!refId) return res.status(400).json({ message: "Tu cuenta no tiene empresa asociada" });
      const company = await storage.getCompany(refId);
      name = company?.name ?? "Empresa";
    } else if (contest.scope === "equipos") {
      kind = "team"; refId = user.teamId;
      if (!refId) return res.status(400).json({ message: "Únete a un equipo para participar" });
      const team = await storage.getTeam(refId);
      name = team?.name ?? "Equipo";
    } else {
      kind = "user"; refId = user.id; name = user.name;
    }

    const existing = await db.select().from(contestParticipants).where(and(
      eq(contestParticipants.contestId, contest.id),
      eq(contestParticipants.kind, kind),
      eq(contestParticipants.refId, refId),
    ));
    if (existing.length > 0) return res.status(409).json({ message: "Ya estás inscrito en este concurso" });

    await db.insert(contestParticipants).values({ contestId: contest.id, kind, refId, name });
    res.status(201).json({ message: "¡Inscripción lista! A competir 🏆" });
  });

  // ---------- Admin ----------
  app.get("/api/admin/concursos", requireAdmin, async (_req, res) => {
    res.json(await db.select().from(contests));
  });

  app.post("/api/admin/concursos", requireAdmin, async (req, res) => {
    const parsed = insertContestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Datos inválidos" });
    const user = (req as any).currentUser;
    const [created] = await db.insert(contests)
      .values({ ...parsed.data, createdBy: user.id })
      .returning();
    res.status(201).json(created);
  });

  app.patch("/api/admin/concursos/:id/activar", requireAdmin, async (req, res) => {
    await db.update(contests).set({ status: "active" }).where(eq(contests.id, req.params.id));
    res.json({ message: "Concurso activado" });
  });

  // Cierre por mérito: calcula el ranking final, guarda ganadores y notifica.
  app.post("/api/admin/concursos/:id/cerrar", requireAdmin, async (req, res) => {
    const [contest] = await db.select().from(contests).where(eq(contests.id, req.params.id));
    if (!contest) return res.status(404).json({ message: "Concurso no encontrado" });
    if (contest.status === "closed") return res.status(409).json({ message: "Ya está cerrado" });

    const leaderboard = await computeLeaderboard(contest);
    const winners = leaderboard.slice(0, Math.max(contest.prizes.length, 3));
    await db.update(contests).set({ status: "closed", winners }).where(eq(contests.id, contest.id));

    const user = (req as any).currentUser;
    if (winners[0]) {
      await storage.createNotification({
        title: `🏆 Resultados: ${contest.title}`,
        message: `1º lugar: ${winners[0].nombre} con ${winners[0].total} ${contest.metric === "points" ? "puntos" : "envases"}. ¡Gracias a todos por participar!`,
        type: "general",
        createdBy: user.id,
      });
    }
    res.json({ message: "Concurso cerrado", winners });
  });
}
