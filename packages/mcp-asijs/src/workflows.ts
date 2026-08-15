/**
 * asijs-mcp — Workflow engine
 *
 * Custom workflow definitions let AI clients compose multi-step operations:
 * HTTP calls (webhooks), code steps, delays and logging — with progress
 * notifications and cancellation support.
 *
 * @example
 * ```ts
 * const server = new MCPServer(app, {
 *   workflows: [
 *     {
 *       name: "my-webhook",
 *       description: "Call a webhook with a payload",
 *       inputSchema: { type: "object", required: ["url"], properties: { url: { type: "string" } } },
 *       steps: [
 *         { type: "http", url: (input) => input.url as string, method: "POST" },
 *         { type: "log", message: (input, prev) => `Webhook responded: ${JSON.stringify(prev)}` },
 *       ],
 *     },
 *   ],
 * });
 * ```
 */

import type { AsiRuntimeBridge } from "./runtime";
import type { HttpMethod, LogLevel, Workflow, WorkflowRunContext, WorkflowStep } from "./types";

// ============================================================================
// Input validation (JSON Schema subset)
// ============================================================================

export interface ValidationIssue {
  path: string;
  message: string;
}

/**
 * Validate input against a JSON Schema subset: type, required, properties,
 * items, enum, minimum/maximum, minLength/maxLength.
 */
export function validateInput(
  schema: Record<string, unknown> | undefined,
  input: unknown,
  path = "$",
): ValidationIssue[] {
  if (!schema || Object.keys(schema).length === 0) return [];

  const issues: ValidationIssue[] = [];
  const push = (msg: string, p = path) => issues.push({ path: p, message: msg });

  if (schema.type === "object" || (schema.properties && !schema.type)) {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      push(`Expected an object`);
      return issues;
    }
    const obj = input as Record<string, unknown>;

    const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
    for (const key of required) {
      if (obj[key] === undefined) push(`Missing required property "${key}"`, `${path}.${key}`);
    }

    const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    for (const [key, propSchema] of Object.entries(props)) {
      if (obj[key] === undefined) continue;
      issues.push(...validateInput(propSchema, obj[key], `${path}.${key}`));
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(input)) {
      push("Expected an array");
      return issues;
    }
    const items = schema.items as Record<string, unknown> | undefined;
    if (items) {
      input.forEach((item, i) => issues.push(...validateInput(items, item, `${path}[${i}]`)));
    }
  } else if (schema.type === "string") {
    if (typeof input !== "string") push("Expected a string");
    else {
      if (typeof schema.minLength === "number" && input.length < schema.minLength) push(`String shorter than ${schema.minLength}`);
      if (typeof schema.maxLength === "number" && input.length > schema.maxLength) push(`String longer than ${schema.maxLength}`);
      if (Array.isArray(schema.enum) && !(schema.enum as unknown[]).includes(input)) push(`Not one of: ${(schema.enum as unknown[]).join(", ")}`);
    }
  } else if (schema.type === "number" || schema.type === "integer") {
    if (typeof input !== "number") push("Expected a number");
    else {
      if (schema.type === "integer" && !Number.isInteger(input)) push("Expected an integer");
      if (typeof schema.minimum === "number" && input < schema.minimum) push(`Less than minimum ${schema.minimum}`);
      if (typeof schema.maximum === "number" && input > schema.maximum) push(`Greater than maximum ${schema.maximum}`);
    }
  } else if (schema.type === "boolean") {
    if (typeof input !== "boolean") push("Expected a boolean");
  }

  return issues;
}

// ============================================================================
// Workflow runner
// ============================================================================

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runStep(
  step: WorkflowStep,
  input: Record<string, unknown>,
  prev: unknown,
  ctx: WorkflowRunContext,
): Promise<unknown> {
  switch (step.type) {
    case "http": {
      const url = typeof step.url === "function" ? step.url(input, prev) : step.url;
      const headers = typeof step.headers === "function" ? step.headers(input, prev) : step.headers;
      const body = typeof step.body === "function" ? step.body(input, prev) : step.body;
      const method = typeof step.method === "function" ? step.method(input, prev) : (step.method ?? "GET");

      ctx.progress(ctx.steps.length, undefined, `HTTP ${method} ${url}`);
      ctx.log("info", `fetching ${method} ${url}`, "workflow:http");

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...(headers ?? {}) },
        ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
      });

      let result: unknown;
      if (step.transform) {
        result = await step.transform(response);
      } else {
        const contentType = response.headers.get("content-type") ?? "";
        result = contentType.includes("application/json")
          ? await response.json()
          : await response.text();
      }
      return { status: response.status, ok: response.ok, data: result };
    }

    case "code":
      ctx.progress(ctx.steps.length, undefined, "Executing code step");
      return step.run(input, prev, ctx);

    case "delay": {
      const ms = typeof step.ms === "function" ? step.ms(input) : step.ms;
      ctx.progress(ctx.steps.length, undefined, `Delaying ${ms}ms`);
      await sleep(ms);
      return prev;
    }

    case "log": {
      const message = typeof step.message === "function" ? step.message(input, prev) : step.message;
      ctx.log("info", message, "workflow");
      return prev;
    }

    case "result":
      return step.value ? step.value(input, prev) : prev;

    default:
      return prev;
  }
}

