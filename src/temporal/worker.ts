/**
 * Temporal Worker — polls Temporal server for tasks and executes them.
 * Started automatically when Foreman boots.
 */

export async function startTemporalWorker(): Promise<void> {
  const { Worker } = await import('@temporalio/worker');
  const activities = await import('./activities.js');
  const worker = await Worker.create({
    workflowsPath: new URL('./workflows.js', import.meta.url).pathname,
    activities,
    taskQueue: 'foreman',
  });

  // Run in background — doesn't block Foreman's main process
  worker.run().catch((err) => {
    console.error('[Temporal] Worker error:', err);
  });

  console.log('[Temporal] Worker started on task queue: foreman');
}
