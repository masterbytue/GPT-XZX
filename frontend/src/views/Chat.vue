<template>
  <div class="chat-shell" :class="{ 'sidebar-collapsed': !sidebarOpen, 'is-dark': theme === 'dark' }">
    <button v-if="sidebarOpen" class="sidebar-scrim" type="button" aria-label="关闭侧边栏" @click="sidebarOpen = false"></button>

    <aside class="sidebar" :class="{ open: sidebarOpen }">
      <div class="sidebar-topbar">
        <button class="brand-button" type="button" aria-label="GPT-XZX 首页" @click="startNew">
          <span class="brand-mark"><AppIcon name="spark" /></span><span>GPT-XZX</span>
        </button>
        <button class="icon-button sidebar-toggle" type="button" title="收起侧边栏" @click="sidebarOpen = false"><AppIcon name="panel" /></button>
      </div>

      <nav class="sidebar-actions" aria-label="聊天操作">
        <button type="button" @click="startNew"><AppIcon name="compose" /><span>新建对话</span><kbd>Ctrl K</kbd></button>
        <label class="search-box"><AppIcon name="search" /><input v-model="searchQuery" type="search" placeholder="搜索对话" aria-label="搜索对话" /></label>
      </nav>

      <div class="conversation-scroll">
        <div v-if="chat.conversations.length === 0" class="sidebar-empty">还没有对话</div>
        <div v-else-if="conversationGroups.length === 0" class="sidebar-empty">没有找到相关对话</div>
        <section v-for="group in conversationGroups" :key="group.label" class="conversation-group">
          <h2>{{ group.label }}</h2>
          <div v-for="conversation in group.items" :key="conversation.id" class="conversation-item" :class="{ active: conversation.id === chat.activeId }">
            <input
              v-if="editingId === conversation.id"
              :ref="(el) => setRenameInput(el, conversation.id)"
              v-model="editingTitle"
              class="rename-input"
              maxlength="80"
              @click.stop
              @keydown.enter.prevent="saveRename(conversation.id)"
              @keydown.esc.prevent="cancelRename"
              @blur="saveRename(conversation.id)"
            />
            <button v-else class="conversation-open" type="button" @click="open(conversation.id)"><span>{{ conversation.title || '新对话' }}</span></button>
            <div v-if="editingId !== conversation.id" class="conversation-tools">
              <button type="button" title="重命名" @click="beginRename(conversation)"><AppIcon name="edit" /></button>
              <button class="danger" type="button" title="删除" @click="remove(conversation.id)"><AppIcon name="trash" /></button>
            </div>
          </div>
        </section>
      </div>

      <div class="account-area">
        <button class="account-button" type="button" @click="accountMenuOpen = !accountMenuOpen">
          <span class="account-avatar">{{ userInitial }}</span>
          <span class="account-copy"><strong>{{ userName }}</strong><small>个人工作区</small></span>
          <AppIcon :name="accountMenuOpen ? 'chevron-down' : 'chevron-up'" />
        </button>
        <div v-if="accountMenuOpen" class="account-menu">
          <button type="button" @click="toggleTheme"><AppIcon :name="theme === 'dark' ? 'sun' : 'moon'" />{{ theme === 'dark' ? '使用浅色模式' : '使用深色模式' }}</button>
          <button type="button" @click="logout"><AppIcon name="logout" />退出登录</button>
        </div>
      </div>
    </aside>

    <main class="chat-main" @dragenter.prevent="dragActive = true" @dragover.prevent="dragActive = true" @dragleave.self="dragActive = false" @drop.prevent="handleDrop">
      <header class="chat-header">
        <button v-if="!sidebarOpen" class="icon-button" type="button" title="打开侧边栏" @click="sidebarOpen = true"><AppIcon name="panel" /></button>
        <button class="model-button" type="button" aria-label="当前模型"><span>GPT-XZX</span><span class="model-badge">5.4 mini</span><AppIcon name="chevron-down" /></button>
        <div class="header-spacer"></div>
        <button class="new-chat-mobile" type="button" title="新建对话" @click="startNew"><AppIcon name="compose" /></button>
      </header>

      <div ref="scrollEl" class="messages" @scroll="handleScroll" @click="handleMessageClick">
        <section v-if="chat.messages.length === 0" class="welcome">
          <div class="welcome-inner">
            <div class="welcome-mark"><AppIcon name="spark" /></div>
            <p class="eyebrow">你的智能工作台</p>
            <h1>{{ greeting }}，{{ userName }}</h1>
            <p class="welcome-copy">把问题、想法或文件交给我，我们一起把它变成清晰的答案。</p>
            <div class="prompt-grid">
              <button v-for="prompt in prompts" :key="prompt.title" type="button" @click="usePrompt(prompt.text)">
                <span class="prompt-icon"><AppIcon :name="prompt.icon" /></span>
                <span><strong>{{ prompt.title }}</strong><small>{{ prompt.description }}</small></span>
              </button>
            </div>
          </div>
        </section>

        <section v-else class="message-list" aria-live="polite">
          <article v-for="(message, index) in chat.messages" :key="message.id" class="message" :class="message.role">
            <div class="message-inner">
              <div v-if="message.role === 'assistant'" class="assistant-mark"><AppIcon name="spark" /></div>
              <div class="message-content" :class="{ cursor: chat.streaming && message.role === 'assistant' && index === chat.messages.length - 1 }">
                <div v-if="isThinking(message, index)" class="thinking" aria-label="正在生成回答"><span></span><span></span><span></span></div>
                <template v-else>
                  <div class="markdown-body" v-html="render(message.content)"></div>
                  <div v-if="message.role === 'assistant' && message.content" class="message-actions">
                    <button type="button" :title="copiedMessageId === message.id ? '已复制' : '复制回答'" @click="copyAssistantMessage(message)">
                      <AppIcon :name="copiedMessageId === message.id ? 'check' : 'copy'" /><span>{{ copiedMessageId === message.id ? '已复制' : '复制' }}</span>
                    </button>
                  </div>
                </template>
              </div>
            </div>
          </article>
        </section>
      </div>

      <button v-if="showScrollButton" class="scroll-bottom" type="button" title="回到底部" @click="scrollToBottom(true)"><AppIcon name="chevron-down" /></button>
      <div v-if="dragActive" class="drop-zone"><div><AppIcon name="file" /></div><strong>松开以上传文件</strong><span>支持 TXT 和 Markdown，最大 10 MB</span></div>

      <footer class="composer-region">
        <div v-if="chat.error" class="status-message error" role="alert">{{ chat.error }}</div>
        <div v-if="uploading" class="status-message">正在读取文件…</div>
        <div v-if="uploadError" class="status-message error" role="alert">{{ uploadError }}</div>
        <div class="composer-card" :class="{ focused: composerFocused }">
          <div v-if="attachedFile" class="attachment-card">
            <span class="attachment-icon"><AppIcon name="file" /></span>
            <span><strong>{{ attachedFile.filename }}</strong><small>文档 · {{ formatTextSize(attachedFile.textContent) }}</small></span>
            <button type="button" title="移除文件" @click="removeFile"><AppIcon name="close" /></button>
          </div>
          <textarea
            ref="taEl"
            v-model="draft"
            rows="1"
            aria-label="消息输入框"
            placeholder="给 GPT-XZX 发消息"
            @focus="composerFocused = true"
            @blur="composerFocused = false"
            @input="autogrow"
            @keydown.enter.exact.prevent="submit"
          ></textarea>
          <div class="composer-toolbar">
            <div><input ref="fileInput" type="file" accept=".txt,.md,text/plain,text/markdown" hidden @change="handleFileSelect" /><button class="tool-button" type="button" :disabled="uploading || chat.streaming" title="添加文件" @click="triggerUpload"><AppIcon name="clip" /></button></div>
            <button v-if="chat.streaming" class="send-button stop" type="button" title="停止生成" @click="chat.stop"><AppIcon name="stop" /></button>
            <button v-else class="send-button" type="button" :disabled="!canSend" title="发送消息" @click="submit"><AppIcon name="arrow-up" /></button>
          </div>
        </div>
        <p class="composer-note">GPT-XZX 可能会犯错，请核查重要信息。Enter 发送，Shift + Enter 换行。</p>
      </footer>
    </main>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';
