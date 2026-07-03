import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import mammoth from 'mammoth';
import { createRequire } from 'module';
import db from './db.js';
import { signToken, authRequired } from './auth.js';

// pdf-parse is a CommonJS module, use createRequire to import it correctly
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const RELAY_BASE_URL = process.env.RELAY_BASE_URL || 'https://jingyuqingfeng.cn/v1';
const RELAY_API_KEY = process.env.RELAY_API_KEY;
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'gpt-5.4-mini';
const PORT = process.env.PORT || 8787;

if (!RELAY_API_KEY) {
  console.warn('[warn] RELAY_API_KEY is not set. Copy .env.example to .env and fill it in.');
}

// ---------- Auth ----------
app.post('/api/auth/register', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  if (password.length < 6) return res.status(400).json({ error: 'password must be at least 6 chars' });
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) return res.status(409).json({ error: 'email already registered' });
  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email, hash);
  const user = { id: info.lastInsertRowid, email };
  res.json({ token: signToken(user), user: { id: user.id, email } });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'invalid credentials' });
  }
  res.json({ token: signToken(user), user: { id: user.id, email: user.email } });
});

app.get('/api/me', authRequired, (req, res) => {
  res.json({ user: { id: req.user.id, email: req.user.email } });
});

// ---------- File Upload ----------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

app.post('/api/upload', authRequired, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file uploaded' });

  const filename = req.file.originalname;
  const buffer = req.file.buffer;
  const ext = filename.toLowerCase().split('.').pop();

  try {
    let textContent = '';

    if (ext === 'txt' || ext === 'md') {
      textContent = buffer.toString('utf-8');
    } else if (ext === 'pdf') {
      const data = await pdfParse(buffer);
      textContent = data.text;
    } else if (ext === 'docx') {
      const result = await mammoth.extractRawText({ buffer });
      textContent = result.value;
    } else {
      return res.status(400).json({ error: `unsupported file type: .${ext}` });
    }

    if (!textContent.trim()) {
      return res.status(400).json({ error: 'file appears to be empty or unreadable' });
    }

    res.json({ filename, textContent });
  } catch (err) {
    console.error('file parse error', err);
    res.status(500).json({ error: 'failed to parse file: ' + err.message });
  }
});

// ---------- Conversations ----------
app.get('/api/conversations', authRequired, (req, res) => {
  const rows = db.prepare(
    'SELECT id, title, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC'
  ).all(req.user.id);
  res.json(rows);
});

app.post('/api/conversations', authRequired, (req, res) => {
  const title = (req.body && req.body.title) || 'New chat';
  const info = db.prepare('INSERT INTO conversations (user_id, title) VALUES (?, ?)').run(req.user.id, title);
  const row = db.prepare('SELECT id, title, created_at, updated_at FROM conversations WHERE id = ?').get(info.lastInsertRowid);
  res.json(row);
});

app.get('/api/conversations/:id/messages', authRequired, (req, res) => {
  const conv = db.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!conv) return res.status(404).json({ error: 'conversation not found' });
  const rows = db.prepare(
    'SELECT id, role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY id ASC'
  ).all(req.params.id);
  res.json(rows);
});

app.patch('/api/conversations/:id', authRequired, (req, res) => {
  const conv = db.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!conv) return res.status(404).json({ error: 'conversation not found' });
  const title = (req.body && req.body.title) || 'New chat';
  db.prepare('UPDATE conversations SET title = ?, updated_at = datetime(\'now\') WHERE id = ?').run(title, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/conversations/:id', authRequired, (req, res) => {
  const conv = db.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!conv) return res.status(404).json({ error: 'conversation not found' });
  db.prepare('DELETE FROM conversations WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Chat (SSE streaming) ----------
// Body: { conversationId, content, model? }
// Streams tokens as SSE events: {type:'delta', text}, then {type:'done', messageId}.
app.post('/api/chat', authRequired, async (req, res) => {
  const { conversationId, content, model } = req.body || {};
  if (!conversationId || !content) {
    return res.status(400).json({ error: 'conversationId and content required' });
  }
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?').get(conversationId, req.user.id);
  if (!conv) return res.status(404).json({ error: 'conversation not found' });

  // Persist the user's message first.
  db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)')
    .run(conversationId, 'user', content);

  // Auto-title from the first user message.
  const msgCount = db.prepare('SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ?').get(conversationId).c;
  if (msgCount === 1 && (conv.title === 'New chat' || !conv.title)) {
    const title = content.slice(0, 40).replace(/\s+/g, ' ').trim() || 'New chat';
    db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, conversationId);
  }

  // Build the full history for context.
  const history = db.prepare(
    'SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id ASC'
  ).all(conversationId);

  // Add system prompt to inform AI about its model version.
  const systemPrompt = {
    role: 'system',
    content: `你是一个智能助手。当用户询问你的身份或版本时，请如实回答：你是 ${model || DEFAULT_MODEL} 模型。`,
  };
  const messagesWithSystem = [systemPrompt, ...history.map((m) => ({ role: m.role, content: m.content }))];

  // SSE headers.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering if present
  res.flushHeaders?.();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  let full = '';
  try {
    const upstream = await fetch(`${RELAY_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RELAY_API_KEY}`,
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        stream: true,
        messages: messagesWithSystem,
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const errText = await upstream.text().catch(() => '');
      send({ type: 'error', error: `Upstream error ${upstream.status}: ${errText.slice(0, 300)}` });
      return res.end();
    }

    // Parse the upstream SSE stream and forward content deltas.
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
        if (data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            full += delta;
            send({ type: 'delta', text: delta });
          }
        } catch {
          // ignore keep-alive or partial lines
        }
      }
    }

    // Persist the assistant's full reply.
    const info = db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)')
      .run(conversationId, 'assistant', full);
    db.prepare('UPDATE conversations SET updated_at = datetime(\'now\') WHERE id = ?').run(conversationId);

    send({ type: 'done', messageId: info.lastInsertRowid });
    res.end();
  } catch (err) {
    console.error('chat error', err);
    // Save whatever we streamed so it isn't lost.
    if (full) {
      db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)')
        .run(conversationId, 'assistant', full);
    }
    send({ type: 'error', error: err.message || 'stream failed' });
    res.end();
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, model: DEFAULT_MODEL }));

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
  console.log(`Relay: ${RELAY_BASE_URL}  Model: ${DEFAULT_MODEL}`);
});
