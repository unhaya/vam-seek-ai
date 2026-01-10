<!--
  VAM Seek - Vue 3 Integration Example

  Usage:
    npm install vam-seek
    import VAMSeekGrid from 'vam-seek/vue';

  Or with CDN:
    <script src="https://cdn.jsdelivr.net/npm/vam-seek/dist/vam-seek.js"></script>
-->

<template>
  <div class="vam-seek-demo">
    <h1>VAM Seek - Vue 3 Example</h1>

    <div class="demo-container">
      <!-- Video Player -->
      <div class="video-panel">
        <div class="panel-title">Video Player</div>
        <video
          ref="videoRef"
          controls
          @loadedmetadata="initVAMSeek"
        >
          <source :src="videoSrc" type="video/mp4" />
        </video>

        <!-- Controls -->
        <div class="controls">
          <div class="control-group">
            <label>Columns:</label>
            <select v-model.number="columns" @change="rebuildGrid">
              <option :value="3">3</option>
              <option :value="4">4</option>
              <option :value="5">5</option>
              <option :value="6">6</option>
              <option :value="8">8</option>
            </select>
          </div>
          <div class="control-group">
            <label>Sec/Cell:</label>
            <select v-model.number="secondsPerCell" @change="rebuildGrid">
              <option :value="5">5s</option>
              <option :value="10">10s</option>
              <option :value="15">15s</option>
              <option :value="30">30s</option>
              <option :value="60">1m</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Grid Panel -->
      <div class="grid-panel">
        <div class="panel-title">2D Seek Grid</div>
        <div ref="gridRef" class="seek-grid-container"></div>
      </div>
    </div>

    <!-- Status Panel -->
    <div class="info-panel">
      <h3>Current Status</h3>
      <div class="info-grid">
        <div class="info-item">
          <div class="info-label">Current Time</div>
          <div class="info-value">{{ formattedTime }}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Current Cell</div>
          <div class="info-value">{{ cellDisplay }}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Grid Size</div>
          <div class="info-value">{{ gridDisplay }}</div>
        </div>
      </div>
    </div>

    <!-- Code Example -->
    <pre class="code-block">
// Vue 3 Composition API
import { ref, onMounted, onUnmounted } from 'vue';

const videoRef = ref(null);
const gridRef = ref(null);
let vamInstance = null;

onMounted(() => {
  videoRef.value.addEventListener('loadedmetadata', () => {
    vamInstance = VAMSeek.init({
      video: videoRef.value,
      container: gridRef.value,
      columns: 5,
      secondsPerCell: 15
    });
  });
});

onUnmounted(() => {
  if (vamInstance) vamInstance.destroy();
});
    </pre>
  </div>
</template>

<script>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';

export default {
  name: 'VAMSeekDemo',

  props: {
    videoSrc: {
      type: String,
      default: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'
    }
  },

  setup(props) {
    // Refs
    const videoRef = ref(null);
    const gridRef = ref(null);

    // State
    const columns = ref(5);
    const secondsPerCell = ref(15);
    const currentTime = ref(0);
    const currentCell = ref(null);

    // Instance
    let vamInstance = null;

    // Computed
    const formattedTime = computed(() => {
      const mins = Math.floor(currentTime.value / 60);
      const secs = Math.floor(currentTime.value % 60);
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    });

    const cellDisplay = computed(() => {
      if (!currentCell.value) return '-';
      return `${currentCell.value.col + 1}, ${currentCell.value.row + 1}`;
    });

    const gridDisplay = computed(() => {
      if (!videoRef.value?.duration) return '-';
      const totalCells = Math.ceil(videoRef.value.duration / secondsPerCell.value);
      const rows = Math.ceil(totalCells / columns.value);
      return `${columns.value} x ${rows}`;
    });

    // Methods
    const initVAMSeek = () => {
      if (vamInstance) {
        vamInstance.destroy();
      }

      vamInstance = window.VAMSeek.init({
        video: videoRef.value,
        container: gridRef.value,
        columns: columns.value,
        secondsPerCell: secondsPerCell.value,
        onSeek: (time, cell) => {
          currentTime.value = time;
          currentCell.value = cell;
        }
      });
    };

    const rebuildGrid = () => {
      if (videoRef.value?.duration) {
        initVAMSeek();
      }
    };

    // Lifecycle
    onMounted(() => {
      if (videoRef.value) {
        videoRef.value.addEventListener('timeupdate', () => {
          currentTime.value = videoRef.value.currentTime;
          if (vamInstance) {
            currentCell.value = vamInstance.getCurrentCell();
          }
        });
      }
    });

    onUnmounted(() => {
      if (vamInstance) {
        vamInstance.destroy();
      }
    });

    return {
      videoRef,
      gridRef,
      columns,
      secondsPerCell,
      formattedTime,
      cellDisplay,
      gridDisplay,
      initVAMSeek,
      rebuildGrid
    };
  }
};
</script>

<style scoped>
.vam-seek-demo {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #0f0f1a;
  color: #fff;
  min-height: 100vh;
  padding: 20px;
}

h1 {
  text-align: center;
  margin-bottom: 20px;
  color: #8b5cf6;
}

.demo-container {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
}

.video-panel,
.grid-panel {
  flex: 1;
  min-width: 400px;
}

.panel-title {
  font-size: 14px;
  color: #8b5cf6;
  margin-bottom: 10px;
  text-transform: uppercase;
  letter-spacing: 1px;
}

video {
  width: 100%;
  border-radius: 8px;
  background: #1a1a2e;
}

.seek-grid-container {
  background: #1a1a2e;
  border-radius: 8px;
  padding: 10px;
  max-height: 400px;
  overflow-y: auto;
  position: relative;
}

.controls {
  margin-top: 15px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.control-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.control-group label {
  font-size: 12px;
  color: #888;
}

select {
  background: #2a2a4e;
  border: 1px solid #3a3a5e;
  color: #fff;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
}

.info-panel {
  max-width: 1200px;
  margin: 20px auto 0;
  background: #1a1a2e;
  border-radius: 8px;
  padding: 15px;
}

.info-panel h3 {
  font-size: 14px;
  color: #8b5cf6;
  margin-bottom: 10px;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
}

.info-item {
  background: #2a2a4e;
  padding: 10px;
  border-radius: 4px;
}

.info-label {
  font-size: 11px;
  color: #888;
  text-transform: uppercase;
}

.info-value {
  font-size: 18px;
  font-weight: bold;
  color: #8b5cf6;
  margin-top: 4px;
}

.code-block {
  max-width: 1200px;
  margin: 20px auto 0;
  background: #0a0a12;
  border-radius: 8px;
  padding: 15px;
  overflow-x: auto;
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: 12px;
  color: #a0a0c0;
  line-height: 1.5;
}
</style>
