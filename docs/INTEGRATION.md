# VAM Seek - Integration Guide

2D Video Seek Marker for Video Streaming Sites

## Quick Start (1 Line Integration)

```html
<script src="https://your-cdn.com/vam-seek.js"></script>
```

That's it. Now connect to your existing `<video>` element:

```javascript
VAMSeek.init({
    video: document.getElementById('myVideo'),
    container: document.getElementById('seekGrid')
});
```

## Why VAM Seek?

| Problem | VAM Seek Solution |
|---------|------------------|
| Users scrub randomly to find scenes | Visual grid shows all thumbnails at once |
| Seek bar is 1-dimensional | 2D grid = faster navigation |
| Mobile scrubbing is imprecise | Click any cell to jump instantly |
| Server load for thumbnail generation | **Client-side extraction** - zero server CPU |

## Architecture

```
Your Video Site                    VAM Seek Library (Client-Side)
+------------------+               +---------------------------+
|                  |               |                           |
|  <video src="">  | ───────────>  |  LRU Frame Cache (200)    |
|                  |               |  Canvas Frame Extraction  |
|  Your CDN/S3     |               |  2D Grid Rendering        |
|                  |               |  Smooth Marker Animation  |
+------------------+               +---------------------------+
        │                                      │
        │                                      │
        v                                      v
   No server-side                    All computation
   processing needed                 happens in browser
```

## Full Integration Example

### HTML Structure

```html
<!DOCTYPE html>
<html>
<head>
    <title>My Video Site</title>
    <style>
        .video-container {
            display: flex;
            gap: 20px;
        }
        .player {
            flex: 1;
            max-width: 640px;
        }
        .seek-grid {
            flex: 1;
            max-width: 500px;
            max-height: 400px;
            overflow-y: auto;
            background: #1a1a2e;
            border-radius: 8px;
            padding: 10px;
        }
        video {
            width: 100%;
            border-radius: 8px;
        }
    </style>
</head>
<body>
    <div class="video-container">
        <!-- Your existing video player -->
        <div class="player">
            <video id="myVideo" controls>
                <source src="https://your-cdn.com/video.mp4" type="video/mp4">
            </video>
        </div>

        <!-- VAM Seek Grid Container -->
        <div class="seek-grid" id="seekGrid"></div>
    </div>

    <!-- VAM Seek Library -->
    <script src="https://your-cdn.com/vam-seek.js"></script>
    <script>
        const video = document.getElementById('myVideo');
        const grid = document.getElementById('seekGrid');

        // Initialize when video is ready
        video.addEventListener('loadedmetadata', () => {
            const vam = VAMSeek.init({
                video: video,
                container: grid,
                columns: 5,
                secondsPerCell: 15,
                onSeek: (time, cell) => {
                    console.log(`Seeked to ${time}s (cell ${cell.index})`);
                }
            });
        });
    </script>
</body>
</html>
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `video` | HTMLVideoElement | required | Your video element |
| `container` | HTMLElement | required | Container for the grid |
| `columns` | number | 5 | Grid columns (3-10 recommended) |
| `secondsPerCell` | number | 15 | Seconds each cell represents |
| `thumbWidth` | number | 160 | Thumbnail width in pixels |
| `thumbHeight` | number | 90 | Thumbnail height in pixels |
| `cacheSize` | number | 200 | LRU cache size (frames) |
| `markerSvg` | string | null | Custom marker SVG HTML |
| `onSeek` | function | null | Callback when user seeks |

## API Reference

### VAMSeek.init(options)

Initialize the seek grid.

```javascript
const instance = VAMSeek.init({
    video: videoElement,
    container: containerElement,
    columns: 5,
    secondsPerCell: 15
});
```

### instance.configure(options)

Update configuration dynamically.

```javascript
instance.configure({
    columns: 8,
    secondsPerCell: 10
});
```

### instance.seekTo(time)

Programmatically seek to a time.

```javascript
instance.seekTo(120); // Seek to 2:00
```

### instance.moveToCell(col, row)

Move marker to specific cell.

```javascript
instance.moveToCell(2, 3); // Column 2, Row 3
```

### instance.getCurrentCell()

Get current cell information.

```javascript
const cell = instance.getCurrentCell();
// Returns: { index, col, row, time, cellStartTime, cellEndTime }
```

### instance.destroy()

Clean up and remove the grid.

```javascript
instance.destroy();
```

### VAMSeek.getInstance(video)

Get instance for a video element.

```javascript
const instance = VAMSeek.getInstance(videoElement);
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Arrow Keys` | Move marker by one cell |
| `Home` | Jump to first cell |
| `End` | Jump to last cell |
| `Space` | Play/Pause |

## Custom Styling

Override default styles with CSS:

```css
/* Grid container */
.vam-thumbnail-grid {
    gap: 4px !important;
}

