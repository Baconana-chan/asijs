# Scheduler / Cron

```typescript
import { scheduler, Scheduler, parseCron, matchesCron, schedules } from "asijs";

app.plugin(scheduler({
  jobs: [
    {
      name: "cleanup",
      schedule: schedules.daily,  // "0 0 * * *"
      handler: () => { /* cleanup logic */ },
    },
    {
      name: "health-check",
      schedule: "*/5 * * * *",  // Every 5 minutes
      handler: () => { /* ping services */ },
    },
  ],
}));
```

## Programmatic Scheduler

```typescript
const sched = new Scheduler({ verbose: true });

sched.addJob({
  name: "task",
  schedule: 5000,  // ms interval
  handler: () => console.log("Every 5 seconds"),
});

sched.listJobs();
sched.stop();
```

## Cron Helpers

```typescript
import { parseCron, matchesCron, getNextRun, interval, cron } from "asijs";

const parsed = parseCron("*/15 * * * *");  // Every 15 min
const now = new Date();
const willRun = matchesCron(now, parsed);  // true/false
const nextRun = getNextRun(parsed, now);   // Date object

// Job helpers
const job1 = interval("check", 5000, () => {});
const job2 = cron("report", "0 9 * * 1", () => {});  // Mondays 9am
```

## Presets

```typescript
schedules.everyMinute;  // "* * * * *"
schedules.hourly;       // "0 * * * *"
schedules.daily;        // "0 0 * * *"
schedules.weekly;       // "0 0 * * 0"
schedules.monthly;      // "0 0 1 * *"
```
