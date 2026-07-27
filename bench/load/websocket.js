/**
 * k6 Load Test — WebSocket Connections
 *
 * Simulates WebSocket usage:
 * - Connect with auth token
 * - Send chat messages
 * - Receive broadcast messages
 * - Disconnect gracefully
 *
 * Note: k6 WS connections are not async-concurrent per VU.
 * Multiple connections are simulated by multiple VUs.
 */

import { check, sleep, group } from "k6";
import ws from "k6/ws";
import http from "k6/http";
import { BASE_URL, BASE_OPTIONS, jsonBody, jsonParams } from "./k6-options.js";

export const options = {
  ...BASE_OPTIONS,
  thresholds: {
    ...BASE_OPTIONS.thresholds,
    ws_connecting: ["p(95)<2000"],
  },
  // WS tests use fewer VUs since each connection is long-lived
  vus: Math.min(parseInt(__ENV.K6_VUS || "10", 10), 20),
  duration: __ENV.K6_DURATION || "30s",
};

const WS_URL = BASE_URL.replace(/^http/, "ws");

export default function () {
  // 1. Get auth token first
  const email = `ws_${__VU}_${Date.now()}@example.com`;
  const registerRes = http.post(
    `${BASE_URL}/api/auth/register`,
    jsonBody({ email, password: "WsTest123!", name: `WS User ${__VU}` }),
    jsonParams(),
  );
  const token = JSON.parse(registerRes.body).token;

  group("WebSocket Chat", () => {
    const url = `${WS_URL}/ws/chat?token=${token}`;
    const response = ws.connect(url, null, function (socket) {
      socket.on("open", () => {
        // Join a room
        socket.send(JSON.stringify({ type: "join", room: "loadtest" }));
      });

      socket.on("message", (data) => {
        const msg = JSON.parse(data);
        if (msg.type === "message" || msg.type === "broadcast") {
          // Successfully received a message
          check(msg, {
            "received message": () => true,
          });
        }
      });

      socket.setTimeout(() => {
        // Send chat message after 1s
        socket.send(
          JSON.stringify({
            type: "message",
            room: "loadtest",
            text: `Hello from VU ${__VU} at ${Date.now()}`,
          }),
        );
      }, 1000);

      socket.setTimeout(() => {
        // Leave room before disconnect
        socket.send(JSON.stringify({ type: "leave", room: "loadtest" }));
      }, 3000);

      socket.setTimeout(() => {
        socket.close();
      }, 4000);
    });

    check(response, {
      "WS connected": (r) => r && r.status === 101,
    });
  });

  sleep(1);
}
