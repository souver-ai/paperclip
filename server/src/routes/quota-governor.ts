import { Router } from "express";
import { loadLatestQuotaGovernorSnapshot } from "../services/quota-governor.js";
import { assertCompanyAccess } from "./authz.js";

export function quotaGovernorRoutes() {
  const router = Router();

  // Read-only: surfaces the latest Paperclip quota-governor report snapshot.
  // The report itself is produced by the ops/paperclip reporter on disk; this
  // route never mutates cadences (that is SOU-1181 governor scope).
  router.get("/companies/:companyId/quota-governor", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const result = await loadLatestQuotaGovernorSnapshot();
    res.json(result);
  });

  return router;
}
