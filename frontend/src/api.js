// Thin fetch wrapper. In dev, calls go to /api and Vite proxies them to the local backend.
// In production, set VITE_API_BASE to the Worker origin, for example https://chat-app-api.example.workers.dev.
import { useAuthStore } from './stores/auth';

const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');

function apiUrl(path) {
  return `${API_BASE}/api${path}`;
}

function headers(json = true) {
  const auth = useAuthStore();
  const h = {};
  if (json) h['Content-Type'] = 'application/json';
  if (auth.token) h['Authorization'] = `Bearer ${auth.token}`;
  return h;
}

export async function apiGet(path) {
  const res = await fetch(apiUrl(path), { headers: headers(false) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

export async function apiPost(path, body) {
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

export async function apiPatch(path, body) {
  const res = await fetch(apiUrl(path), {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

export async function apiDelete(path) {
  const res = await fetch(apiUrl(path), { method: 'DELETE', headers: headers(false) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

// Upload file and get extracted text content.
export async function uploadFile(file) {
  const auth = useAuthStore();
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(apiUrl('/upload'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth.token}` },
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'upload failed');
  }
  return res.json();
}

// Streams the chat response. Calls onDelta(text) for each token chunk.
export async function streamChat({ conversationId, content }, onDelta) {
  const auth = useAuthStore();
  const res = await fetch(apiUrl('/chat'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.token}`,
    },
    body: JSON.stringify({ conversationId, content }),
  });
  if (!res.ok || !res.body) {
    throw new Error((await res.json().catch(() => ({}))).error || 'stream failed');
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const data = t.slice(5).trim();
      if (!data) continue;
      try {
        const evt = JSON.parse(data);
        if (evt.type === 'delta') onDelta(evt.text);
        else if (evt.type === 'error') throw new Error(evt.error);
      } catch (e) {
        if (e instanceof Error && e.message) throw e;
      }
    }
  }
}
