import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  createHarnessFindingSchema,
  createHarnessRunSchema,
  createFeatureSchema,
  createVerificationRunSchema,
  upsertTestCaseSchema,
  updateFeatureSchema,
  updateHarnessFindingSchema,
  updateRepoLockSchema,
  upsertRepoLockSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { deliveryControlService, logActivity } from "../services/index.js";

export function deliveryControlRoutes(db: Db) {
  const router = Router();
  const svc = deliveryControlService(db);

  router.get("/companies/:companyId/repo-locks", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await svc.listRepoLocks(companyId));
  });

  router.get("/companies/:companyId/agent-throughput", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await svc.listAgentThroughput(companyId));
  });

  router.get("/companies/:companyId/features", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await svc.listFeatures(companyId));
  });

  router.post("/companies/:companyId/features", validate(createFeatureSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const feature = await svc.createFeature(companyId, req.body);
    if (!feature) {
      res.status(422).json({ error: "Invalid feature payload" });
      return;
    }
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "delivery.feature_created",
      entityType: "feature",
      entityId: feature.id,
      details: { featureId: feature.featureId, intakeStatus: feature.intakeStatus, priorityRank: feature.priorityRank },
    });
    res.status(201).json(feature);
  });

  router.post("/companies/:companyId/features/backfill-from-issues", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const result = await svc.backfillFeaturesFromIssues(companyId);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "delivery.features_backfilled",
      entityType: "feature",
      entityId: companyId,
      details: { created: result.created, updated: result.updated, skipped: result.skipped },
    });
    res.status(201).json(result);
  });

  router.patch("/features/:id", validate(updateFeatureSchema), async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getFeature(id);
    if (!existing) {
      res.status(404).json({ error: "Feature not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    const actor = getActorInfo(req);
    const feature = await svc.updateFeature(id, req.body, actor.actorId ?? actor.agentId ?? null);
    if (!feature) {
      res.status(404).json({ error: "Feature not found" });
      return;
    }
    await logActivity(db, {
      companyId: feature.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "delivery.feature_updated",
      entityType: "feature",
      entityId: feature.id,
      details: { changedKeys: Object.keys(req.body).sort(), intakeStatus: feature.intakeStatus, priorityRank: feature.priorityRank },
    });
    res.json(feature);
  });

  router.get("/companies/:companyId/auto-merge-candidates", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await svc.listAutoMergeCandidates(companyId));
  });

  router.post("/companies/:companyId/repo-locks", validate(upsertRepoLockSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const lock = await svc.upsertRepoLock(companyId, req.body);
    if (!lock) {
      res.status(422).json({ error: "Invalid repo lock payload" });
      return;
    }
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "delivery.repo_lock_upserted",
      entityType: "repo_lock",
      entityId: lock.id,
      details: { repo: lock.repo, state: lock.state, activeIssueId: lock.activeIssueId },
    });
    res.status(201).json(lock);
  });

  router.patch("/repo-locks/:id", validate(updateRepoLockSchema), async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getRepoLock(id);
    if (!existing) {
      res.status(404).json({ error: "Repo lock not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    const actor = getActorInfo(req);
    const lock = await svc.updateRepoLock(id, req.body);
    if (!lock) {
      res.status(404).json({ error: "Repo lock not found" });
      return;
    }
    await logActivity(db, {
      companyId: lock.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "delivery.repo_lock_updated",
      entityType: "repo_lock",
      entityId: lock.id,
      details: { repo: lock.repo, state: lock.state, changedKeys: Object.keys(req.body).sort() },
    });
    res.json(lock);
  });

  router.get("/companies/:companyId/verification-runs", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await svc.listVerificationRuns(companyId));
  });

  router.get("/companies/:companyId/test-cases", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await svc.listTestCases(companyId));
  });

  router.post("/companies/:companyId/test-cases/backfill-souver", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const result = await svc.backfillSouverTestCases(companyId);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "delivery.test_cases_backfilled",
      entityType: "test_case",
      entityId: companyId,
      details: {
        imported: result.imported,
        created: result.created,
        updated: result.updated,
        byRepo: result.byRepo,
        byType: result.byType,
        byLastStatus: result.byLastStatus,
      },
    });
    res.status(201).json(result);
  });

  router.post("/companies/:companyId/test-cases", validate(upsertTestCaseSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const result = await svc.upsertTestCases(companyId, [req.body]);
    const testCase = result.tests[0] ?? null;
    if (!testCase) {
      res.status(422).json({ error: "Invalid test case payload" });
      return;
    }
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "delivery.test_case_upserted",
      entityType: "test_case",
      entityId: testCase.id,
      details: { stableKey: testCase.stableKey, repo: testCase.repo, type: testCase.type, status: testCase.status },
    });
    res.status(result.created > 0 ? 201 : 200).json(testCase);
  });

  router.post("/companies/:companyId/verification-runs", validate(createVerificationRunSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const run = await svc.createVerificationRun(companyId, req.body);
    if (!run) {
      res.status(422).json({ error: "Invalid verification run payload" });
      return;
    }
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "delivery.verification_run_created",
      entityType: "verification_run",
      entityId: run.id,
      details: { issueId: run.issueId, repo: run.repo, type: run.type, status: run.status },
    });
    res.status(201).json(run);
  });

  router.get("/companies/:companyId/harness-runs", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await svc.listHarnessRuns(companyId));
  });

  router.post("/companies/:companyId/harness-runs", validate(createHarnessRunSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const run = await svc.createHarnessRun(companyId, req.body);
    if (!run) {
      res.status(422).json({ error: "Invalid harness run payload" });
      return;
    }
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "delivery.harness_run_created",
      entityType: "harness_run",
      entityId: run.id,
      details: { issueId: run.issueId, experimentId: run.experimentId, status: run.status },
    });
    res.status(201).json(run);
  });

  router.get("/companies/:companyId/harness-items", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await svc.listHarnessItems(companyId));
  });

  router.post("/companies/:companyId/harness-items/backfill-from-issues", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const result = await svc.backfillHarnessItemsFromIssues(companyId);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "delivery.harness_items_backfilled",
      entityType: "harness_item",
      entityId: companyId,
      details: { created: result.created, updated: result.updated, skipped: result.skipped },
    });
    res.status(201).json(result);
  });

  router.get("/companies/:companyId/harness-findings", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await svc.listHarnessFindings(companyId));
  });

  router.post("/companies/:companyId/harness-findings", validate(createHarnessFindingSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const finding = await svc.createHarnessFinding(companyId, req.body);
    if (!finding) {
      res.status(422).json({ error: "Invalid harness finding payload" });
      return;
    }
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "delivery.harness_finding_created",
      entityType: "harness_finding",
      entityId: finding.id,
      details: { issueId: finding.issueId, harnessRunId: finding.harnessRunId, severity: finding.severity },
    });
    res.status(201).json(finding);
  });

  router.patch("/harness-findings/:id", validate(updateHarnessFindingSchema), async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getHarnessFinding(id);
    if (!existing) {
      res.status(404).json({ error: "Harness finding not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    const actor = getActorInfo(req);
    const finding = await svc.updateHarnessFinding(id, req.body);
    if (!finding) {
      res.status(404).json({ error: "Harness finding not found" });
      return;
    }
    await logActivity(db, {
      companyId: finding.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "delivery.harness_finding_updated",
      entityType: "harness_finding",
      entityId: finding.id,
      details: { status: finding.status, changedKeys: Object.keys(req.body).sort() },
    });
    res.json(finding);
  });

  return router;
}
