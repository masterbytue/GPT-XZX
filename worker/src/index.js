import bcrypt from 'bcryptjs';

const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(env) });
    }

    try {
      const url = new URL(request.url);
      const { pathname } = url;

      if (request.method === 'POST' && pathname === '/api/auth/register') return register(request, env);
      if (request.method === 'POST' && pathname === '/api/auth/login') return login(request, env);
      if (request.method === 'GET' && pathname === '/api/me') return withAuth(request, env, getMe);
      if (request.method === 'POST' && pathname === '/api/upload') return withAuth(request, env, uploadFile);
      if (request.method === 'GET' && pathname === '/api/conversations') return withAuth(request, env, listConversations);
      if (request.method === 'POST' && pathname === '/api/conversations') return withAuth(request, env, createConversation);
      if (request.method === 'GET' && /^\/api\/conversations\/\d+\/messages$/.test(pathname)) {
        return withAuth(request, env, getMessages);
      }
      if (request.method === 'PATCH' && /^\/api\/conversations\/\d+$/.test(pathname)) {
        return withAuth(request, env, updateConversation);
      }
      if (request.method === 'DELETE' && /^\/api\/conversations\/\d+$/.test(pathname)) {
        return withAuth(request, env, deleteConversation);
      }
      if (request.method === 'POST' && pathname === '/api/chat') return withAuth(request, env, streamChat, ctx);
      if (request.method === 'GET' && pathname === '/api/health') {
        return json({ ok: true, model: env.DEFAULT_MODEL || 'gpt-5.4-mini' }, env);
      }

      return json({ error: 'not found' }, env, 404);
    } catch (err) {
      return json({ error: err.message || 'internal error' }, env, 500);
    }
  },
};

async function register(request, env) {
  const { email, password } = await readJson(request);
  if (!email || !password) return json({ error: 'email and password required' }, env, 400);
  if (password.length < 6) return json({ error: 'password must be at least 6 chars' }, env, 400);

  const exists = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (exists) return json({ error: 'email already registered' }, env, 409);

  const passwordHash = await bcrypt.hash(password, 10);
  const result = await env.DB.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
    .bind(email, passwordHash)
    .run();
  const user = { id: result.meta.last_row_id, email };
  const token = await signToken(user, env.JWT_SECRET || 'dev-secret');
  return json({ token, user }, env);
}

async function login(request, env) {
  const { email, password } = await readJson(request);
  if (!email || !password) return json({ error: 'email and password required' }, env, 400);

  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return json({ error: 'invalid credentials' }, env, 401);
  }

  const safeUser = { id: user.id, email: user.email };
  const token = await signToken(safeUser, env.JWT_SECRET || 'dev-secret');
  return json({ token, user: safeUser }, env);
}

async function getMe(_request, env, user) {
  return json({ user: { id: user.id, email: user.email } }, env);
}

async function uploadFile(request, env) {
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return json({ error: 'no file uploaded' }, env, 400);
  if (file.size > MAX_UPLOAD_BYTES) return json({ error: 'file too large' }, env, 413);

  const filename = file.name || 'upload.txt';
  const ext = filename.toLowerCase().split('.').pop();
  if (ext !== 'txt' && ext !== 'md') {
    return json({ error: 'Cloudflare Worker upload currently supports .txt and .md only' }, env, 400);
  }

  const textContent = await file.text();
  if (!textContent.trim()) return json({ error: 'file appears to be empty or unreadable' }, env, 400);
  return json({ filename, textContent }, env);
}

async function listConversations(_request, env, user) {
  const result = await env.DB.prepare(
    'SELECT id, title, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC'
  ).bind(user.id).all();
  return json(result.results || [], env);
}

async function createConversation(request, env, user) {
  const body = await readJson(request).catch(() => ({}));
  const title = body.title || 'New chat';
  const result = await env.DB.prepare('INSERT INTO conversations (user_id, title) VALUES (?, ?)')
    .bind(user.id, title)
    .run();
  const row = await env.DB.prepare(
    'SELECT id, title, created_at, updated_at FROM conversations WHERE id = ? AND user_id = ?'
  ).bind(result.meta.last_row_id, user.id).first();
  return json(row, env);
}

async function getMessages(request, env, user) {
  const id = conversationIdFromPath(request.url);
  const conv = await findConversation(env, id, user.id);
  if (!conv) return json({ error: 'conversation not found' }, env, 404);

  const result = await env.DB.prepare(
    'SELECT id, role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY id ASC'
  ).bind(id).all();
  return json(result.results || [], env);
}

