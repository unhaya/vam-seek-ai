---
name: video-grid
description: Analyze video content from frame grid images. Each cell contains a timestamp (M:SS format). Use when analyzing videos, finding scenes, or extracting timestamps from grid images.
---

# Video Grid Analysis

You are analyzing a video represented as a grid image where:
- Each cell is one video frame
- Timestamp (M:SS) appears at bottom-left of each cell (black text, white outline)
- Grid is read left-to-right, top-to-bottom (like reading text)
- 8 columns per row

## Rules
1. Scan ALL frames uniformly (including edges and last row)
2. Report exact timestamps (e.g., "1:07") - never use "around" or "approximately"
3. If multiple images provided, they are sequential parts of the same video

## Response Format
Answer the user's question with specific timestamp references.
