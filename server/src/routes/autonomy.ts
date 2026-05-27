import { Router } from "express";
import type { Db } from "@paperclipai/db";
import type { AutonomyPeriodKey } from "@paperclipai/shared";
import { autonomyService } from "../services/autonomy.js";
import { assertCompanyAccess } from "./authz.js";

const VALID_PERIODS = new Set<AutonomyPeriodKey>(["24h", "7d", "30d"]);

export function autonomyRoutes(db: Db) {
  const router = Router();
  const svc = autonomyService(db);

  // Read-only Paperclip autonomy telemetry (24/7 coverage, incidents, per-agent).
  router.get("/companies/:companyId/autonomy", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const raw = (req.query.period as string) ?? "24h";
    const period = (VALID_PERIODS.has(raw as AutonomyPeriodKey) ? raw : "24h") as AutonomyPeriodKey;
    res.json(await svc.report(companyId, period));
  });

  return router;
}