import AppIcon from '../components/AppIcon.vue';
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
const attachedFile = ref(null);
const uploading = ref(false);
const uploadError = ref('');
const searchQuery = ref('');
const editingId = ref(null);
const editingTitle = ref('');
const renameInputs = new Map();
const accountMenuOpen = ref(false);
const sidebarOpen = ref(window.innerWidth > 820);
const dragActive = ref(false);
const composerFocused = ref(false);
const showScrollButton = ref(false);
const stickToBottom = ref(true);
const theme = ref(localStorage.getItem('theme') || 'light');
let copyTimer = null;

const prompts = [
  { title: '整理思路', description: '把复杂问题拆成行动步骤', text: '请帮我把一个复杂问题拆解成清晰、可执行的步骤。先问我问题是什么。', icon: 'spark' },
  { title: '润色文字', description: '让表达更清晰、更自然', text: '请帮我润色一段文字，保留原意，让表达更自然专业。先提示我粘贴原文。', icon: 'edit' },
  { title: '分析文档', description: '提炼重点与关键结论', text: '我想分析一份文档。请告诉我你可以从哪些维度帮我提炼信息。', icon: 'file' },
  { title: '编写代码', description: '从需求到可运行实现', text: '请作为我的编程搭档，先询问技术栈和具体需求，再给出可靠的实现方案。', icon: 'compose' },
];

