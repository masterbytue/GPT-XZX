<template>
  <div class="login-wrap">
    <div class="login-card">
      <h1>{{ mode === 'login' ? '欢迎回来' : '创建账号' }}</h1>
      <p class="sub">{{ mode === 'login' ? '登录以继续对话' : '注册以开始对话' }}</p>
      <form @submit.prevent="submit">
        <div class="field">
          <label>邮箱</label>
          <input v-model="email" type="email" autocomplete="username" placeholder="请输入邮箱" required />
        </div>
        <div class="field">
          <label>密码</label>
          <input v-model="password" type="password" autocomplete="current-password" placeholder="至少6个字符" required />
        </div>
        <button class="btn-primary" :disabled="loading" type="submit">
          {{ loading ? '请稍候…' : (mode === 'login' ? '登录' : '注册') }}
        </button>
        <p class="err">{{ error }}</p>
      </form>
      <div class="toggle-line">
        <template v-if="mode === 'login'">
          没有账号？<a @click="switchMode('register')">立即注册</a>
        </template>
        <template v-else>
          已有账号？<a @click="switchMode('login')">立即登录</a>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { apiPost } from '../api';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const auth = useAuthStore();

const mode = ref('login');
const email = ref('');
const password = ref('');
const loading = ref(false);
const error = ref('');

function switchMode(m) {
  mode.value = m;
  error.value = '';
}

async function submit() {
  loading.value = true;
  error.value = '';
  try {
    const path = mode.value === 'login' ? '/auth/login' : '/auth/register';
    const data = await apiPost(path, { email: email.value, password: password.value });
    auth.setAuth(data.token, data.user);
    router.push({ name: 'chat' });
  } catch (e) {
    error.value = e.message || 'Failed';
  } finally {
    loading.value = false;
  }
}
</script>
