<script setup lang="ts">
import { onMounted } from 'vue'
import Sidebar from './components/Sidebar.vue'
import StatusBar from './components/StatusBar.vue'
import Home from './pages/Home.vue'
import Rules from './pages/Rules.vue'
import TTSSettings from './pages/TTSSettings.vue'
import Lottery from './pages/Lottery.vue'
import Voting from './pages/Voting.vue'
import Logs from './pages/Logs.vue'
import { currentPage, loadInitialData } from './store'

onMounted(() => {
  void loadInitialData()
})
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex flex-1 overflow-hidden">
      <Sidebar />
      <main class="flex-1 overflow-y-auto px-8 py-6">
        <Home v-if="currentPage === 'home'" />
        <Rules v-else-if="currentPage === 'rules'" />
        <TTSSettings v-else-if="currentPage === 'tts'" />
        <Lottery v-else-if="currentPage === 'lottery'" />
        <Voting v-else-if="currentPage === 'voting'" />
        <Logs v-else-if="currentPage === 'logs'" />
      </main>
    </div>
    <StatusBar />
  </div>
</template>
