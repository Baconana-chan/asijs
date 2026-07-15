import { describe, expect, it } from "bun:test";
import { Scheduler, cron, getNextRun, interval, parseCron } from "../src";

describe("scheduler.ts", () => {
  it("parseCron() handles expressions and shortcuts", () => {
    const weekdayMorning = parseCron("0 9 * * 1-5");
    const hourly = parseCron("@hourly");

    expect(weekdayMorning.minute.values).toEqual([0]);
    expect(weekdayMorning.hour.values).toEqual([9]);
    expect(weekdayMorning.dayOfWeek.values).toEqual([1, 2, 3, 4, 5]);
    expect(hourly.minute.values).toEqual([0]);
  });

  it("getNextRun() finds the next matching occurrence", () => {
    const parsed = parseCron("0 * * * *");
    const next = getNextRun(parsed, new Date("2026-04-30T10:15:00"));

    expect(next.getHours()).toBe(11);
    expect(next.getMinutes()).toBe(0);
  });

  it("interval() and cron() create jobs with the expected schedule", () => {
    expect(interval("heartbeat", 5000, () => undefined)).toMatchObject({
      name: "heartbeat",
      schedule: 5000,
    });
    expect(cron("daily", "0 0 * * *", () => undefined)).toMatchObject({
      name: "daily",
      schedule: "0 0 * * *",
    });
  });

  it("Scheduler retries failed jobs when retry is configured", async () => {
    const scheduler = new Scheduler({ verbose: false });
    let attempts = 0;

    scheduler.addJob({
      name: "retry-once",
      schedule: 60_000,
      retry: { attempts: 1, delay: 10 },
      handler: async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error("temporary failure");
        }
      },
    });

    await scheduler.runNow("retry-once");
    await new Promise((resolve) => setTimeout(resolve, 40));

    const status = scheduler.getJobStatus("retry-once");
    scheduler.stop();

    expect(attempts).toBe(2);
    expect(status?.lastResult).toBe("success");
    expect(status?.errorCount).toBe(1);
    expect(status?.runCount).toBe(1);
  });
});
