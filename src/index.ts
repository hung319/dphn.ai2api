import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bearerAuth } from 'hono/bearer-auth';

const app = new Hono();

// --- CONFIGURATION ---
const PORT = parseInt(process.env.PORT || "3000");
const API_KEY = process.env.API_KEY || "1";
const UPSTREAM_URL = process.env.UPSTREAM_URL || 'https://chat.dphn.ai/api/chat';
const DEBUG_MODE = true;

console.log(`[Config] Port: ${PORT}`);
console.log(`[Config] Upstream: ${UPSTREAM_URL}`);

// --- HEADERS ---
const BASE_HEADERS = {
  'accept': 'text/event-stream',
  'accept-language': 'vi-VN,vi;q=0.9',
  'cache-control': 'no-cache',
  'content-type': 'application/json',
  'origin': 'https://chat.dphn.ai',
  'referer': 'https://chat.dphn.ai/',
  'sec-ch-ua': '"Chromium";v="137", "Not/A)Brand";v="24"',
  'sec-ch-ua-mobile': '?1',
  'sec-ch-ua-platform': '"Android"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
  'accept-encoding': 'gzip, deflate, br'
};

const AVAILABLE_MODELS = [
  { id: "dolphinserver:24B", object: "model", created: 1677610602, owned_by: "dphn" },
  { id: "dolphinserver2:8B", object: "model", created: 1677610602, owned_by: "dphn" },
];

// --- MIDDLEWARES ---
app.use('/*', cors());
app.use('/v1/*', bearerAuth({ token: API_KEY }));

// --- ROUTES ---
app.get('/v1/models', (c) => c.json({ object: "list", data: AVAILABLE_MODELS }));

app.post('/v1/chat/completions', async (c) => {
  const reqId = Date.now().toString().slice(-4);
  try {
    const body = await c.req.json();
    const isStream = body.stream === true;
    const model = body.model || AVAILABLE_MODELS[0].id;

    // --- FIX LOGIC: Xử lý System Prompt ---
    // Upstream không hiểu 'system', nên ta gộp nó vào 'user'
    let finalMessages = [];
    let systemPrompt = "";

    if (Array.isArray(body.messages)) {
      for (const msg of body.messages) {
        if (msg.role === 'system') {
          systemPrompt += (msg.content || "") + "\n\n";
        } else if (msg.role === 'user' && systemPrompt) {
          // Gộp system vào user message đầu tiên gặp
          finalMessages.push({
            role: 'user',
            content: systemPrompt + (msg.content || "")
          });
          systemPrompt = ""; // Reset sau khi gộp
        } else {
          finalMessages.push(msg);
        }
      }
    }
    // Nếu vẫn còn system prompt thừa (vd: context chỉ có mỗi system)
    if (systemPrompt) {
        finalMessages.push({ role: 'user', content: systemPrompt.trim() });
    }

    // Construct Payload
    const upstreamPayload = {
      messages: finalMessages, // Đã loại bỏ role system
      model: model,
      template: "logical"
    };

    if (DEBUG_MODE) {
      console.log(`[${reqId}] Request Model: ${model} | Stream: ${isStream}`);
    }

    const response = await fetch(UPSTREAM_URL, {
      method: 'POST',
      headers: BASE_HEADERS,
      body: JSON.stringify(upstreamPayload),
    });

    if (!response.ok) {
        const errText = await response.text();
        console.error(`[${reqId}] [Upstream Error] Status: ${response.status}`);
        console.error(`[${reqId}] [Upstream Body]:`, errText);
        // Log payload thực tế gửi đi để debug
        console.error(`[${reqId}] [Payload Sent]:`, JSON.stringify(upstreamPayload));
        return c.json({ error: "Upstream Error", details: errText, code: response.status }, response.status as any);
    }

    // CASE 1: Stream
    if (isStream) {
      console.log(`[${reqId}] Proxying stream...`);
      return new Response(response.body, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        }
      });
    }

    // CASE 2: Non-Stream
    console.log(`[${reqId}] Accumulating stream...`);
    const fullResponse = await streamToNonStream(response.body, model);
    return c.json(fullResponse);

  } catch (e: any) {
    console.error(`[${reqId}] [Internal Error]`, e);
    return c.json({ error: { message: e.message } }, 500);
  }
});

// --- HELPER ---
async function streamToNonStream(readable: ReadableStream | null, model: string) {
  if (!readable) return {};
  const reader = readable.getReader();
  const decoder = new TextDecoder();
  let fullContent = "";
  
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
          try {
            const data = JSON.parse(trimmed.substring(6));
            if (data.choices?.[0]?.delta?.content) {
              fullContent += data.choices[0].delta.content;
            }
          } catch (e) {}
        }
      }
    }
  } catch (err) { console.error(err); }

  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: model,
    choices: [{
        index: 0,
        message: { role: "assistant", content: fullContent },
        finish_reason: "stop",
    }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  };
}

export default { port: PORT, fetch: app.fetch };