/* Individual cells */
.vam-cell {
    border-radius: 4px !important;
    background: #2a2a4e !important;
}

/* Time labels */
.vam-time {
    font-family: 'Monaco', monospace !important;
    font-size: 10px !important;
}

/* Marker */
.vam-marker svg circle {
    stroke: #00ff00 !important;
}
```

## Custom Marker

Replace the default crosshair:

```javascript
VAMSeek.init({
    video: video,
    container: grid,
    markerSvg: `
        <svg width="32" height="32" viewBox="0 0 32 32">
            <polygon points="16,0 32,32 0,32" fill="#ff0000"/>
        </svg>
    `
});
```

## Performance Tips

### 1. Optimal Column Count

| Video Duration | Recommended Columns | Seconds/Cell |
|----------------|---------------------|--------------|
| < 5 minutes | 4-5 | 5-10 |
| 5-30 minutes | 5-6 | 15-30 |
| 30-60 minutes | 6-8 | 30-60 |
| > 60 minutes | 8-10 | 60-120 |

### 2. LRU Cache

The library maintains an LRU cache of 200 frames by default. Increase for longer videos:

```javascript
VAMSeek.init({
    // ...
    cacheSize: 500 // For videos > 2 hours
});
```

### 3. Lazy Loading

For very long videos, consider loading frames on scroll:

```javascript
container.addEventListener('scroll', () => {
    // Trigger frame extraction for visible cells
    instance.rebuild();
});
```

## Browser Support

| Browser | Support |
|---------|---------|
| Chrome 80+ | Full |
| Firefox 75+ | Full |
| Safari 14+ | Full |
| Edge 80+ | Full |
| Mobile Chrome | Full |
| Mobile Safari | Full |

## CORS Requirements

The video source must allow canvas extraction:

```
Access-Control-Allow-Origin: *
```

Or serve the video and page from the same origin.

## CDN Hosting

Host `vam-seek.js` on your CDN:

```html
<!-- jsDelivr (recommended) -->
<script src="https://cdn.jsdelivr.net/gh/your-org/vam-seek@1.0.0/dist/vam-seek.js"></script>

<!-- unpkg -->
<script src="https://unpkg.com/vam-seek@1.0.0/dist/vam-seek.js"></script>

<!-- Your own CDN -->
<script src="https://cdn.your-site.com/lib/vam-seek.js"></script>
```

## TypeScript Support

Type definitions (coming soon):

```typescript
interface VAMSeekOptions {
    video: HTMLVideoElement;
    container: HTMLElement;
    columns?: number;
    secondsPerCell?: number;
    thumbWidth?: number;
    thumbHeight?: number;
    cacheSize?: number;
    markerSvg?: string;
    onSeek?: (time: number, cell: CellInfo) => void;
}

interface CellInfo {
    index: number;
    col: number;
    row: number;
    time: number;
    cellStartTime: number;
    cellEndTime: number;
}
```

## License

MIT License - Free for commercial use.

## Support

- GitHub Issues: https://github.com/your-org/vam-seek/issues
- Documentation: https://your-org.github.io/vam-seek/

---

**VAM Seek** - Navigate videos visually.
