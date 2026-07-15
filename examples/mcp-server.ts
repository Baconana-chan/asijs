/**
 * Example: MCP Server for AI/LLM Integration
 *
 * Demonstrates:
 * - Model Context Protocol server
 * - Custom tools for AI assistants
 * - Custom resources for documentation
 * - Real-time app inspection
 *
 * Run: bun run examples/mcp-server.ts
 *
 * Connect with Claude Desktop or other MCP clients:
 * {
 *   "mcpServers": {
 *     "asijs-example": {
 *       "command": "bun",
 *       "args": ["run", "examples/mcp-server.ts"],
 *       "transport": "stdio"
 *     }
 *   }
 * }
 */

import { Type } from "@sinclair/typebox";
import {
  Asi,
  createMCPServer,
  mcp,
  openapi,
  rateLimit,
  security,
  type MCPResource,
  type MCPTool,
} from "../src";

const app = new Asi({ development: true });

await app.plugin(
  openapi({
    title: "MCP Example API",
    version: "1.0.0",
    description: "API with MCP integration for AI assistants",
  }),
);
await app.plugin(rateLimit({ max: 100, windowMs: 60_000 }));
await app.plugin(security());

interface Task {
  id: string;
  title: string;
  completed: boolean;
  priority: "low" | "medium" | "high";
  createdAt: Date;
}

const tasks: Task[] = [
  {
    id: "1",
    title: "Build MCP server",
    completed: true,
    priority: "high",
    createdAt: new Date(),
  },
  {
    id: "2",
    title: "Write documentation",
    completed: false,
    priority: "medium",
    createdAt: new Date(),
  },
  {
    id: "3",
    title: "Add tests",
    completed: false,
    priority: "high",
    createdAt: new Date(),
  },
];

app.get("/tasks", () => tasks);

app.get(
  "/tasks/:id",
  (ctx) => {
    const task = tasks.find((item) => item.id === ctx.params.id);
    if (!task) {
      return ctx.status(404).jsonResponse({ error: "Task not found" });
    }
    return task;
  },
  {
    params: Type.Object({
      id: Type.String({ description: "Task ID" }),
    }),
  },
);

app.post(
  "/tasks",
  async (ctx) => {
    const body = await ctx.body<{ title: string; priority?: string }>();
    const task: Task = {
      id: String(tasks.length + 1),
      title: body.title,
      completed: false,
      priority: (body.priority as Task["priority"]) || "medium",
      createdAt: new Date(),
    };
    tasks.push(task);
    return ctx.status(201).jsonResponse(task);
  },
  {
    body: Type.Object({
      title: Type.String({ minLength: 1 }),
      priority: Type.Optional(
        Type.Union([
          Type.Literal("low"),
          Type.Literal("medium"),
          Type.Literal("high"),
        ]),
      ),
    }),
  },
);

app.patch(
  "/tasks/:id",
  async (ctx) => {
    const task = tasks.find((item) => item.id === ctx.params.id);
    if (!task) {
      return ctx.status(404).jsonResponse({ error: "Task not found" });
    }

    const body = await ctx.body<Partial<Task>>();
    Object.assign(task, body);
    return task;
  },
  {
    params: Type.Object({ id: Type.String() }),
    body: Type.Object({
      title: Type.Optional(Type.String()),
      completed: Type.Optional(Type.Boolean()),
      priority: Type.Optional(
        Type.Union([
          Type.Literal("low"),
          Type.Literal("medium"),
          Type.Literal("high"),
        ]),
      ),
    }),
  },
);

app.delete(
  "/tasks/:id",
  (ctx) => {
    const index = tasks.findIndex((item) => item.id === ctx.params.id);
    if (index === -1) {
      return ctx.status(404).jsonResponse({ error: "Task not found" });
    }
    tasks.splice(index, 1);
    return { deleted: true };
  },
  {
    params: Type.Object({ id: Type.String() }),
  },
);

