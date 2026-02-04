/**
 * Background Tasks & Cron Scheduling for AsiJS
 * 
 * Simple task scheduling with cron syntax and graceful shutdown support.
 * 
 * @example
 * ```ts
 * import { Asi, scheduler } from "asijs";
 * 
 * const app = new Asi();
 * 
 * app.plugin(scheduler({
 *   jobs: [
 *     {
 *       name: "cleanup",
 *       schedule: "0 3 * * *", // Every day at 3 AM
 *       handler: async () => {
 *         await cleanupOldData();
 *       }
 *     },
 *     {
 *       name: "healthCheck",
 *       schedule: "0/5 * * * *", // Every 5 minutes
 *       handler: async () => {
 *         await checkExternalServices();
 *       }
 *     }
 *   ]
 * }));
 * 
 * // Or add jobs dynamically
 * const sched = app.getDecorator<Scheduler>("scheduler");
 * sched.addJob({
 *   name: "report",
 *   schedule: "0 9 * * 1", // Every Monday at 9 AM
 *   handler: generateWeeklyReport
 * });
 * ```
 */

import { createPlugin, type AsiPlugin } from "./plugin";

// ===== Types =====

export type CronExpression = string;

export interface Job {
  /** Unique job name */
  name: string;
  
  /** Cron expression or interval in ms */
  schedule: CronExpression | number;
  
  /** Job handler */
  handler: () => void | Promise<void>;
  
  /** Whether job is enabled */
  enabled?: boolean;
  
  /** Run immediately on startup */
  runOnStart?: boolean;
  
  /** Timezone (not implemented, uses local) */
  timezone?: string;
  
  /** Maximum execution time in ms */
  timeout?: number;
  
  /** Retry on failure */
  retry?: {
    attempts: number;
    delay: number;
  };
}

export interface JobStatus {
  name: string;
  lastRun: Date | null;
  lastResult: "success" | "error" | "timeout" | null;
  lastError: Error | null;
  nextRun: Date | null;
  runCount: number;
  errorCount: number;
  isRunning: boolean;
}

export interface SchedulerOptions {
  /** Jobs to schedule */
  jobs?: Job[];
  
  /** Enable logging */
  verbose?: boolean;
  
  /** Global error handler */
  onError?: (job: Job, error: Error) => void | Promise<void>;
  
  /** Callback when job completes */
  onComplete?: (job: Job, duration: number) => void | Promise<void>;
}

// ===== Cron Parser =====

interface CronField {
  values: number[];
  step?: number;
}

