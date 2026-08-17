import { defineStore } from 'pinia';
import { apiGet, apiPost, apiPatch, apiDelete, streamChat } from '../api';

let activeRequest = null;

export const useChatStore = defineStore('chat', {
  state: () => ({
    conversations: [],
    activeId: null,
    messages: [],
    streaming: false,
    error: '',
    selectedModel: 'gpt-5.6-sol',
  }),
  actions: {
    async loadConversations() {
      this.conversations = await apiGet('/conversations');
    },
    async selectConversation(id) {
      this.activeId = id;
      this.messages = await apiGet(`/conversations/${id}/messages`);
    },
    async newConversation() {
      const conv = await apiPost('/conversations', {});
      this.conversations.unshift(conv);
      this.activeId = conv.id;
      this.messages = [];
      return conv;
    },
    async deleteConversation(id) {
      await apiDelete(`/conversations/${id}`);
      this.conversations = this.conversations.filter((c) => c.id !== id);
      if (this.activeId === id) {
        this.activeId = null;
        this.messages = [];
      }
    },
    async renameConversation(id, title) {
      const cleanTitle = title.trim().slice(0, 80);
      if (!cleanTitle) return;
      await apiPatch(`/conversations/${id}`, { title: cleanTitle });
      const conversation = this.conversations.find((item) => item.id === id);
      if (conversation) conversation.title = cleanTitle;
    },
    setModel(model) {
      this.selectedModel = model;
      localStorage.setItem('selectedModel', model);
    },
    stop() {
      activeRequest?.abort();
      activeRequest = null;
      this.streaming = false;
    },
    async send(content) {
      this.error = '';
      if (!this.activeId) {
        await this.newConversation();
      }
      // Optimistically render the user message + an empty assistant bubble.
      this.messages.push({ id: `tmp-u-${Date.now()}`, role: 'user', content });
      const assistant = { id: `tmp-a-${Date.now()}`, role: 'assistant', content: '' };
      this.messages.push(assistant);
      this.streaming = true;
      const requestController = new AbortController();
      activeRequest = requestController;
      let pendingText = '';
      let frameId = null;
      let resolveDrain = null;

      const finishDrain = () => {
        if (!pendingText && resolveDrain) {
          resolveDrain();
          resolveDrain = null;
        }
      };
      const flushPendingText = () => {
        frameId = null;
        if (!pendingText) {
          finishDrain();
          return;
        }

        // Relays often batch many tokens into one network packet. Reveal a small,
        // adaptive slice per frame so the response still feels genuinely live.
        const chunkSize = pendingText.length > 1200 ? 8
          : pendingText.length > 600 ? 6
            : pendingText.length > 240 ? 4
              : pendingText.length > 80 ? 2 : 1;
        assistant.content += pendingText.slice(0, chunkSize);
        pendingText = pendingText.slice(chunkSize);

        if (pendingText) frameId = window.requestAnimationFrame(flushPendingText);
        else finishDrain();
      };
      const scheduleFlush = () => {
        if (frameId === null) frameId = window.requestAnimationFrame(flushPendingText);
      };
      const waitForDrain = () => {
        if (!pendingText && frameId === null) return Promise.resolve();
        return new Promise((resolve) => { resolveDrain = resolve; });
      };
      const flushAll = () => {
        if (frameId !== null) window.cancelAnimationFrame(frameId);
        frameId = null;
        if (pendingText) assistant.content += pendingText;
        pendingText = '';
        finishDrain();
      };
      try {
        await streamChat({
          conversationId: this.activeId,
          content,
          model: this.selectedModel,
          signal: requestController.signal,
        }, (delta) => {
          pendingText += delta;
          scheduleFlush();
        });
        await waitForDrain();
        // Refresh conversation list so the auto-generated title shows up.
        await this.loadConversations();
      } catch (e) {
        if (e.name === 'AbortError') {
          if (frameId !== null) window.cancelAnimationFrame(frameId);
          frameId = null;
          pendingText = '';
          finishDrain();
          if (!assistant.content) assistant.content = '_已停止生成_';
        } else {
          flushAll();
          this.error = e.message || 'Something went wrong';
          assistant.content += `\n\n_[error: ${this.error}]_`;
        }
      } finally {
        if (activeRequest === requestController) {
          activeRequest = null;
          this.streaming = false;
        }
      }
    },
  },
});
