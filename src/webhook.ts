import express from "express";
import { registerUiRoutes } from './ui-api.js';

const DEFAULT_PORT = 3001;

interface DispatchEntry {
  totalWorkers: number;
  completedWorkers: Set<string>;
  workflowResumeUrl: string;
}

// In-memory fan-in tracker — keyed by dispatchId
const dispatches = new Map<string, DispatchEntry>();

/**
 * Start the webhook HTTP server for Slack Workflow fan-in.
 *
 * POST /webhook/dispatch-complete
 *   Body: { dispatchId, workerChannel, success, totalWorkers, workflowResumeUrl }
 *
 * When all workers for a dispatchId have reported in, calls the
 * workflowResumeUrl to advance the Slack Workflow to the next step.
 *
 * POST /webhook/dispatch-register
 *   Body: { dispatchId, totalWorkers, workflowResumeUrl }
 *
 * Pre-registers a dispatch before workers start, so the fan-in
 * knows how many completions to wait for.
 */
export function startWebhookServer(port = DEFAULT_PORT): void {
  const app = express();
  app.use(express.json());

  registerUiRoutes(app);

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", dispatches: dispatches.size });
  });

  // Register a dispatch with expected worker count + workflow resume URL
  app.post("/webhook/dispatch-register", (req, res) => {
    const { dispatchId, totalWorkers, workflowResumeUrl } = req.body;

    if (!dispatchId || !totalWorkers || !workflowResumeUrl) {
      res.status(400).json({ error: "Missing dispatchId, totalWorkers, or workflowResumeUrl" });
      return;
    }

    dispatches.set(dispatchId, {
      totalWorkers,
      completedWorkers: new Set(),
      workflowResumeUrl,
    });

    console.log(`[webhook] Registered dispatch ${dispatchId} — expecting ${totalWorkers} worker(s)`);
    res.json({ ok: true });
  });

  // Worker completion report
  app.post("/webhook/dispatch-complete", async (req, res) => {
    const { dispatchId, workerChannel, success, totalWorkers, workflowResumeUrl } = req.body;

    if (!dispatchId || !workerChannel) {
      res.status(400).json({ error: "Missing dispatchId or workerChannel" });
      return;
    }

    // Auto-register if not pre-registered (single-worker case)
    if (!dispatches.has(dispatchId)) {
      if (!totalWorkers || !workflowResumeUrl) {
        res.status(400).json({ error: "Dispatch not registered — include totalWorkers and workflowResumeUrl" });
        return;
      }
      dispatches.set(dispatchId, {
        totalWorkers,
        completedWorkers: new Set(),
        workflowResumeUrl,
      });
    }

    const entry = dispatches.get(dispatchId)!;
    entry.completedWorkers.add(workerChannel);

    const completed = entry.completedWorkers.size;
    const total = entry.totalWorkers;
    console.log(`[webhook] Dispatch ${dispatchId}: ${workerChannel} reported ${success ? "✅" : "❌"} (${completed}/${total})`);

    res.json({ ok: true, completed, total });

    // Fan-in: all workers done — call Slack Workflow resume URL
    if (completed >= total) {
      console.log(`[webhook] Dispatch ${dispatchId} complete — calling workflow resume URL`);
      dispatches.delete(dispatchId);

      try {
        const response = await fetch(entry.workflowResumeUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dispatchId, status: "complete" }),
        });
        console.log(`[webhook] Workflow resume response: ${response.status}`);
      } catch (err) {
        console.error("[webhook] Failed to call workflow resume URL:", err instanceof Error ? err.message : err);
      }
    }
  });

  app.listen(port, () => {
    console.log(`  Webhook server: http://localhost:${port}`);
  });
}