const customTools: MCPTool[] = [
  {
    name: "create_task",
    description: "Create a new task in the task manager",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Task title" },
        priority: {
          type: "string",
          enum: ["low", "medium", "high"],
          description: "Task priority",
        },
      },
      required: ["title"],
    },
    handler: async (args) => {
      const task: Task = {
        id: String(tasks.length + 1),
        title: String(args.title),
        completed: false,
        priority: (args.priority as Task["priority"]) || "medium",
        createdAt: new Date(),
      };
      tasks.push(task);
      return task;
    },
  },
  {
    name: "list_tasks",
    description: "List all tasks, optionally filtered by completion status",
    inputSchema: {
      type: "object",
      properties: {
        completed: {
          type: "boolean",
          description: "Filter by completion status",
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high"],
          description: "Filter by priority",
        },
      },
    },
    handler: async (args) => {
      let filtered = tasks;
      if (args.completed !== undefined) {
        filtered = filtered.filter((task) => task.completed === args.completed);
      }
      if (args.priority) {
        filtered = filtered.filter((task) => task.priority === args.priority);
      }
      return filtered;
    },
  },
  {
    name: "complete_task",
    description: "Mark a task as completed",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task ID to complete" },
      },
      required: ["id"],
    },
    handler: async (args) => {
      const task = tasks.find((item) => item.id === args.id);
      if (!task) {
        return { error: `Task ${String(args.id)} not found` };
      }
      task.completed = true;
      return task;
    },
  },
  {
    name: "get_statistics",
    description: "Get task statistics",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const total = tasks.length;
      const completed = tasks.filter((task) => task.completed).length;
      return {
        total,
        completed,
        pending: total - completed,
        byPriority: {
          high: tasks.filter((task) => task.priority === "high").length,
          medium: tasks.filter((task) => task.priority === "medium").length,
          low: tasks.filter((task) => task.priority === "low").length,
        },
      };
    },
  },
];

const customResources: MCPResource[] = [
  {
    uri: "tasks://all",
    name: "All Tasks",
    description: "Current list of all tasks",
    mimeType: "application/json",
    contents: async () => JSON.stringify(tasks, null, 2),
  },
  {
    uri: "tasks://pending",
    name: "Pending Tasks",
    description: "List of incomplete tasks",
    mimeType: "application/json",
    contents: async () =>
      JSON.stringify(
        tasks.filter((task) => !task.completed),
        null,
        2,
      ),
  },
  {
    uri: "api://endpoints",
    name: "API Endpoints",
    description: "Available API endpoints documentation",
    mimeType: "text/markdown",
    contents: async () => `# API Endpoints

## Tasks API

### List Tasks
\`\`\`
GET /tasks
\`\`\`

### Get Task
\`\`\`
GET /tasks/:id
\`\`\`

### Create Task
\`\`\`
POST /tasks
Body: { "title": string, "priority"?: "low" | "medium" | "high" }
\`\`\`

### Update Task
\`\`\`
PATCH /tasks/:id
Body: { "title"?: string, "completed"?: boolean, "priority"?: string }
\`\`\`

### Delete Task
\`\`\`
DELETE /tasks/:id
\`\`\`
`,
  },
];

await app.plugin(
  mcp({
    name: "asijs-task-manager",
    version: "1.0.0",
    tools: customTools,
    resources: customResources,
  }),
);

const isExampleCheck = process.env.ASIJS_EXAMPLE_CHECK === "1";
const isMCPMode =
  process.argv.includes("--mcp") || (!process.stdout.isTTY && !isExampleCheck);

if (isMCPMode) {
  const mcpServer = createMCPServer(app, {
    name: "asijs-task-manager",
    version: "1.0.0",
    tools: customTools,
    resources: customResources,
  });

  const server = mcpServer.start();
  if (isExampleCheck) {
    setTimeout(() => server.stop(), 50);
  }
} else {
  const port = Number(process.env.PORT ?? 3000);
  const server = app.listen(port);

  console.log("\n📚 MCP Example Server");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("");
  console.log(`📡 HTTP Mode: http://localhost:${server.port}`);
  console.log("");
  console.log("🤖 To run as MCP server (for AI assistants):");
  console.log("   bun run examples/mcp-server.ts --mcp");
  console.log("");
  console.log("📚 API Endpoints:");
  console.log("   GET  /tasks          - List all tasks");
  console.log("   GET  /tasks/:id      - Get task by ID");
  console.log("   POST /tasks          - Create task");
  console.log("   PATCH /tasks/:id     - Update task");
  console.log("   DELETE /tasks/:id    - Delete task");
  console.log("");
  console.log("📖 OpenAPI docs:");
  console.log(`   http://localhost:${server.port}/docs`);
  console.log("");

  if (isExampleCheck) {
    setTimeout(() => server.stop(), 50);
  }
}