const md = new MarkdownIt({
  linkify: true,
  breaks: true,
  highlight(source, language) {
    if (language && hljs.getLanguage(language)) {
      try { return hljs.highlight(source, { language }).value; } catch {}
    }
    return md.utils.escapeHtml(source);
  },
});

md.renderer.rules.fence = (tokens, index, options) => {
  const token = tokens[index];
  const language = (token.info || '').trim().split(/\s+/g)[0] || '';
  const highlighted = options.highlight ? options.highlight(token.content, language, '') : md.utils.escapeHtml(token.content);
  const label = language ? md.utils.escapeHtml(language) : '代码';
  const languageClass = language ? ` class="language-${md.utils.escapeHtml(language)}"` : '';
  const encodedCode = md.utils.escapeHtml(encodeURIComponent(token.content));
  return `<div class="code-block"><div class="code-toolbar"><span>${label}</span><button class="code-copy-btn" type="button" data-code="${encodedCode}">复制代码</button></div><pre><code${languageClass}>${highlighted}</code></pre></div>`;
};

const defaultLinkOpen = md.renderer.rules.link_open || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet('target', '_blank');
  tokens[idx].attrSet('rel', 'noopener noreferrer');
  return defaultLinkOpen(tokens, idx, options, env, self);
};

const userName = computed(() => auth.user?.email?.split('@')[0] || '朋友');
const userInitial = computed(() => userName.value.slice(0, 1).toUpperCase());
const greeting = computed(() => {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 12) return '早上好';
  if (hour < 18) return '下午好';
  return '晚上好';
});
const canSend = computed(() => Boolean(draft.value.trim() || attachedFile.value) && !chat.streaming && !uploading.value);
const filteredConversations = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  return query ? chat.conversations.filter((item) => (item.title || '新对话').toLowerCase().includes(query)) : chat.conversations;
});
const conversationGroups = computed(() => {
  const groups = new Map();
  filteredConversations.value.forEach((item) => {
    const label = dateLabel(item.updated_at || item.created_at);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(item);
  });
  return [...groups.entries()].map(([label, items]) => ({ label, items }));
});

function dateLabel(value) {
  if (!value) return '较早';
  const date = new Date(value.endsWith?.('Z') ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return '较早';
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((startToday - startDate) / 86400000);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 7) return '过去 7 天';
  if (days < 30) return '过去 30 天';
  return '较早';
}

