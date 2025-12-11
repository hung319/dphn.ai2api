import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bearerAuth } from 'hono/bearer-auth';

const app = new Hono();

// --- CONFIGURATION ---
const PORT = parseInt(process.env.PORT || "3000");
const API_KEY = process.env.API_KEY || "1";
const UPSTREAM_URL = process.env.UPSTREAM_URL || 'https://chat.dphn.ai/api/chat';

console.log(`[Config] Port: ${PORT}`);
console.log(`[Config] Upstream: ${UPSTREAM_URL}`);

// --- STRICT HEADERS ---
// Lưu ý: Không set 'authority' thủ công vì fetch sẽ tự lấy từ URL.
// Nếu set tay 'authority' trong Bun/Node có thể gây lỗi protocol.
const UPSTREAM_HEADERS = {
  'accept': 'text/event-stream',
  'accept-language': 'vi-VN,vi;q=0.9',
  'cache-control': 'no-cache',
  'content-type': 'application/json',
  'origin': 'https://chat.dphn.ai',
  'referer': 'https://chat.dphn.ai/',
  // Quan trọng: Copy chính xác string này
  'sec-ch-ua': '"Chromium";v="137", "Not/A)Brand";v="24"', 
  'sec-ch-ua-mobile': '?1',
  'sec-ch-ua-platform': '"Android"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
  // Thêm header này vì curl dùng --compressed
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

app.get('/v1/models', (c) => {
  return c.json({ object: "list", data: AVAILABLE_MODELS });
});

app.post('/v1/chat/completions', async (c) => {
  try {
    const body = await c.req.json();
    const model = body.model || AVAILABLE_MODELS[0].id;

    console.log(`[Request] Model: ${model}`);

    // Construct Payload chính xác như curl
    const payload = {
      messages: body.messages,
      model: model,
      template: "logical" 
    };

    const response = await fetch(UPSTREAM_URL, {
      method: 'POST',
      headers: UPSTREAM_HEADERS,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const errText = await response.text();
        console.error(`[Upstream Error ${response.status}]`, errText);
        // Trả về lỗi nguyên bản để debug
        return c.json({ error: "Upstream Error", details: errText, status: response.status }, response.status as any);
    }

    // Bun tự động xử lý giải nén (gzip/br) nếu server trả về nén
    // Ta pipe trực tiếp body về client
    return new Response(response.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      }
    });

  } catch (e: any) {
    console.error("[Internal Error]", e);
    return c.json({ error: { message: e.message } }, 500);
  }
});

app.get('/', (c) => c.text('DPHN OpenAI Proxy is running.'));

export default {
  port: PORT,
  fetch: app.fetch,
};
