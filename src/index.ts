// AsiJS — Bun-first Web Framework
// Main entry point

export { Asi } from "./asi";
export type {
  AsiConfig,
  GroupBuilder,
  WebSocketHandlers,
  WebSocketRoute,
} from "./asi";
export { Context, type TypedContext, type CookieOptions } from "./context";
export type {
  Handler,
  Middleware,
  RouteMethod,
  BeforeHandler,
  AfterHandler,
  ErrorHandler,
  NotFoundHandler,
  RouteOptions,
  RouteSchema,
  TypedHandler,
  InferSchema,
} from "./types";

// Validation exports
export {
  Type,
  validate,
  validateAndCoerce,
  createValidator,
  ValidationException,
  type ValidationError,
  type ValidationResult,
} from "./validation";

// Compiler exports (advanced)
export {
  compileSchema,
  compileHandler,
  analyzeRoute,
  StaticRouter,
  type CompiledRoute,
  type RouteAnalysis,
  type CompileOptions,
} from "./compiler";

// Plugin exports
export { cors, type CorsOptions } from "./plugins/cors";
export { staticFiles, type StaticOptions } from "./plugins/static";

// Plugin system
export {
  createPlugin,
  pluginFn,
  decorators,
  sharedState,
  guard,
  type AsiPlugin,
  type AsiPluginConfig,
  type PluginHost,
} from "./plugin";

// FormData / Multipart exports
export {
  FormDataSchema,
  FileSchema,
  MultipleFilesSchema,
  validateFormData,
  isFormDataSchema,
  isFileSchema,
  getMultipleFiles,
  type ParsedFile,
  type FileSchemaOptions,
  type FormDataSchemaType,
  type FormDataValidationError,
  type FormDataValidationResult,
} from "./formdata";

// OpenAPI / Swagger
export {
  openapi,
  OpenAPIGenerator,
  type OpenAPIOptions,
  type OpenAPIDocument,
  type OpenAPIInfo,
  type OpenAPIServer,
  type OpenAPITag,
  type OpenAPIOperation,
  type OpenAPIParameter,
  type OpenAPISecurityScheme,
  type RouteDocumentation,
  type DocumentedRoute,
} from "./openapi";

// Rate Limiting
export {
  rateLimit,
  rateLimitMiddleware,
  rateLimitMiddlewareFunc,
  MemoryStore,
  TokenBucketStore,
  standardLimit,
  strictLimit,
  apiLimit,
  authLimit,
  type RateLimitOptions,
  type RateLimitInfo,
  type RateLimitStore,
} from "./ratelimit";

// JWT & Auth
export {
  jwt,
  bearer,
  bearerMiddleware,
  auth,
  hashPassword,
  verifyPassword,
  generateToken,
  generateCsrfToken,
  csrf,
  type JWTOptions,
  type JWTPayload,
  type JWTHelper,
  type BearerOptions,
} from "./auth";

// Typed Client (Eden-like)
export {
  createClient,
  treaty,
  batchRequest,
  withRetry,
  type ClientConfig,
  type ClientResponse,
  type ClientError,
  type RequestOptions,
  type HTTPMethod,
  type BatchRequest,
  type BatchResponse,
  type RetryOptions,
} from "./client";

// JSX / HTML Streaming
export {
  jsx,
  jsxs,
  jsxDEV,
  Fragment,
  html,
  stream,
  renderToString,
  renderToStream,
  escapeHtml,
  htmlTemplate,
  rawHtml,
  raw,
  when,
  each,
  Suspense,
  createAsyncComponent,
  setTitle,
  addMeta,
  addLink,
  addScript,
  renderHead,
  type JSXElement,
  type JSXNode,
  type JSXChild,
  type JSXChildren,
  type JSXProps,
  type JSXComponent,
  type JSX,
} from "./jsx";

// Lifecycle / Graceful Shutdown
export {
  lifecycle,
  healthCheck,
  createShutdownController,
  LifecycleManager,
  type LifecycleOptions,
  type ShutdownHandler,
  type HealthCheckOptions,
} from "./lifecycle";

// Security Headers
export {
  security,
  securityHeaders,
  strictSecurity,
  relaxedSecurity,
  apiSecurity,
  generateNonce,
  nonceMiddleware,
  type SecurityOptions,
  type ContentSecurityPolicyOptions,
  type HstsOptions,
  type ReferrerPolicyOptions,
  type PermissionsPolicyOptions,
} from "./security";

