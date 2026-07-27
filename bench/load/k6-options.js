/**
 * Shared k6 load test configuration
 *
 * Each scenario imports these options and overrides as needed.
 * Default: gentle smoke test (10 VUs, 30s) — override with env vars.
 *
 * Usage (via orchestrator):
 *   K6_VUS=50 K6_DURATION=5m docker run -i grafana/k6 run - <scenario.js
 */

const VUS = parseInt(__ENV.K6_VUS || "10", 10);
const DURATION = __ENV.K6_DURATION || "30s";

export const BASE_URL = __ENV.BASE_URL || "http://host.docker.internal:3000";

export const BASE_OPTIONS = {
  vus: VUS,
  duration: DURATION,
  summaryTrendStats: ["avg", "min", "med", "max", "p(50)", "p(90)", "p(95)", "p(99)"],
  thresholds: {
    http_req_failed: ["rate<0.01"], // <1% errors allowed
    http_req_duration: ["p(95)<2000"], // 95% under 2s
  },
};

/**
 * Create a JSON payload as ArrayBuffer for k6 POST/PUT requests.
 */
export function jsonBody(obj) {
  return JSON.stringify(obj);
}

/**
 * Create a request params object with auth header and JSON content type.
 */
export function authParams(token) {
  return {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  };
}

export function jsonParams() {
  return {
    headers: { "Content-Type": "application/json" },
  };
}
