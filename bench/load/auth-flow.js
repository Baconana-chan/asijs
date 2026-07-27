/**
 * k6 Load Test — Auth Flow
 *
 * Simulates realistic auth flow:
 * 1. Register a user
 * 2. Login with credentials → get JWT
 * 3. Access protected endpoint with JWT
 *
 * Run: docker run -i grafana/k6 run - <bench/load/auth-flow.js
 */

import { check, sleep, group } from "k6";
import http from "k6/http";
import { BASE_URL, BASE_OPTIONS, jsonBody, authParams, jsonParams } from "./k6-options.js";

export const options = {
  ...BASE_OPTIONS,
  thresholds: {
    ...BASE_OPTIONS.thresholds,
    "http_req_duration{name:register}": ["p(95)<3000"],
    "http_req_duration{name:login}": ["p(95)<2000"],
    "http_req_duration{name:profile}": ["p(95)<1000"],
  },
  stages: [
    { duration: "10s", target: 10 },   // ramp up
    { duration: "30s", target: 50 },   // steady
    { duration: "10s", target: 0 },    // ramp down
  ],
};

const USER_EMAIL = `loadtest.user@example.com`;
const USER_PASS = "LoadTest123!";

export default function () {
  // Each VU gets a unique suffix to avoid registration conflicts
  const vuId = `${__VU}_${Date.now()}`;
  const email = `loadtest_${vuId}@example.com`;
  const password = "LoadTest123!";

  group("Auth Flow", () => {
    // 1. Register
    const registerRes = http.post(
      `${BASE_URL}/api/auth/register`,
      jsonBody({ email, password, name: `LoadTest User ${__VU}` }),
      { tags: { name: "register" }, ...jsonParams() },
    );
    check(registerRes, {
      "register status 201": (r) => r.status === 201,
      "register has token": (r) => JSON.parse(r.body).token !== undefined,
    });

    const token = JSON.parse(registerRes.body).token;

    // 2. Login
    const loginRes = http.post(
      `${BASE_URL}/api/auth/login`,
      jsonBody({ email, password }),
      { tags: { name: "login" }, ...jsonParams() },
    );
    check(loginRes, {
      "login status 200": (r) => r.status === 200,
      "login has token": (r) => JSON.parse(r.body).token !== undefined,
    });

    const jwt = JSON.parse(loginRes.body).token;

    // 3. Access protected profile
    const profileRes = http.get(
      `${BASE_URL}/api/auth/profile`,
      authParams(jwt),
    );
    check(profileRes, {
      "profile status 200": (r) => r.status === 200,
      "profile has email": (r) => JSON.parse(r.body).email !== undefined,
    });
  });

  sleep(1);
}