// Response Caching
export {
  cache,
  cacheMiddleware,
  cachePlugin,
  etag,
  noCache,
  noCacheMiddleware,
  responseCacheMiddleware,
  generateETag,
  parseTTL,
  buildCacheControl,
  MemoryCache,
  staticCache,
  apiCache,
  cdnCache,
  type CacheOptions,
  type ETagOptions,
  type CachePluginOptions,
  type TTL,
} from "./cache";

// Tracing / Observability
export {
  trace,
  traceMiddleware,
  prettyTrace,
  MetricsCollector,
  Timing,
  generateRequestId,
  generateTraceId,
  generateSpanId,
  parseTraceparent,
  generateTraceContext,
  getCurrentTrace,
  addTraceEvent,
  setTraceAttribute,
  type TraceOptions,
  type TraceInfo,
  type TraceContext,
  type RequestMetrics,
} from "./trace";

// Background Tasks / Cron
export {
  scheduler,
  Scheduler,
  parseCron,
  matchesCron,
  getNextRun,
  interval,
  cron,
  schedules,
  type SchedulerOptions,
  type Job,
  type JobStatus,
  type CronExpression,
} from "./scheduler";

// Dev Mode
export {
  devMode,
  debugLog,
  logBody,
  delay,
  chaos,
  type DevModeOptions,
  type InspectedRequest,
} from "./dev";

// MCP - Model Context Protocol for AI/LLM
export {
  mcp,
  createMCPServer,
  MCPServer,
  ASIJS_DOCS,
  type MCPServerOptions,
  type MCPTool,
  type MCPResource,
} from "./mcp";

// Server Actions / Server Functions
export {
  action,
  simpleAction,
  actionWithMiddleware,
  registerActions,
  createActionsClient,
  actionsPlugin,
  registerBatchActions,
  formAction,
  ActionError,
  requireAuth,
  actionRateLimit,
  actionLogger,
  type ServerAction,
  type ActionMiddleware,
  type ActionOptions,
  type ActionsRegistry,
  type ActionsClient,
  type RegisterActionsOptions,
  type ActionsPluginOptions,
  type BatchActionCall,
  type BatchActionResult,
  type InferActionInput,
  type InferActionOutput,
  type InferActions,
} from "./actions";

// i18n & Localization
export {
  i18n,
  I18n,
  createTranslator,
  loadTranslations,
  mergeTranslations,
  getBrowserLocale,
  dateFormats,
  numberFormats,
  type I18nOptions,
  type I18nContext,
  type Translation,
  type Translations,
  type PluralRules,
  type LocaleDetection,
  type TranslateFunction,
} from "./i18n";

// Edge / Serverless Adapters
export {
  toFetchHandler,
  cloudflare,
  vercelEdge,
  deno,
  lambdaEdge,
  netlifyEdge,
  createStaticHandler,
  combineHandlers,
  withCORS,
  type FetchHandler,
  type ExecutionContext,
  type CloudflareEnv,
  type VercelEdgeConfig,
  type DenoHandler,
  type LambdaEdgeEvent,
  type LambdaEdgeResponse,
  type AdapterOptions,
  type EdgeContext,
} from "./edge";

// Test Utilities
export {
  mockContext,
  mockFormDataContext,
  testClient,
  buildRequest,
  buildFormData,
  mockFile,
  assertStatus,
  assertOk,
  assertHeader,
  assertContentType,
  assertJson,
  assertContains,
  assertRedirect,
  setupTest,
  withApp,
  snapshotResponse,
  measureHandler,
  benchmarkRoute,
  type MockContextOptions,
  type TestClientOptions,
  type TestResponse,
  type TestClient,
} from "./testing";

// Database Integration
export {
  drizzlePlugin,
  prismaPlugin,
  kyselyPlugin,
  databasePlugin,
  withTransaction,
  prismaTransaction,
  kyselyTransaction,
  ConnectionPool,
  sql,
  buildWhere,
  buildInsert,
  buildUpdate,
  createRepository,
  runMigrations,
  rollbackMigration,
  type DrizzleConfig,
  type PrismaConfig,
  type KyselyConfig,
  type DatabaseConfig,
  type DatabaseClient,
  type TransactionOptions,
  type PoolStats,
  type Repository,
  type Migration,
  type DatabaseContext,
} from "./database";

export type { TSchema, Static } from "@sinclair/typebox";
