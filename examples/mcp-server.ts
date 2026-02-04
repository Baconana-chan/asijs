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
  mcp,
  createMCPServer,
  type MCPTool,
  type MCPResource,
  openapi,
  rateLimit,
  security,
} from "../src";

// ===== Create App =====

const app = new Asi({ development: true });

// Add plugins
app.plugin(openapi({
  info: {
    title: "MCP Example API",
    version: "1.0.0",
    description: "API with MCP integration for AI assistants",
  },
}));

app.plugin(rateLimit({ limit: 100, window: 60000 }));
app.plugin(security());

// ===== API Routes =====

interface Task {
  id: string;
  title: string;
  completed: boolean;
  priority: "low" | "medium" | "high";
  createdAt: Date;
}

const tasks: Task[] = [
  { id: "1", title: "Build MCP server", completed: true, priority: "high", createdAt: new Date() },
  { id: "2", title: "Write documentation", completed: false, priority: "medium", createdAt: new Date() },
  { id: "3", title: "Add tests", completed: false, priority: "high", createdAt: new Date() },
];

app.get("/tasks", () => tasks);

app.get("/tasks/:id", (ctx) => {
  const task = tasks.find(t => t.id === ctx.params.id);
  if (!task) return ctx.status(404).jsonResponse({ error: "Task not found" });
  return task;
}, {
  params: Type.Object({
    id: Type.String({ description: "Task ID" }),
  }),
});

app.post("/tasks", async (ctx) => {
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
}, {
  body: Type.Object({
    title: Type.String({ minLength: 1 }),
    priority: Type.Optional(Type.Union([
      Type.Literal("low"),
      Type.Literal("medium"),
      Type.Literal("high"),
    ])),
  }),
});

app.patch("/tasks/:id", async (ctx) => {
  const task = tasks.find(t => t.id === ctx.params.id);
  if (!task) return ctx.status(404).jsonResponse({ error: "Task not found" });
  
  const body = await ctx.body<Partial<Task>>();
  Object.assign(task, body);
  return task;
}, {
  params: Type.Object({ id: Type.String() }),
  body: Type.Object({
    title: Type.Optional(Type.String()),
    completed: Type.Optional(Type.Boolean()),
    priority: Type.Optional(Type.Union([
      Type.Literal("low"),
      Type.Literal("medium"),
      Type.Literal("high"),
    ])),
  }),
});

app.delete("/tasks/:id", (ctx) => {
  const index = tasks.findIndex(t => t.id === ctx.params.id);
  if (index === -1) return ctx.status(404).jsonResponse({ error: "Task not found" });
  tasks.splice(index, 1);
  return { deleted: true };
}, {
  params: Type.Object({ id: Type.String() }),
});

// ===== MCP Integration =====

// Custom MCP tools for AI assistants
const customTools: MCPTool[] = [
  {
    name: "create_task",
    description: "Create a new task in the task manager",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Task title" },
        priority: { type: "string", enum: ["low", "medium", "high"], description: "Task priority" },
      },
      required: ["title"],
    },
    handler: async (args) => {
      const task: Task = {
        id: String(tasks.length + 1),
        title: args.title,
        completed: false,
        priority: args.priority || "medium",
        createdAt: new Date(),
      };
      tasks.push(task);
      return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }] };
    },
  },
  {
    name: "list_tasks",
    description: "List all tasks, optionally filtered by completion status",
    inputSchema: {
      type: "object",
      properties: {
        completed: { type: "boolean", description: "Filter by completion status" },
        priority: { type: "string", enum: ["low", "medium", "high"], description: "Filter by priority" },
      },
    },
    handler: async (args) => {
      let filtered = tasks;
      if (args.completed !== undefined) {
        filtered = filtered.filter(t => t.completed === args.completed);
      }
      if (args.priority) {
        filtered = filtered.filter(t => t.priority === args.priority);
      }
      return { 
        content: [{ 
          type: "text", 
          text: `Found ${filtered.length} tasks:\n${JSON.stringify(filtered, null, 2)}` 
        }] 
      };
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
      const task = tasks.find(t => t.id === args.id);
      if (!task) {
        return { content: [{ type: "text", text: `Task ${args.id} not found` }] };
      }
      task.completed = true;
      return { content: [{ type: "text", text: `Task "${task.title}" marked as completed!` }] };
    },
  },
  {
    name: "get_statistics",
    description: "Get task statistics",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const total = tasks.length;
      const completed = tasks.filter(t => t.completed).length;
      const byPriority = {
        high: tasks.filter(t => t.priority === "high").length,
        medium: tasks.filter(t => t.priority === "medium").length,
        low: tasks.filter(t => t.priority === "low").length,
      };
      return {
        content: [{
          type: "text",
          text: `📊 Task Statistics:
- Total tasks: ${total}
- Completed: ${completed} (${Math.round(completed/total*100)}%)
- Pending: ${total - completed}
- By priority:
  - High: ${byPriority.high}
  - Medium: ${byPriority.medium}
  - Low: ${byPriority.low}`
        }]
      };
    },
  },
];

// Custom MCP resources
const customResources: MCPResource[] = [
  {
    uri: "tasks://all",
    name: "All Tasks",
    description: "Current list of all tasks",
    mimeType: "application/json",
    handler: async () => JSON.stringify(tasks, null, 2),
  },
  {
    uri: "tasks://pending",
    name: "Pending Tasks",
    description: "List of incomplete tasks",
    mimeType: "application/json",
    handler: async () => JSON.stringify(tasks.filter(t => !t.completed), null, 2),
  },
  {
    uri: "api://endpoints",
    name: "API Endpoints",
    description: "Available API endpoints documentation",
    mimeType: "text/markdown",
    handler: async () => `# API Endpoints

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

// Add MCP plugin with custom tools and resources
app.plugin(mcp({
  name: "asijs-task-manager",
  version: "1.0.0",
  tools: customTools,
  resources: customResources,
}));

// ===== Start Server =====

// Check if running as MCP server (stdin/stdout)
const isMCPMode = process.argv.includes("--mcp") || !process.stdout.isTTY;

if (isMCPMode) {
  // Run as MCP server
  const mcpServer = createMCPServer(app, {
    name: "asijs-task-manager",
    version: "1.0.0",
    tools: customTools,
    resources: customResources,
  });
  
  await mcpServer.start();
} else {
  // Run as HTTP server
  app.listen(3000, () => {
    console.log("\n📚 MCP Example Server");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("");
    console.log("📡 HTTP Mode: http://localhost:3000");
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
    console.log("   http://localhost:3000/docs");
    console.log("");
  });
}
