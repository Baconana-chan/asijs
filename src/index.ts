// AsiJS — Bun-first Web Framework
// Main entry point

export { Asi } from "./asi";
export type {
  AsiConfig,
  ErrorPagesOptions,
  GroupBuilder,
  WebSocketHandlers,
  WebSocketRoute,
  RouteInfo,
  MiddlewareInfo,
  AppConfigInfo,
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
  rateLimitPresets,
  workspaceRateLimit,
  tenantRateLimitMiddleware,
  TenantStore,
  defaultTenantOptions,
  type RateLimitOptions,
  type RateLimitInfo,
  type RateLimitStore,
  type TenantRateLimitOptions,
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

export {
  renderDefaultErrorPage,
  renderDiscoveredErrorPage,
  shouldRenderHtmlErrorPage,
  type ErrorPageContext,
  type ErrorPageKind,
} from "./error-pages";

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
  createShutdownController,
  LifecycleManager,
  type LifecycleOptions,
  type ShutdownHandler,
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

// Metrics Export (Prometheus + OTLP)
export {
  metricsPlugin,
  metricsMiddleware,
  RequestMetricsCollector,
  PrometheusExporter,
  OTLPMetricsExporter,
  type MetricsPluginOptions,
  type OTLPExporterOptions,
  type MetricSnapshot,
  type HistogramBucket,
  type BucketConfig,
} from "./metrics";
export { DEFAULT_BUCKETS } from "./metrics";

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
  denoServe,
  lambdaEdge,
  netlifyEdge,
  createStaticHandler,
  combineHandlers,
  withCORS,
  withWaitUntil,
  withEdgeCache,
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

// ===== Workspace — Selective Hot-Reload in Bun Monorepos =====
export {
  scanWorkspace,
  startWorkspaceDev,
  startStandaloneDev,
  findStandaloneEntry,
  asiDev,
  WorkspaceDevController,
  type SubApp,
  type SubAppProcess,
  type SubAppConfig,
  type WorkspaceDevOptions,
  type WorkspaceRateLimitConfig,
} from "./workspace";

// ===== Workspace V2 — Production Multi-App Server =====
export {
  Workspace,
  createWorkspace,
  type WorkspaceOptions,
  type WorkspaceAppConfig,
} from "./workspace-v2";

// ===== RPC 2.0 — Server Actions + Auto Treaty =====
export {
  serverAction,
  rpc,
  createRPCClient,
  RPCActionError,
  type RPCRegistry,
  type RPCClient,
  type RPCOptions,
  type RPCClientOptions,
  type InferRPCOutput,
  type InferRPCInput,
  type InferRPCAPI,
  type RPCServerAction,
} from "./rpc";

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

// GraphQL Plugin/Adapters
export {
  graphql,
  yogaGraphQLAdapter,
  mercuriusGraphQLAdapter,
  type GraphQLVariables,
  type GraphQLRequestPayload,
  type GraphQLContextFactory,
  type GraphQLPluginOptions,
  type YogaLikeServer,
  type YogaGraphQLAdapterOptions,
  type MercuriusExecuteRequest,
  type MercuriusExecutorLike,
  type MercuriusInstanceLike,
  type MercuriusGraphQLAdapterOptions,
} from "./graphql";

// DI / Module decorators
export {
  DIContainer,
  Module,
  Injectable,
  getModuleMetadata,
  createContainerFromModule,
  modulePlugin,
  type ClassType,
  type InjectionToken,
  type ProviderScope,
  type ValueProvider,
  type ClassProvider,
  type FactoryProvider,
  type Provider,
  type ModuleMetadata,
  type ModuleType,
  type InjectableOptions,
  type CreateContainerOptions,
  type ModulePluginOptions,
} from "./di";

// ===== File-based Routing =====
export {
  scanRoutes,
  registerFileRoutes,
  type FileRoute,
  type FileRoutesOptions,
  type RouteModule,
} from "./routes";

// ===== Codemods — Automatic Migration from Elysia / Hono / Fastify =====
export {
  runCodemod,
  migrateFile,
  transformSource,
  detectFramework,
  detectProjectFramework,
  printSummary,
  type CodemodOptions,
  type CodemodFile,
  type CodemodResult,
  type SourceFramework,
} from "./codemod";

// ===== Sessions Middleware =====
export {
  sessions,
  Session,
  SessionMemoryStore,
  CookieStore,
  RedisSessionStore,
  type SessionStore,
  type SessionOptions,
  type RedisLikeClient,
} from "./session";

// ===== Request Logger =====
export {
  requestLogger,
  type RequestLogInfo,
  type RequestLoggerOptions,
  type LogFormat,
} from "./logger";

// ===== Response Compression =====
export {
  compression,
  type CompressionOptions,
} from "./compression";

// ===== Content Negotiation =====
export {
  parseAccept,
  bestMatch,
  negotiateResponse,
  type AcceptEntry,
  type NegotiateHandlers,
  type NegotiateOptions,
} from "./negotiate";

// ===== Dev Error Page =====
export {
  renderDevErrorPage,
  renderDevNotFoundPage,
} from "./dev-error-page";
export type {
  DevErrorPageContext,
  StackFrame,
} from "./dev-error-page";

// ===== Health Checks =====
export {
  healthCheck,
  type HealthCheckOptions,
  type HealthCheckResult,
  type HealthCheckFn,
  type HealthChecks,
  type HealthResponse,
} from "./health";

// ===== SSE (Server-Sent Events) =====
export {
  sse,
  SSEController,
  createSSEClient,
  type SSEOptions,
  type SSEEvent,
  type SSEClientOptions,
  type SSEClientEvents,
} from "./sse";

// ===== SPA / SSR / Hybrid Rendering =====
export {
  buildSSRPage,
  serializeProps,
  createIslandHTML,
  createIsland,
  island,
  spaMiddleware,
  spaFallbackHandler,
  buildProject,
  type SPAOptions,
  type IslandDefinition,
  type BuildResult,
} from "./spa";

// ===== Structured JSON Logger =====
export {
  structuredLogger,
  createStructuredLogger,
  apiLogger,
  webLogger,
  workerLogger,
  type StructuredLoggerOptions,
  type StructuredLogEntry,
  type LogLevel,
} from "./structured-logger";

// ===== Sentry / Error Tracking =====
export {
  sentry,
  getSentryClient,
  createSentryClient,
  type SentryOptions,
  type SentryEvent,
} from "./sentry";

// ===== Redis Rate Limit Store & Queue =====
export {
  RedisRateLimitStore,
  RedisQueue,
  type RedisConnectionOptions,
  type RedisQueueJob,
  type RedisQueueOptions,
  type RedisQueueHandler,
  type RedisQueueMetrics,
} from "./redis";

// ===== JSON Streaming & NDJSON =====
export {
  createJsonStream,
  streamJsonResponse,
  createNDJsonStream,
  streamNDJsonResponse,
  type StreamJsonOptions,
  type StreamNDJsonOptions,
} from "./json-stream";

// ===== Router Performance Optimizations =====
export {
  SchemaCacheLRU,
  getDefaultSchemaCache,
  MiddlewareChainFlattener,
  RadixTreeRouter,
} from "./router-perf";

// ===== Web Infrastructure =====
export {
  webhooks,
  webhookProviders,
  rangeRequests,
  trustProxy,
  domainRouting,
  domainRoute,
  indexHtmlFallback,
  serverPush,
  type WebhookOptions,
  type WebhookProvider,
  type RangeRequestOptions,
  type TrustProxyOptions,
  type DomainRoute,
  type IndexHtmlOptions,
  type PushHint,
  type ServerPushOptions,
} from "./web-infra";

// ===== Type Safety Enhancements =====
export {
  createResponseValidator,
  getResponseValidator,
  resetResponseValidator,
  upgradeToOpenAPI31,
  convertSchemaTo202012,
  createOpenAPI31Generator,
  createTypedTranslator,
  JSON_SCHEMA_DIALECT,
  type ResponseValidationOptions,
  type TypedTranslateFunction,
  type TranslationKeys,
  type SupportedLocale,
  type OpenAPI31Document,
  type OpenAPI31Operation,
  type OpenAPI31Parameter,
  type OpenAPI31RequestBody,
  type OpenAPI31Response,
} from "./type-safety";

// ===== Ecosystem: OpenAPI Client Codegen =====
export {
  generateClient,
  type CodegenOptions,
  type CodegenResult,
  type CodegenOperation,
} from "./codegen";

// ===== Ecosystem: Auth.js Adapter =====
export {
  authjs,
  authProviders,
  requireAuth as authjsRequireAuth,
  requireRole,
  type AuthjsOptions,
  type AuthContext,
  type AuthSession,
  type AuthUser,
  type AuthProvider,
  type AuthJWT,
  type OAuthProfile,
} from "./authjs";

// ===== Ecosystem: Upload Provider (S3/R2/Local) =====
export {
  upload,
  uploadStorage,
  type UploadOptions,
  type UploadStorage,
  type UploadedFile,
  type S3StorageConfig,
} from "./upload";

// ===== Ecosystem: PostgREST-like Auto API =====
export {
  autoAPI,
  introspectSchema,
  parseQueryParams,
  buildSelectSQL,
  type AutoAPIOptions,
  type AutoAPIOperation,
  type TableSchema,
  type ColumnSchema,
} from "./auto-api";

export type { TSchema, Static } from "@sinclair/typebox";
