import { defineStore } from 'pinia';
import { apiGet, apiPost, apiDelete, streamChat } from '../api';

export const useChatStore = defineStore('chat', {
  state: () => ({
    conversations: [],
    activeId: null,
    messages: [],
    streaming: false,
    error: '',
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
      try {
        await streamChat({ conversationId: this.activeId, content }, (delta) => {
          assistant.content += delta;
        });
        // Refresh conversation list so the auto-generated title shows up.
        await this.loadConversations();
      } catch (e) {
        this.error = e.message || 'Something went wrong';
        assistant.content += `\n\n_[error: ${this.error}]_`;
      } finally {
        this.streaming = false;
      }
    },
  },
});