interface ParsedCron {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

const CRON_RANGES: Record<string, [number, number]> = {
  minute: [0, 59],
  hour: [0, 23],
  dayOfMonth: [1, 31],
  month: [1, 12],
  dayOfWeek: [0, 6],
};

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const DAY_NAMES: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

/**
 * Parse a single cron field
 */
function parseCronField(
  field: string, 
  min: number, 
  max: number,
  names?: Record<string, number>
): CronField {
  // Replace names with numbers
  if (names) {
    field = field.toLowerCase();
    for (const [name, value] of Object.entries(names)) {
      field = field.replace(new RegExp(name, "gi"), String(value));
    }
  }
  
  // Handle wildcards
  if (field === "*") {
    return { values: range(min, max) };
  }
  
  // Handle step values (*/5 or 1-10/2)
  const stepMatch = field.match(/^(.+)\/(\d+)$/);
  let baseField = field;
  let step: number | undefined;
  
  if (stepMatch) {
    baseField = stepMatch[1];
    step = parseInt(stepMatch[2], 10);
  }
  
  let values: number[] = [];
  
  // Handle * with step
  if (baseField === "*") {
    values = range(min, max);
  }
  // Handle ranges (1-5)
  else if (baseField.includes("-")) {
    const [start, end] = baseField.split("-").map(Number);
    values = range(start, end);
  }
  // Handle lists (1,3,5)
  else if (baseField.includes(",")) {
    values = baseField.split(",").map(Number);
  }
  // Single value
  else {
    values = [parseInt(baseField, 10)];
  }
  
  // Apply step
  if (step) {
    values = values.filter((_, i) => i % step! === 0);
  }
  
  return { values, step };
}

/**
 * Parse cron expression
 */
export function parseCron(expression: string): ParsedCron {
  // Handle common shortcuts
  const shortcuts: Record<string, string> = {
    "@yearly": "0 0 1 1 *",
    "@annually": "0 0 1 1 *",
    "@monthly": "0 0 1 * *",
    "@weekly": "0 0 * * 0",
    "@daily": "0 0 * * *",
    "@midnight": "0 0 * * *",
    "@hourly": "0 * * * *",
  };
  
  if (shortcuts[expression]) {
    expression = shortcuts[expression];
  }
  
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: ${expression}. Expected 5 fields.`);
  }
  
  return {
    minute: parseCronField(parts[0], ...CRON_RANGES.minute),
    hour: parseCronField(parts[1], ...CRON_RANGES.hour),
    dayOfMonth: parseCronField(parts[2], ...CRON_RANGES.dayOfMonth),
    month: parseCronField(parts[3], ...CRON_RANGES.month, MONTH_NAMES),
    dayOfWeek: parseCronField(parts[4], ...CRON_RANGES.dayOfWeek, DAY_NAMES),
  };
}

/**
 * Generate range of numbers
 */
function range(start: number, end: number): number[] {
  const result: number[] = [];
  for (let i = start; i <= end; i++) {
    result.push(i);
  }
  return result;
}

/**
 * Check if a date matches the cron expression
 */
export function matchesCron(date: Date, cron: ParsedCron): boolean {
  const minute = date.getMinutes();
  const hour = date.getHours();
  const dayOfMonth = date.getDate();
  const month = date.getMonth() + 1;
  const dayOfWeek = date.getDay();
  
  return (
    cron.minute.values.includes(minute) &&
    cron.hour.values.includes(hour) &&
    cron.dayOfMonth.values.includes(dayOfMonth) &&
    cron.month.values.includes(month) &&
    cron.dayOfWeek.values.includes(dayOfWeek)
  );
}

/**
 * Get next run time for a cron expression
 */
export function getNextRun(cron: ParsedCron, from: Date = new Date()): Date {
  const next = new Date(from);
  next.setSeconds(0);
  next.setMilliseconds(0);
  
  // Start from next minute
  next.setMinutes(next.getMinutes() + 1);
  
  // Find next matching time (max 2 years ahead)
  const maxIterations = 365 * 24 * 60 * 2;
  
  for (let i = 0; i < maxIterations; i++) {
    if (matchesCron(next, cron)) {
      return next;
    }
    next.setMinutes(next.getMinutes() + 1);
  }
  
  throw new Error("Could not find next run time within 2 years");
}

// ===== Scheduler =====

export class Scheduler {
  private jobs: Map<string, Job> = new Map();
  private intervals: Map<string, Timer> = new Map();
  private timeouts: Map<string, Timer> = new Map();
  private status: Map<string, JobStatus> = new Map();
  private isRunning = false;
  private options: SchedulerOptions;
  private cronTimers: Map<string, Timer> = new Map();
  
  constructor(options: SchedulerOptions = {}) {
    this.options = options;
    
    if (options.jobs) {
      for (const job of options.jobs) {
        this.addJob(job);
      }
    }
  }
  
  /**
   * Add a job to the scheduler
   */
  addJob(job: Job): void {
    if (this.jobs.has(job.name)) {
      throw new Error(`Job "${job.name}" already exists`);
    }
    
    this.jobs.set(job.name, job);
    this.status.set(job.name, {
      name: job.name,
      lastRun: null,
      lastResult: null,
      lastError: null,
      nextRun: null,
      runCount: 0,
      errorCount: 0,
      isRunning: false,
    });
    
    if (this.isRunning) {
      this.scheduleJob(job);
    }
  }
  
  /**
   * Remove a job from the scheduler
   */
  removeJob(name: string): boolean {
    const job = this.jobs.get(name);
    if (!job) return false;
    
    this.stopJob(name);
    this.jobs.delete(name);
    this.status.delete(name);
    
    return true;
  }
  
  /**
   * Start the scheduler
   */
  start(): void {
    if (this.isRunning) return;
    
    this.isRunning = true;
    
    if (this.options.verbose) {
      console.log("📅 Scheduler started");
    }
    
    for (const job of this.jobs.values()) {
      if (job.enabled !== false) {
        this.scheduleJob(job);
      }
    }
  }
  
  /**
   * Stop the scheduler
   */
  stop(): void {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    
    // Clear all intervals
    for (const interval of this.intervals.values()) {
      clearInterval(interval);
    }
    this.intervals.clear();
    
    // Clear all timeouts
    for (const timeout of this.timeouts.values()) {
      clearTimeout(timeout);
    }
    this.timeouts.clear();
    
    // Clear cron timers
    for (const timer of this.cronTimers.values()) {
      clearTimeout(timer);
    }
    this.cronTimers.clear();
    
    if (this.options.verbose) {
      console.log("📅 Scheduler stopped");
    }
  }
  
  /**
   * Stop a specific job
   */
  private stopJob(name: string): void {
    const interval = this.intervals.get(name);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(name);
    }
    
    const timeout = this.timeouts.get(name);
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(name);
    }
    
    const cronTimer = this.cronTimers.get(name);
    if (cronTimer) {
      clearTimeout(cronTimer);
      this.cronTimers.delete(name);
    }
  }
  
  /**
   * Schedule a single job
   */
  private scheduleJob(job: Job): void {
    // Run on start if configured
    if (job.runOnStart) {
      this.executeJob(job);
    }
    
    if (typeof job.schedule === "number") {
      // Simple interval
      const interval = setInterval(() => {
        this.executeJob(job);
      }, job.schedule);
      this.intervals.set(job.name, interval);
      
      // Update next run
      const status = this.status.get(job.name);
      if (status) {
        status.nextRun = new Date(Date.now() + job.schedule);
      }
    } else {
      // Cron expression
      this.scheduleCronJob(job);
    }
  }
  
  /**
   * Schedule a job with cron expression
   */
  private scheduleCronJob(job: Job): void {
    if (typeof job.schedule === "number") return;
    
    const cron = parseCron(job.schedule);
    const nextRun = getNextRun(cron);
    const delay = nextRun.getTime() - Date.now();
    
    // Update status
    const status = this.status.get(job.name);
    if (status) {
      status.nextRun = nextRun;
    }
    
    if (this.options.verbose) {
      console.log(`📅 Job "${job.name}" scheduled for ${nextRun.toISOString()}`);
    }
    
    // Schedule execution
    const timeout = setTimeout(() => {
      this.executeJob(job);
      
      // Reschedule for next occurrence
      if (this.isRunning && job.enabled !== false) {
        this.scheduleCronJob(job);
      }
    }, delay);
    
    this.cronTimers.set(job.name, timeout);
  }
  
  /**
   * Execute a job
   */
  private async executeJob(job: Job): Promise<void> {
    const status = this.status.get(job.name)!;
    
    if (status.isRunning) {
      if (this.options.verbose) {
        console.log(`⏭️ Job "${job.name}" skipped (already running)`);
      }
      return;
    }
    
    status.isRunning = true;
    const startTime = Date.now();
    
    if (this.options.verbose) {
      console.log(`▶️ Job "${job.name}" started`);
    }
    
    try {
      // Create timeout promise if configured
      let result: Promise<void>;
      
      if (job.timeout) {
        result = Promise.race([
          job.handler(),
          new Promise<void>((_, reject) => {
            setTimeout(() => reject(new Error("Job timeout")), job.timeout);
          }),
        ]);
      } else {
        result = Promise.resolve(job.handler());
      }
      
      await result;
      
      status.lastResult = "success";
      status.lastError = null;
      status.runCount++;
      
      const duration = Date.now() - startTime;
      
      if (this.options.verbose) {
        console.log(`✅ Job "${job.name}" completed in ${duration}ms`);
      }
      
      if (this.options.onComplete) {
        await this.options.onComplete(job, duration);
      }
    } catch (error) {
      const err = error as Error;
      
      if (err.message === "Job timeout") {
        status.lastResult = "timeout";
      } else {
        status.lastResult = "error";
      }
      
      status.lastError = err;
      status.errorCount++;
      
      if (this.options.verbose) {
        console.error(`❌ Job "${job.name}" failed:`, err.message);
      }
      
      if (this.options.onError) {
        await this.options.onError(job, err);
      }
      
      // Retry if configured
      if (job.retry && status.errorCount <= job.retry.attempts) {
        const retryNum = status.errorCount;
        if (this.options.verbose) {
          console.log(`🔄 Job "${job.name}" retry ${retryNum}/${job.retry.attempts} in ${job.retry.delay}ms`);
        }
        
        setTimeout(() => {
          this.executeJob(job);
        }, job.retry.delay);
      }
    } finally {
      status.isRunning = false;
      status.lastRun = new Date();
    }
  }
  
  /**
   * Run a job immediately
   */
  async runNow(name: string): Promise<void> {
    const job = this.jobs.get(name);
    if (!job) {
      throw new Error(`Job "${name}" not found`);
    }
    await this.executeJob(job);
  }
  
  /**
   * Get status of all jobs
   */
  getStatus(): Map<string, JobStatus> {
    return new Map(this.status);
  }
  
  /**
   * Get status of a specific job
   */
  getJobStatus(name: string): JobStatus | undefined {
    return this.status.get(name);
  }
  
  /**
   * Enable a job
   */
  enableJob(name: string): void {
    const job = this.jobs.get(name);
    if (job) {
      job.enabled = true;
      if (this.isRunning) {
        this.scheduleJob(job);
      }
    }
  }
  
  /**
   * Disable a job
   */
  disableJob(name: string): void {
    const job = this.jobs.get(name);
    if (job) {
      job.enabled = false;
      this.stopJob(name);
    }
  }
  
  /**
   * List all registered jobs
   */
  listJobs(): Job[] {
    return Array.from(this.jobs.values());
  }
}

// ===== Scheduler Plugin =====

/**
 * Create scheduler plugin
 */
export function scheduler(options: SchedulerOptions = {}): AsiPlugin {
  const sched = new Scheduler(options);
  
  return createPlugin({
    name: "scheduler",
    
    setup(app) {
      // Auto-start scheduler
      sched.start();
      
      // Register shutdown handler if lifecycle plugin is available
      const lifecycleManager = app.getState("lifecycleManager");
      if (lifecycleManager && typeof (lifecycleManager as any).onShutdown === "function") {
        (lifecycleManager as any).onShutdown(() => {
          sched.stop();
        });
      }
    },
    
    decorate: {
      scheduler: sched,
      schedule: (job: Job) => sched.addJob(job),
      unschedule: (name: string) => sched.removeJob(name),
    },
  });
}

// ===== Convenience Functions =====

/**
 * Create a simple interval job
 */
export function interval(
  name: string, 
  ms: number, 
  handler: () => void | Promise<void>
): Job {
  return {
    name,
    schedule: ms,
    handler,
  };
}

/**
 * Create a cron job
 */
export function cron(
  name: string,
  expression: CronExpression,
  handler: () => void | Promise<void>
): Job {
  return {
    name,
    schedule: expression,
    handler,
  };
}

// ===== Common Schedules =====

export const schedules = {
  /** Every minute */
  everyMinute: "* * * * *",
  /** Every 5 minutes */
  every5Minutes: "*/5 * * * *",
  /** Every 15 minutes */
  every15Minutes: "*/15 * * * *",
  /** Every 30 minutes */
  every30Minutes: "*/30 * * * *",
  /** Every hour */
  hourly: "0 * * * *",
  /** Every day at midnight */
  daily: "0 0 * * *",
  /** Every day at 3 AM */
  dailyAt3AM: "0 3 * * *",
  /** Every Monday at midnight */
  weekly: "0 0 * * 1",
  /** First day of month at midnight */
  monthly: "0 0 1 * *",
  /** Every year on Jan 1 */
  yearly: "0 0 1 1 *",
  /** Weekdays at 9 AM */
  weekdaysMorning: "0 9 * * 1-5",
  /** Weekends at noon */
  weekendsNoon: "0 12 * * 0,6",
};