async function updateConversation(request, env, user) {
  const id = conversationIdFromPath(request.url);
  const conv = await findConversation(env, id, user.id);
  if (!conv) return json({ error: 'conversation not found' }, env, 404);

  const body = await readJson(request).catch(() => ({}));
  const title = body.title || 'New chat';
  await env.DB.prepare("UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
    .bind(title, id, user.id)
    .run();
  return json({ ok: true }, env);
}

async function deleteConversation(request, env, user) {
  const id = conversationIdFromPath(request.url);
  const conv = await findConversation(env, id, user.id);
  if (!conv) return json({ error: 'conversation not found' }, env, 404);

  await env.DB.batch([
    env.DB.prepare('DELETE FROM messages WHERE conversation_id = ?').bind(id),
    env.DB.prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?').bind(id, user.id),
  ]);
  return json({ ok: true }, env);
}

async function streamChat(request, env, user, ctx) {
  const { conversationId, content, model } = await readJson(request);
  if (!conversationId || !content) return json({ error: 'conversationId and content required' }, env, 400);

  const conv = await findConversation(env, conversationId, user.id);
  if (!conv) return json({ error: 'conversation not found' }, env, 404);

  await env.DB.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)')
    .bind(conversationId, 'user', content)
    .run();

  const countRow = await env.DB.prepare('SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ?')
    .bind(conversationId)
    .first();
  if (countRow.c === 1 && (conv.title === 'New chat' || !conv.title)) {
    const title = content.slice(0, 40).replace(/\s+/g, ' ').trim() || 'New chat';
    await env.DB.prepare("UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(title, conversationId)
      .run();
  }

  const historyResult = await env.DB.prepare(
    'SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id ASC'
  ).bind(conversationId).all();

  const activeModel = model || env.DEFAULT_MODEL || 'gpt-5.4-mini';
  const systemPrompt = {
    role: 'system',
    content: `你是一个智能助手。当用户询问你的身份或版本时，请如实回答：你是 ${activeModel} 模型。`,
  };
  const messages = [
    systemPrompt,
    ...(historyResult.results || []).map((m) => ({ role: m.role, content: m.content })),
  ];

  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();
  const send = (obj) => writer.write(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

  ctx.waitUntil((async () => {
    let full = '';
    try {
      const upstream = await fetch(`${env.RELAY_BASE_URL || 'https://jingyuqingfeng.cn/v1'}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.RELAY_API_KEY}`,
        },
        body: JSON.stringify({ model: activeModel, stream: true, messages }),
      });

      if (!upstream.ok || !upstream.body) {
        const errText = await upstream.text().catch(() => '');
        await send({ type: 'error', error: `Upstream error ${upstream.status}: ${errText.slice(0, 300)}` });
        return;
      }

      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const evt = JSON.parse(data);
            const delta = evt.choices?.[0]?.delta?.content;
            if (delta) {
              full += delta;
              await send({ type: 'delta', text: delta });
            }
          } catch {
            // Ignore upstream keep-alives and partial chunks.
          }
        }
      }

      const result = await env.DB.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)')
        .bind(conversationId, 'assistant', full)
        .run();
      await env.DB.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?")
        .bind(conversationId)
        .run();
      await send({ type: 'done', messageId: result.meta.last_row_id });
    } catch (err) {
      if (full) {
        await env.DB.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)')
          .bind(conversationId, 'assistant', full)
          .run();
      }
      await send({ type: 'error', error: err.message || 'stream failed' });
    } finally {
      await writer.close();
    }
  })());

  return new Response(stream.readable, {
    headers: {
      ...corsHeaders(env),
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

async function withAuth(request, env, handler, ctx) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return json({ error: 'Missing token' }, env, 401);

  const user = await verifyToken(token, env.JWT_SECRET || 'dev-secret');
  if (!user) return json({ error: 'Invalid or expired token' }, env, 401);
  return handler(request, env, user, ctx);
}

async function findConversation(env, id, userId) {
  return env.DB.prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first();
}

function conversationIdFromPath(url) {
  const parts = new URL(url).pathname.split('/');
  return Number(parts[3]);
}

async function readJson(request) {
  return request.json();
}

function json(body, env, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(env),
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.CORS_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  };
}

async function signToken(user, secret) {
  const header = base64urlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = base64urlJson({
    id: user.id,
    email: user.email,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  });
  const data = `${header}.${payload}`;
  const signature = await hmac(data, secret);
  return `${data}.${signature}`;
}

async function verifyToken(token, secret) {
  const [header, payload, signature] = token.split('.');
  if (!header || !payload || !signature) return null;
  const expected = await hmac(`${header}.${payload}`, secret);
  if (expected !== signature) return null;

  try {
    const data = JSON.parse(textFromBase64url(payload));
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return { id: data.id, email: data.email };
  } catch {
    return null;
  }
}

async function hmac(data, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return base64urlBytes(new Uint8Array(signature));
}

function base64urlJson(value) {
  return base64urlBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function base64urlBytes(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function textFromBase64url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
