/**
 * Example: Background Tasks with Cron Scheduler
 * 
 * Demonstrates:
 * - Scheduler for background jobs
 * - Cron expressions
 * - Interval-based tasks
 * - Graceful shutdown
 * 
 * Run: bun run examples/scheduler.ts
 */

import { 
  Asi, 
  Scheduler,
  cron,
  interval,
  schedules,
  lifecycle,
} from "../src";

const app = new Asi({ development: true });

// Enable graceful shutdown
app.plugin(lifecycle({ verbose: true }));

// Create scheduler
const scheduler = new Scheduler({ verbose: true });

// ===== Background Tasks =====

// Task 1: Every minute - cleanup old data
scheduler.addJob(cron("cleanup", schedules.everyMinute, async () => {
  console.log("🧹 Running cleanup task...");
  // Simulate cleanup work
  await new Promise(r => setTimeout(r, 100));
  console.log("✅ Cleanup complete");
}));

// Task 2: Every 5 seconds - health ping
scheduler.addJob(interval("health-ping", 5000, () => {
  console.log("💓 Health ping at", new Date().toLocaleTimeString());
}));

// Task 3: Every hour - generate report
scheduler.addJob({
  name: "hourly-report",
  schedule: schedules.hourly,
  handler: async () => {
    console.log("📊 Generating hourly report...");
    // Simulate report generation
    await new Promise(r => setTimeout(r, 500));
    console.log("📊 Report generated!");
  },
  retry: {
    attempts: 3,
    delay: 1000,
  },
});

// Task 4: Daily at midnight - database backup
scheduler.addJob({
  name: "daily-backup",
  schedule: "0 0 * * *", // At 00:00 every day
  handler: async () => {
    console.log("💾 Starting daily backup...");
    await new Promise(r => setTimeout(r, 1000));
    console.log("💾 Backup complete!");
  },
});

// ===== API Routes =====

app.get("/", () => ({
  message: "Scheduler Example",
  jobs: scheduler.listJobs().map(j => ({
    name: j.name,
    schedule: j.schedule,
    lastRun: j.lastRun,
    nextRun: j.nextRun,
  })),
}));

app.get("/jobs", () => {
  return scheduler.listJobs().map(j => ({
    name: j.name,
    schedule: typeof j.schedule === "number" 
      ? `Every ${j.schedule}ms` 
      : j.schedule,
    running: j.running,
    lastRun: j.lastRun,
    nextRun: j.nextRun,
    runCount: j.runCount,
  }));
});

app.post("/jobs/:name/run", async (ctx) => {
  const job = scheduler.getJob(ctx.params.name);
  
  if (!job) {
    return ctx.status(404).jsonResponse({ error: "Job not found" });
  }
  
  // Run immediately
  await job.run();
  
  return {
    message: `Job ${job.name} executed`,
    runCount: job.runCount,
  };
});

app.delete("/jobs/:name", (ctx) => {
  const removed = scheduler.removeJob(ctx.params.name);
  
  if (!removed) {
    return ctx.status(404).jsonResponse({ error: "Job not found" });
  }
  
  return { message: `Job ${ctx.params.name} removed` };
});

// ===== Start =====

// Start scheduler
scheduler.start();

// Handle shutdown
process.on("SIGINT", async () => {
  console.log("\n⏳ Stopping scheduler...");
  await scheduler.stop();
  process.exit(0);
});

app.listen(3000, () => {
  console.log("\n📚 Scheduler is running!");
  console.log("   Jobs:");
  for (const job of scheduler.listJobs()) {
    console.log(`   - ${job.name}: ${job.schedule}`);
  }
  console.log("");
  console.log("📚 Try these commands:");
  console.log("  curl http://localhost:3000/jobs");
  console.log("  curl -X POST http://localhost:3000/jobs/health-ping/run");
  console.log("");
});
