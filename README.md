# VAM Seek - 2D Video Seek Marker

A high-performance 2D video seek grid library for video streaming sites.
Navigate videos visually with a thumbnail grid and smooth marker animation.

**Zero server-side processing** - All frame extraction happens in the browser.

## Quick Start (For External Sites)

```html
<!-- 1. Add the script -->
<script src="https://cdn.jsdelivr.net/gh/your-org/vam-seek/dist/vam-seek.js"></script>

<!-- 2. Connect to your video -->
<script>
  VAMSeek.init({
    video: document.getElementById('myVideo'),
    container: document.getElementById('seekGrid'),
    columns: 5,
    secondsPerCell: 15
  });
</script>
```

That's it. See [docs/INTEGRATION.md](docs/INTEGRATION.md) for full documentation.

## Features

- **Client-side frame extraction** - No server CPU usage
- **LRU cache** - 200 frames cached in memory
- **Smooth marker animation** - 60fps with requestAnimationFrame
- **VAM algorithm** - Precise timestamp calculation
- **Framework support** - React, Vue, vanilla JS examples included

## Directory Structure

```
VAM_web/
├── dist/                       # Distributable files
│   └── vam-seek.js             # Standalone library (1 file, ~15KB)
│
├── docs/                       # Documentation
│   └── INTEGRATION.md          # API integration guide
│
├── examples/                   # Integration examples
│   ├── basic-integration.html  # Vanilla JS example
│   ├── react-integration.jsx   # React component & hook
│   └── vue-integration.vue     # Vue 3 component
│
├── backend/                    # FastAPI backend (for demo)
│   ├── main.py                 # Entry point, static file serving
│   ├── requirements.txt        # Python dependencies
│   ├── core/                   # Core logic
│   │   ├── grid_calc.py        # VAM grid calculation
│   │   └── video_utils.py      # FFmpeg video processing
│   ├── models/                 # Pydantic schemas
│   │   └── schemas.py          # Request/response models
│   ├── routers/                # API routers
│   │   ├── grid.py             # /api/grid/* endpoints
│   │   └── video.py            # /api/video/* endpoints
│   ├── uploads/                # Uploaded videos (gitignore)
│   └── thumbnails/             # Generated thumbnails (gitignore)
│
├── frontend/                   # Demo frontend
│   ├── index.html              # Main UI with embedded JS
│   └── assets/
│       └── marker.svg          # Grid marker icon
│
├── .gitignore
└── README.md
```

## For Library Users

### Installation Options

**CDN (Recommended)**
```html
<script src="https://cdn.jsdelivr.net/gh/your-org/vam-seek/dist/vam-seek.js"></script>
```

**npm**
```bash
npm install vam-seek
```

### Basic Usage

```javascript
const vam = VAMSeek.init({
  video: document.getElementById('video'),
  container: document.getElementById('grid'),
  columns: 5,
  secondsPerCell: 15,
  onSeek: (time, cell) => {
    console.log(`Seeked to ${time}s`);
  }
});

// API
vam.seekTo(120);           // Seek to 2:00
vam.moveToCell(2, 3);      // Move to column 2, row 3
vam.configure({ columns: 8 }); // Update settings
vam.destroy();             // Clean up
```

### Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `video` | HTMLVideoElement | required | Target video element |
| `container` | HTMLElement | required | Container for the grid |
| `columns` | number | 5 | Grid columns (3-10) |
| `secondsPerCell` | number | 15 | Seconds per cell |
| `cacheSize` | number | 200 | LRU cache size |
| `onSeek` | function | null | Seek callback |

## For Demo Development

### Requirements

- Python 3.9+
- FFmpeg (in PATH)

### Setup

```bash
cd backend
pip install -r requirements.txt
python main.py
```

Open `http://localhost:8000`

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Serve frontend |
| GET | `/api/health` | Health check |
| POST | `/api/grid/config` | Calculate grid dimensions |
| POST | `/api/grid/position` | Calculate timestamp from position |
| POST | `/api/video/upload` | Upload video (demo only) |

## Technical Details

### Frame Extraction (Client-side)

```javascript
// 1. Create hidden video element
const video = document.createElement('video');
video.src = 'video.mp4';

// 2. Seek to timestamp
video.currentTime = 15.0;

// 3. Capture on seeked event
video.addEventListener('seeked', () => {
  const canvas = document.createElement('canvas');
  ctx.drawImage(video, 0, 0);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
});

// 4. Cache with LRU (max 200 frames)
frameCache.put(videoSrc, timestamp, dataUrl);
```

### VAM Algorithm

```javascript
// X-continuous timestamp calculation
function calculateTimestamp(x, y, gridWidth, gridHeight, duration, secondsPerCell) {
  const rowIndex = Math.floor(y / gridHeight * rows);
  const colContinuous = x / gridWidth * columns;
  const cellIndex = rowIndex * columns + colContinuous;
  return Math.min(cellIndex * secondsPerCell, duration);
}
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Arrow Keys` | Move marker by cell |
| `Space` | Play/Pause |
| `Home` | First cell |
| `End` | Last cell |

## Browser Support

- Chrome 80+
- Firefox 75+
- Safari 14+
- Edge 80+
- Mobile browsers

## License

MIT License - Free for commercial use.

## Development History

### 2025-01-10: Initial Release

- FastAPI backend with modular architecture
- Client-side frame extraction (video + canvas)
- VAM-compliant marker movement (X-continuous mode)
- LRU cache with fade-in animation
- Scroll position fix
- Same-origin serving for CORS

### 2025-01-10: Library Release

- Standalone `vam-seek.js` for external integration
- Integration documentation
- React, Vue examples

## Credits

Based on VAM Desktop application algorithms:
- `vam5.70/utils/video_utils.py` - calculate_x_continuous_timestamp
- `vam5.70/gui/preview/core/grid_calculator.py` - GridCalculator
