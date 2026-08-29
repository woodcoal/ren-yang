<script setup lang="ts">
import { computed } from 'vue'

const route = useRoute()

/** 当前是否为首次设置页面。 */
const isSetupPage = computed(() => route.path === '/setup')

/** 认证左侧叙事区域的页面标题。 */
const storyTitle = computed(() => isSetupPage.value
  ? '在开始创作前，确认这台设备的边界'
  : '进入只属于这台设备的创作工作台')

/** 认证左侧叙事区域的页面说明。 */
const storyDescription = computed(() => isSetupPage.value
  ? '完成本机管理员设置后，即可建立人物、整理资料并发起任务。'
  : '人样以单人、本地使用为边界。管理员密码不会发送到网络。')

/** 认证页面需要明确展示的三项本机边界。 */
const boundaryItems = computed(() => isSetupPage.value
  ? [
      { title: '资料和记录保留在本机', description: 'SQLite 是业务事实来源；远端索引仅增强资料检索。' },
      { title: '建立唯一管理员', description: '系统不创建团队成员、邀请链接或其他账户。' },
      { title: '关键变化仍需确认', description: '人物修改和候选记忆不会绕过人工确认直接生效。' },
    ]
  : [
      { title: '数据留在本机', description: '人物、资料和任务记录由本机数据库保存。' },
      { title: '只有一位管理员', description: '管理员负责配置系统与确认影响后续任务的内容。' },
      { title: '恢复仅在本机完成', description: '密码恢复通过本机命令行处理，不提供在线找回。' },
    ])
</script>

<template>
  <div class="auth-shell">
    <a class="skip-link" href="#authentication-form">跳到{{ isSetupPage ? '首次设置' : '登录表单' }}</a>
    <section class="auth-story" :aria-labelledby="isSetupPage ? 'setup-story-title' : 'login-story-title'">
      <div class="auth-story-main">
        <NuxtLink to="/" class="auth-brand" aria-label="人样人物工作室首页">
          <BrandMark />
        </NuxtLink>
        <p class="eyebrow">{{ isSetupPage ? '首次启动 · 本机设置' : '本机访问 · 唯一管理员' }}</p>
        <h1 :id="isSetupPage ? 'setup-story-title' : 'login-story-title'">{{ storyTitle }}</h1>
        <p class="auth-story-description">{{ storyDescription }}</p>
      </div>

      <ol class="auth-boundary-list">
        <li v-for="(item, index) in boundaryItems" :key="item.title" class="auth-boundary-item">
          <span class="auth-boundary-index" aria-hidden="true">0{{ index + 1 }}</span>
          <span>
            <strong>{{ item.title }}</strong>
            <span>{{ item.description }}</span>
          </span>
        </li>
      </ol>
    </section>

    <main id="authentication-form" class="auth-form-area" tabindex="-1">
      <ShellThemeSelector class="auth-color-mode" />
      <div class="auth-form-content">
        <slot />
      </div>
    </main>
  </div>
</template>
