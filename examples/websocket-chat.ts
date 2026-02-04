/**
 * WebSocket Chat Example
 * 
 * Run: bun run examples/websocket-chat.ts
 * 
 * Connect with: wscat -c ws://localhost:3000/chat
 * Or open the HTML file in browser
 */

import { Asi } from "../src";

const app = new Asi();

// Храним подключённых клиентов
const clients = new Set<any>();

// WebSocket endpoint для чата
app.ws("/chat", {
  open(ws) {
    clients.add(ws);
    console.log(`Client connected. Total: ${clients.size}`);
    
    // Приветствие
    ws.send(JSON.stringify({ 
      type: "system", 
      message: "Welcome to the chat!" 
    }));
    
    // Уведомляем других
    broadcast({ 
      type: "system", 
      message: "A new user joined the chat" 
    }, ws);
  },

  message(ws, message) {
    const text = typeof message === "string" ? message : message.toString();
    
    try {
      const data = JSON.parse(text);
      
      if (data.type === "message") {
        // Рассылаем всем
        broadcast({
          type: "message",
          user: data.user || "Anonymous",
          message: data.message,
          timestamp: new Date().toISOString(),
        });
      }
    } catch {
      // Простое текстовое сообщение
      broadcast({
        type: "message",
        user: "Anonymous",
        message: text,
        timestamp: new Date().toISOString(),
      });
    }
  },

  close(ws, code, reason) {
    clients.delete(ws);
    console.log(`Client disconnected. Code: ${code}. Total: ${clients.size}`);
    
    broadcast({ 
      type: "system", 
      message: "A user left the chat" 
    });
  },
});

function broadcast(data: object, exclude?: any) {
  const message = JSON.stringify(data);
  for (const client of clients) {
    if (client !== exclude) {
      client.send(message);
    }
  }
}

// REST endpoint для статистики
app.get("/stats", () => ({
  connectedClients: clients.size,
  uptime: process.uptime(),
}));

// Простая HTML страница для тестирования
app.get("/", () => {
  return new Response(`
<!DOCTYPE html>
<html>
<head>
  <title>AsiJS WebSocket Chat</title>
  <style>
    body { font-family: system-ui; max-width: 600px; margin: 40px auto; padding: 20px; }
    #messages { height: 300px; overflow-y: auto; border: 1px solid #ccc; padding: 10px; margin-bottom: 10px; }
    .system { color: #888; font-style: italic; }
    .message { margin: 5px 0; }
    .user { font-weight: bold; color: #2196F3; }
    input, button { padding: 8px 12px; }
    input { width: 70%; }
    button { cursor: pointer; background: #2196F3; color: white; border: none; }
  </style>
</head>
<body>
  <h1>🚀 AsiJS WebSocket Chat</h1>
  <div id="messages"></div>
  <input type="text" id="input" placeholder="Enter message..." />
  <button onclick="send()">Send</button>
  
  <script>
    const messages = document.getElementById('messages');
    const input = document.getElementById('input');
    const ws = new WebSocket('ws://localhost:3000/chat');
    
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      const div = document.createElement('div');
      
      if (data.type === 'system') {
        div.className = 'system';
        div.textContent = data.message;
      } else {
        div.className = 'message';
        div.innerHTML = '<span class="user">' + data.user + ':</span> ' + data.message;
      }
      
      messages.appendChild(div);
      messages.scrollTop = messages.scrollHeight;
    };
    
    ws.onopen = () => console.log('Connected');
    ws.onclose = () => console.log('Disconnected');
    
    function send() {
      const text = input.value.trim();
      if (text) {
        ws.send(JSON.stringify({ type: 'message', user: 'Guest', message: text }));
        input.value = '';
      }
    }
    
    input.onkeypress = (e) => { if (e.key === 'Enter') send(); };
  </script>
</body>
</html>
  `, { headers: { "Content-Type": "text/html" } });
});

app.listen(3000);
