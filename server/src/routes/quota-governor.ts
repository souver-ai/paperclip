import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { quotaGovernorService } from "../services/quota-governor.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";

export function quotaGovernorRoutes(db: Db) {
  const router = Router();
  const governor = quotaGovernorService(db);

  router.get("/companies/:companyId/quota-governor", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const result = await governor.latest(companyId);
    res.json(result);
  });

  router.post("/companies/:companyId/quota-governor/snapshots", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertBoard(req);
    const actor = getActorInfo(req);
    const result = await governor.createSnapshot(companyId, {
      actor: actor.actorId ?? actor.actorType,
      source: "quota-governor-api",
    });
    res.status(201).json(result);
  });

  return router;
}
