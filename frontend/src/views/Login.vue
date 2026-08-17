<template>
  <main class="login-wrap">
    <section class="login-panel" aria-label="产品介绍">
      <div class="login-brand"><span class="brand-mark"><img src="/liwen-mark.png" alt="" /></span><span>砺文智联</span></div>
      <div class="login-statement">
        <p>Think clearly · Create freely</p>
        <h2>让每一个问题，<br />都有清晰的下一步。</h2>
      </div>
      <div class="login-credit">砺思于文 · 智联万象</div>
    </section>

    <section class="login-form-side">
      <div class="login-card">
        <div class="mobile-brand"><span class="brand-mark"><img src="/liwen-mark.png" alt="" /></span><span>砺文智联</span></div>
        <h1>{{ mode === 'login' ? '欢迎回来' : '创建你的账号' }}</h1>
        <p class="sub">{{ mode === 'login' ? '登录后继续你的思考与创作。' : '几秒钟即可开启新的智能工作区。' }}</p>
        <form @submit.prevent="submit">
          <div class="field">
            <label for="email">邮箱</label>
            <input id="email" v-model.trim="email" type="email" autocomplete="username" placeholder="name@example.com" required />
          </div>
          <div class="field">
            <label for="password">密码</label>
            <input
              id="password"
              v-model="password"
              type="password"
              :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
              placeholder="至少 6 个字符"
              minlength="6"
              required
            />
          </div>
          <button class="btn-primary" :disabled="loading" type="submit">
            {{ loading ? '正在处理…' : (mode === 'login' ? '继续' : '创建账号') }}
          </button>
          <p class="err" role="alert">{{ error }}</p>
        </form>
        <div class="toggle-line">
          <template v-if="mode === 'login'">还没有账号？<button type="button" @click="switchMode('register')">免费注册</button></template>
          <template v-else>已经有账号？<button type="button" @click="switchMode('login')">返回登录</button></template>
        </div>
      </div>
    </section>
  </main>
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

function switchMode(nextMode) {
  mode.value = nextMode;
  password.value = '';
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
  } catch (requestError) {
    const messages = {
      'invalid credentials': '邮箱或密码不正确',
      'email already registered': '该邮箱已经注册',
      'password must be at least 6 chars': '密码至少需要 6 个字符',
    };
    error.value = messages[requestError.message] || requestError.message || '暂时无法完成操作，请稍后再试';
  } finally {
    loading.value = false;
  }
}
</script>
