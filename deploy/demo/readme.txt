===============================================
VAM Seek - Static Hosting Deployment Guide
===============================================

DIRECTORY STRUCTURE
-------------------

Upload this folder to your static hosting:

demo/
  index.html    <- Main demo page (single file, ~30KB)
  demo.mp4      <- Sample video (optional)
  README.txt    <- This file (optional)

DEPLOYMENT STEPS
----------------

1. Upload index.html to your web directory
2. Access via browser

REQUIREMENTS
------------

- No server-side processing required
- No PHP, Python, or database needed
- Works on any static hosting

FEATURES
--------

- 100% client-side video processing
- No file upload to server
- Per-video LRU cache (up to 3 videos)
- Per-video grid settings
- Smooth 60fps marker animation
- Keyboard shortcuts supported
- Mobile responsive

BROWSER SUPPORT
---------------

- Chrome 80+
- Firefox 75+
- Safari 14+
- Edge 80+

TROUBLESHOOTING
---------------

Q: Video doesn't load?
A: Check if the video format is supported (MP4, WebM, MOV)

Q: Thumbnails not generating?
A: Some browsers block canvas access for cross-origin videos.
   Use local files only.

Q: Slow performance?
A: Large videos may take time for initial frame extraction.
   Frames are cached for subsequent seeks.

===============================================
VAM Seek - Zero Server CPU, Full Browser Power
===============================================
