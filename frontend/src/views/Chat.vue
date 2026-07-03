<template>
  <div class="shell">
    <!-- Sidebar -->
    <aside class="sidebar">
      <div class="sidebar-head">
        <div class="sidebar-brand">ChatGPT</div>
        <button class="new-chat" @click="startNew">＋ 新建对话</button>
      </div>
      <div class="conv-list">
        <div
          v-for="c in chat.conversations"
          :key="c.id"
          class="conv-item"
          :class="{ active: c.id === chat.activeId }"
          @click="open(c.id)"
        >
          <span class="conv-title">{{ c.title || '新对话' }}</span>
          <button class="conv-del" title="删除" @click.stop="remove(c.id)">🗑</button>
        </div>
      </div>
      <div class="sidebar-foot">
        <div class="email">{{ auth.user?.email }}</div>
        <button class="logout" @click="logout">退出登录</button>
      </div>
    </aside>

    <!-- Main -->
    <main class="main">
      <div class="messages" ref="scrollEl" @click="handleMessageClick">
        <div v-if="chat.messages.length === 0" class="empty">
          <div>
            <div class="empty-mark">GPT</div>
            <h2>有什么可以帮忙的？</h2>
            <p>输入任何问题开始对话</p>
          </div>
        </div>
        <div v-for="(m, i) in chat.messages" :key="m.id" class="msg-row" :class="m.role">
          <div class="msg-inner" :class="m.role">
            <div class="avatar" :class="m.role" :aria-label="m.role === 'user' ? '用户' : 'AI'">
              <span v-if="m.role === 'user'" class="avatar-user-mark" aria-hidden="true"></span>
              <span v-else class="avatar-gpt-mark" aria-hidden="true">GPT</span>
            </div>
            <div
              class="bubble"
              :class="[m.role, { cursor: chat.streaming && m.role === 'assistant' && i === chat.messages.length - 1 }]"
            >
              <span v-if="isThinking(m, i)" class="thinking-text">深度思考中</span>
              <template v-else>
                <div class="bubble-content" v-html="render(m.content)"></div>
                <div v-if="m.role === 'assistant' && m.content" class="message-actions">
                  <button class="copy-btn" type="button" @click="copyAssistantMessage(m)">
                    {{ copiedMessageId === m.id ? '已复制' : '复制' }}
                  </button>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>

      <div class="composer-wrap">
        <!-- File card -->
        <div v-if="attachedFile" class="file-card">
          <span class="file-icon">📄</span>
          <span class="file-name">{{ attachedFile.filename }}</span>
          <button class="file-remove" @click="removeFile" title="移除">×</button>
        </div>
        <div v-if="uploading" class="uploading-hint">正在上传文件…</div>
        <div v-if="uploadError" class="upload-error">{{ uploadError }}</div>

        <div class="composer">
          <input
            ref="fileInput"
            type="file"
            accept=".txt,.md"
            style="display: none"
            @change="handleFileSelect"
          />
          <button class="attach-btn" :disabled="uploading || chat.streaming" @click="triggerUpload" title="上传文件">📎</button>
          <textarea
            ref="taEl"
            v-model="draft"
            rows="1"
            placeholder="输入消息…"
            @input="autogrow"
            @keydown.enter.exact.prevent="submit"
          ></textarea>
          <button class="send-btn" :disabled="!canSend" @click="submit" title="发送">↑</button>
        </div>
        <p class="hint">Designed by Xia Zhenxiang. 按 Enter 发送，Shift+Enter 换行。支持上传 .txt/.md 文件。</p>
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick, watch } from 'vue';
import { useRouter } from 'vue-router';
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';
import { useAuthStore } from '../stores/auth';
import { useChatStore } from '../stores/chat';
import { uploadFile } from '../api';

const router = useRouter();
const auth = useAuthStore();
const chat = useChatStore();

const draft = ref('');
const scrollEl = ref(null);
const taEl = ref(null);
const fileInput = ref(null);
const copiedMessageId = ref(null);
let copyTimer = null;

// File upload state
const attachedFile = ref(null); // { filename, textContent }
const uploading = ref(false);
const uploadError = ref('');

const md = new MarkdownIt({
  linkify: true,
  breaks: true,
  highlight(str, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(str, { language: lang }).value;
      } catch {}
    }
    return md.utils.escapeHtml(str);
  },
});

