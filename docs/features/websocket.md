# WebSocket

```typescript
app.ws("/chat", {
  open(ws) { console.log("Client connected"); },
  message(ws, msg) { ws.send(`Echo: ${msg}`); },
  close(ws, code, reason) { console.log("Disconnected"); },
  error(ws, error) { console.error("WS Error:", error); },
  drain(ws) { console.log("Buffer drained"); },
});
```

## With Typed Data

```typescript
app.ws<{ userId: string; room: string }>("/chat/:room", {
  open(ws) {
    ws.subscribe(ws.data.room);
    ws.send(`Welcome to ${ws.data.room}!`);
  },
  message(ws, msg) {
    ws.publish(ws.data.room, `${ws.data.userId}: ${msg}`);
  },
  close(ws) {
    ws.unsubscribe(ws.data.room);
  },
});
```

## Broadcasting

```typescript
// Publish to all subscribers of a room
ws.publish("room-name", "message");

// Subscribe/unsubscribe
ws.subscribe("updates");
ws.unsubscribe("updates");
```