/**
 * Run a workflow: either its imperative `run(input, ctx)` or its declarative
 * `steps`. Emits progress through the context. Throws when cancelled.
 */
export async function runWorkflow(
  workflow: Workflow,
  input: Record<string, unknown>,
  ctx: Omit<WorkflowRunContext, "steps"> & { runtime: AsiRuntimeBridge },
): Promise<unknown> {
  // Validate input
  const issues = validateInput(workflow.inputSchema, input);
  if (issues.length > 0) {
    throw new Error(`Invalid workflow input: ${issues.map((i) => `${i.path} ${i.message}`).join("; ")}`);
  }

  const steps: unknown[] = [];
  const runCtx: WorkflowRunContext = {
    ...ctx,
    steps,
    progress: ctx.progress,
    log: ctx.log,
    cancelled: ctx.cancelled,
  };

  // Imperative workflow
  if (workflow.run) {
    const result = await workflow.run(input, runCtx);
    steps.push(result);
    return result;
  }

  // Declarative steps
  if (!workflow.steps || workflow.steps.length === 0) {
    throw new Error(`Workflow "${workflow.name}" has no steps or run function`);
  }

  let prev: unknown = undefined;
  for (let i = 0; i < workflow.steps.length; i++) {
    if (ctx.cancelled()) {
      throw new Error(`Workflow "${workflow.name}" cancelled`);
    }
    const stepResult = await runStep(workflow.steps[i], input, prev, runCtx);
    steps.push(stepResult);
    prev = stepResult;
  }

  // Result step (or last step output) is the final result
  const last = workflow.steps[workflow.steps.length - 1];
  return last.type === "result" ? prev : { result: prev, steps };
}

// ============================================================================
// Built-in workflows
// ============================================================================

export function createBuiltinWorkflows(): Workflow[] {
  return [
    {
      name: "asijs/http-request",
      description: "Make a single HTTP request (webhook-style) and return the response.",
      inputSchema: {
        type: "object",
        required: ["url"],
        properties: {
          url: { type: "string" },
          method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
          headers: { type: "object" },
          body: {},
        },
      },
      steps: [
        {
          type: "http",
          url: (input: Record<string, unknown>) => String(input.url),
          method: (input: Record<string, unknown>) => (input.method as HttpMethod) ?? "GET",
          headers: (input: Record<string, unknown>) => (input.headers as Record<string, string>) ?? {},
          body: (input: Record<string, unknown>) => input.body,
        },
      ],
    },
    {
      name: "asijs/chain-requests",
      description: "Execute a sequence of HTTP requests, passing each response into the next.",
      inputSchema: {
        type: "object",
        required: ["steps"],
        properties: {
          steps: {
            type: "array",
            items: {
              type: "object",
              required: ["url"],
              properties: {
                url: { type: "string" },
                method: { type: "string" },
                headers: { type: "object" },
                body: {},
              },
            },
          },
        },
      },
      run: async (input, ctx) => {
        const steps = (input.steps as Array<{ url: string; method?: string; headers?: Record<string, string>; body?: unknown }> ?? []);
        const results: unknown[] = [];
        let prev: unknown = undefined;
        for (let i = 0; i < steps.length; i++) {
          if (ctx.cancelled()) throw new Error("Workflow cancelled");
          const step = steps[i];
          ctx.progress(i + 1, steps.length, `Request ${i + 1}/${steps.length}: ${step.method ?? "GET"} ${step.url}`);
          const response = await fetch(step.url, {
            method: step.method ?? "GET",
            headers: { "Content-Type": "application/json", ...(step.headers ?? {}) },
            ...(step.body !== undefined ? { body: typeof step.body === "string" ? step.body : JSON.stringify(step.body) } : {}),
          });
          const data = response.headers.get("content-type")?.includes("application/json")
            ? await response.json()
            : await response.text();
          results.push({ status: response.status, ok: response.ok, data });
          prev = data;
        }
        return { results, final: prev };
      },
    },
    {
      name: "asijs/app-snapshot",
      description: "Capture a snapshot of the AsiJS application runtime state.",
      inputSchema: { type: "object", properties: {} },
      steps: [
        {
          type: "code",
          run: (_input: Record<string, unknown>, _prev: unknown, ctx: WorkflowRunContext) => {
            const runtime = (ctx as WorkflowRunContext & { runtime?: AsiRuntimeBridge }).runtime;
            if (!runtime) return { available: false };
            return {
              routes: runtime.routes(),
              plugins: runtime.pluginGraph(),
              circuitBreakers: runtime.circuitBreakers(),
              wsRooms: runtime.wsRooms(),
              serverless: runtime.serverlessStatus(),
              ssgPaths: runtime.ssgPaths(),
            };
          },
        },
      ],
    },
  ];
}
