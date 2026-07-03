import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from './stores/auth';
import Login from './views/Login.vue';
import Chat from './views/Chat.vue';

const routes = [
  { path: '/login', name: 'login', component: Login },
  { path: '/', name: 'chat', component: Chat, meta: { requiresAuth: true } },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (to.meta.requiresAuth && !auth.token) return { name: 'login' };
  if (to.name === 'login' && auth.token) return { name: 'chat' };
});

export default router;