function render(text) { return md.render(text || ''); }
function isThinking(message, index) { return chat.streaming && message.role === 'assistant' && index === chat.messages.length - 1 && !message.content; }
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    return copied;
  }
}
async function copyAssistantMessage(message) {
  if (!message.content || !(await copyText(message.content))) return;
  copiedMessageId.value = message.id;
  window.clearTimeout(copyTimer);
  copyTimer = window.setTimeout(() => { copiedMessageId.value = null; }, 1600);
}
async function handleMessageClick(event) {
  const button = event.target.closest?.('.code-copy-btn');
  if (!button?.dataset.code || !(await copyText(decodeURIComponent(button.dataset.code)))) return;
  button.textContent = '已复制';
  window.setTimeout(() => { button.textContent = '复制代码'; }, 1600);
}
function autogrow() {
  if (!taEl.value) return;
  taEl.value.style.height = 'auto';
  taEl.value.style.height = `${Math.min(taEl.value.scrollHeight, 200)}px`;
}
function handleScroll() {
  const el = scrollEl.value;
  if (!el) return;
  const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
  stickToBottom.value = distance < 120;
  showScrollButton.value = distance > 220;
}
function scrollToBottom(force = false) {
  nextTick(() => {
    if (!scrollEl.value || (!force && !stickToBottom.value)) return;
    scrollEl.value.scrollTo({ top: scrollEl.value.scrollHeight, behavior: force ? 'smooth' : 'auto' });
  });
}
function triggerUpload() { fileInput.value?.click(); }
function validateFile(file) {
  const extension = file.name.toLowerCase().split('.').pop();
  if (!['txt', 'md'].includes(extension)) return '目前仅支持 TXT 和 Markdown 文件';
  if (file.size > 10 * 1024 * 1024) return '文件不能超过 10 MB';
  return '';
}
async function processFile(file) {
  const validationError = validateFile(file);
  if (validationError) { uploadError.value = validationError; return; }
  uploadError.value = '';
  uploading.value = true;
  try { attachedFile.value = await uploadFile(file); }
  catch (error) { uploadError.value = error.message || '文件上传失败'; }
  finally { uploading.value = false; }
}
async function handleFileSelect(event) {
  const file = event.target.files?.[0];
  if (file) await processFile(file);
  event.target.value = '';
}
async function handleDrop(event) {
  dragActive.value = false;
  const file = event.dataTransfer?.files?.[0];
  if (file) await processFile(file);
}
function removeFile() { attachedFile.value = null; uploadError.value = ''; }
function formatTextSize(text = '') { return text.length > 1000 ? `${(text.length / 1000).toFixed(1)}k 字符` : `${text.length} 字符`; }
async function submit() {
  if (!canSend.value) return;
  let text = draft.value.trim();
  if (attachedFile.value) text = `以下是用户上传的文件《${attachedFile.value.filename}》的内容：\n\n${attachedFile.value.textContent}\n\n---\n用户的问题：${text || '请总结并分析这个文件的内容'}`;
  draft.value = '';
  attachedFile.value = null;
  uploadError.value = '';
  stickToBottom.value = true;
  autogrow();
  await chat.send(text);
  scrollToBottom(true);
}
async function open(id) {
  await chat.selectConversation(id);
  stickToBottom.value = true;
  scrollToBottom(true);
  if (window.innerWidth <= 820) sidebarOpen.value = false;
}
function startNew() {
  chat.stop();
  chat.activeId = null;
  chat.messages = [];
  chat.error = '';
  draft.value = '';
  attachedFile.value = null;
  searchQuery.value = '';
  accountMenuOpen.value = false;
  if (window.innerWidth <= 820) sidebarOpen.value = false;
  nextTick(() => taEl.value?.focus());
}
async function remove(id) { if (window.confirm('确定删除这个对话吗？此操作无法撤销。')) await chat.deleteConversation(id); }
function setRenameInput(element, id) { if (!element) renameInputs.delete(id); else renameInputs.set(id, element); }
function beginRename(conversation) {
  editingId.value = conversation.id;
  editingTitle.value = conversation.title || '新对话';
  nextTick(() => { const input = renameInputs.get(conversation.id); input?.focus(); input?.select(); });
}
async function saveRename(id) {
  if (editingId.value !== id) return;
  const title = editingTitle.value.trim();
  editingId.value = null;
  if (title) await chat.renameConversation(id, title);
}
function cancelRename() { editingId.value = null; editingTitle.value = ''; }
function usePrompt(text) { draft.value = text; nextTick(() => { autogrow(); taEl.value?.focus(); }); }
function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark';
  localStorage.setItem('theme', theme.value);
  accountMenuOpen.value = false;
}
function logout() { auth.logout(); router.push({ name: 'login' }); }
function handleShortcut(event) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); startNew(); }
  if (event.key === 'Escape') { accountMenuOpen.value = false; dragActive.value = false; }
}

watch(() => chat.messages.map((message) => message.content).join('|'), () => scrollToBottom());
onMounted(async () => {
  window.addEventListener('keydown', handleShortcut);
  chat.streaming = false;
  chat.error = '';
  try { await chat.loadConversations(); }
  catch { auth.logout(); router.push({ name: 'login' }); }
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleShortcut);
  window.clearTimeout(copyTimer);
  chat.stop();
});
</script>
