/**
 * k6 Load Test — CRUD Operations
 *
 * Simulates typical CRUD API usage:
 * - Create a resource (POST)
 * - List resources (GET)
 * - Get single resource (GET /:id)
 * - Update resource (PUT /:id)
 * - Delete resource (DELETE /:id)
 *
 * Uses JWT auth token from env variable.
 */

import { check, sleep, group } from "k6";
import http from "k6/http";
import { BASE_URL, BASE_OPTIONS, jsonBody, authParams, jsonParams } from "./k6-options.js";

export const options = {
  ...BASE_OPTIONS,
  thresholds: {
    ...BASE_OPTIONS.thresholds,
    "http_req_duration{name:create}": ["p(95)<2000"],
    "http_req_duration{name:list}":   ["p(95)<500"],
    "http_req_duration{name:get}":    ["p(95)<500"],
    "http_req_duration{name:update}": ["p(95)<1000"],
    "http_req_duration{name:delete}": ["p(95)<1000"],
  },
  stages: [
    { duration: "10s", target: 20 },
    { duration: "40s", target: 100 },
    { duration: "10s", target: 0 },
  ],
};

const AUTH_TOKEN = __ENV.AUTH_TOKEN || "";

export default function () {
  const params = AUTH_TOKEN ? authParams(AUTH_TOKEN) : jsonParams();

  // Each iteration uses a unique resource name to avoid conflicts
  const resourceName = `crud-item-${__VU}-${Date.now()}`;
  let itemId = "";

  group("CRUD: Create", () => {
    const createRes = http.post(
      `${BASE_URL}/api/items`,
      jsonBody({ name: resourceName, description: "k6 load test item", value: __VU * 100 }),
      { tags: { name: "create" }, ...params },
    );
    check(createRes, {
      "create status 201": (r) => r.status === 201,
      "create has id": (r) => JSON.parse(r.body).id !== undefined,
    });
    itemId = JSON.parse(createRes.body).id;
  });

  group("CRUD: List", () => {
    const listRes = http.get(
      `${BASE_URL}/api/items?limit=20&offset=0`,
      params,
    );
    check(listRes, {
      "list status 200": (r) => r.status === 200,
      "list is array": (r) => Array.isArray(JSON.parse(r.body)),
    });
  });

  if (itemId) {
    group("CRUD: Get by ID", () => {
      const getRes = http.get(
        `${BASE_URL}/api/items/${itemId}`,
        params,
      );
      check(getRes, {
        "get status 200": (r) => r.status === 200,
        "get correct name": (r) => JSON.parse(r.body).name === resourceName,
      });
    });

    group("CRUD: Update", () => {
      const updateRes = http.put(
        `${BASE_URL}/api/items/${itemId}`,
        jsonBody({ description: "updated by k6", value: __VU * 200 }),
        { tags: { name: "update" }, ...params },
      );
      check(updateRes, {
        "update status 200": (r) => r.status === 200,
      });
    });

    group("CRUD: Delete", () => {
      const deleteRes = http.del(
        `${BASE_URL}/api/items/${itemId}`,
        null,
        { tags: { name: "delete" }, ...params },
      );
      check(deleteRes, {
        "delete status 200/204": (r) => r.status === 200 || r.status === 204,
      });
    });
  }

  // Simulate think time
  sleep(0.5);
}