md.renderer.rules.fence = (tokens, idx, options) => {
  const token = tokens[idx];
  const rawInfo = token.info ? token.info.trim() : '';
  const langName = rawInfo.split(/\s+/g)[0] || '';
  const highlighted = options.highlight
    ? options.highlight(token.content, langName, '')
    : md.utils.escapeHtml(token.content);
  const langLabel = langName ? md.utils.escapeHtml(langName) : '代码';
  const langClass = langName ? ` class="language-${md.utils.escapeHtml(langName)}"` : '';
  const encodedCode = md.utils.escapeHtml(encodeURIComponent(token.content));

  return `<div class="code-block"><div class="code-toolbar"><span>${langLabel}</span><button class="code-copy-btn" type="button" data-code="${encodedCode}">复制</button></div><pre><code${langClass}>${highlighted}</code></pre></div>`;
};

function render(text) {
  return md.render(text || '');
}

function isThinking(message, index) {
  return chat.streaming && message.role === 'assistant' && index === chat.messages.length - 1 && !message.content;
}

async function copyAssistantMessage(message) {
  if (!message.content) return;
  const copied = await copyText(message.content);
  if (!copied) return;
  copiedMessageId.value = message.id;
  window.clearTimeout(copyTimer);
  copyTimer = window.setTimeout(() => {
    copiedMessageId.value = null;
  }, 1500);
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    return true;
  } catch {
    return false;
  }
}

async function handleMessageClick(event) {
  const button = event.target.closest?.('.code-copy-btn');
  if (!button) return;
  const encodedCode = button.dataset.code;
  if (!encodedCode) return;
  const copied = await copyText(decodeURIComponent(encodedCode));
  if (!copied) return;
  button.textContent = '已复制';
  window.setTimeout(() => {
    button.textContent = '复制';
  }, 1500);
}

const canSend = computed(() => (draft.value.trim().length > 0 || attachedFile.value) && !chat.streaming && !uploading.value);

function scrollToBottom() {
  nextTick(() => {
    if (scrollEl.value) scrollEl.value.scrollTop = scrollEl.value.scrollHeight;
  });
}

watch(() => chat.messages.map((m) => m.content).join('|'), scrollToBottom);

function autogrow() {
  const el = taEl.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 200) + 'px';
}

function triggerUpload() {
  fileInput.value?.click();
}

async function handleFileSelect(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  uploadError.value = '';
  uploading.value = true;
  try {
    const result = await uploadFile(file);
    attachedFile.value = result;
  } catch (err) {
    uploadError.value = err.message || '上传失败';
  } finally {
    uploading.value = false;
    // Reset input so same file can be selected again
    e.target.value = '';
  }
}

function removeFile() {
  attachedFile.value = null;
  uploadError.value = '';
}

async function submit() {
  if (!canSend.value) return;

  // Build the message content, prepending file content if attached.
  let text = draft.value.trim();
  if (attachedFile.value) {
    text = `以下是用户上传的文件《${attachedFile.value.filename}》的内容：\n\n${attachedFile.value.textContent}\n\n---\n用户的问题：${text || '请帮我分析这个文件的内容'}`;
  }

  draft.value = '';
  autogrow();
  const fileToSend = attachedFile.value;
  attachedFile.value = null;
  uploadError.value = '';

  await chat.send(text);
  scrollToBottom();
}

async function open(id) {
  await chat.selectConversation(id);
  scrollToBottom();
}

async function startNew() {
  // Reset any stuck streaming state
  chat.streaming = false;
  chat.activeId = null;
  chat.messages = [];
  draft.value = '';
  attachedFile.value = null;
  uploadError.value = '';
}

async function remove(id) {
  if (confirm('确定删除这个对话？')) await chat.deleteConversation(id);
}

function logout() {
  auth.logout();
  router.push({ name: 'login' });
}

onMounted(async () => {
  // Reset all potentially stuck states on page load
  chat.streaming = false;
  chat.error = '';
  uploading.value = false;
  attachedFile.value = null;
  uploadError.value = '';
  try {
    await chat.loadConversations();
  } catch {
    // token likely expired
    auth.logout();
    router.push({ name: 'login' });
  }
});
</script>
