#!/usr/bin/env python3
"""
fast_extract.py - Fast audio extraction and grid image generation for VAMSeek AI
v7.27: Added --ai-mode for AI-optimized extraction (16kHz mono 48kbps MP3 + single grid)

Usage:
    python fast_extract.py <video_path> <output_dir> [--interval SECONDS] [--grid-cols COLS] [--cell-width WIDTH] [--cell-height HEIGHT]
    python fast_extract.py <video_path> <output_dir> --ai-mode [--interval SECONDS]

Output:
    - audio.m4a (or original audio codec) - Instant extraction with -c:a copy
    - grid_NNNN.jpg - Grid images at specified intervals
    - metadata.json - Extraction metadata

AI Mode Output:
    - audio.mp3 - AI-optimized audio (16kHz mono 48kbps)
    - grid.jpg - Single grid image covering entire video
"""

import sys
import os
import json
import subprocess
import tempfile
import argparse
from pathlib import Path


def get_video_info(video_path: str) -> dict:
    """Get video duration and audio codec using ffprobe"""
    cmd = [
        'ffprobe', '-v', 'quiet', '-print_format', 'json',
        '-show_format', '-show_streams', video_path
    ]
    # Use encoding='utf-8' and errors='replace' to handle Windows encoding issues
    result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {result.stderr}")

    if not result.stdout:
        raise RuntimeError(f"ffprobe returned no output for: {video_path}")

    data = json.loads(result.stdout)
    duration = float(data.get('format', {}).get('duration', 0))

    # Find audio stream info
    audio_codec = None
    audio_ext = 'm4a'  # Default
    for stream in data.get('streams', []):
        if stream.get('codec_type') == 'audio':
            audio_codec = stream.get('codec_name')
            # Map codec to file extension
            codec_ext_map = {
                'aac': 'm4a',
                'mp3': 'mp3',
                'opus': 'opus',
                'vorbis': 'ogg',
                'flac': 'flac',
                'ac3': 'ac3',
                'eac3': 'eac3'
            }
            audio_ext = codec_ext_map.get(audio_codec, 'm4a')
            break

    return {
        'duration': duration,
        'audio_codec': audio_codec,
        'audio_ext': audio_ext
    }


def extract_audio_fast(video_path: str, output_path: str) -> str:
    """Extract audio using -c:a copy (instant, no re-encoding)"""
    cmd = [
        'ffmpeg', '-y', '-i', video_path,
        '-vn',           # No video
        '-c:a', 'copy',  # Copy audio stream directly (FAST!)
        output_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if result.returncode != 0:
        raise RuntimeError(f"Audio extraction failed: {result.stderr}")
    return output_path


def extract_audio_ai_optimized(video_path: str, output_path: str) -> str:
    """
    Extract audio with AI-optimized settings (16kHz mono 24kbps MP3).
    Smaller file size, optimized for speech recognition / transcription.
    v7.29: Reduced to 24kbps to handle long videos within Gemini rate limits.
    """
    cmd = [
        'ffmpeg', '-y', '-i', video_path,
        '-vn',           # No video
        '-ar', '16000',  # 16kHz sample rate
        '-ac', '1',      # Mono
        '-b:a', '24k',   # 24kbps bitrate (reduced for long videos)
        '-f', 'mp3',     # MP3 format
        output_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if result.returncode != 0:
        raise RuntimeError(f"AI audio extraction failed: {result.stderr}")
    return output_path


def extract_grid_frames(video_path: str, output_dir: str, interval: float = 10.0,
                        cols: int = 5, cell_width: int = 192, cell_height: int = 108,
                        duration: float = None) -> list:
    """
    Extract frames at specified intervals and tile them into grid images.
    Uses ffmpeg's fps filter + tile filter for efficient batch processing.
    """
    if duration is None:
        info = get_video_info(video_path)
        duration = info['duration']

    total_frames = int(duration / interval) + 1
    frames_per_grid = cols * cols  # Square grid (5x5 = 25 frames per image)
    grid_images = []

    # Calculate FPS for frame extraction
    fps = 1.0 / interval

    # Use ffmpeg to extract and tile frames in one pass
    grid_index = 0
    for start_frame in range(0, total_frames, frames_per_grid):
        end_frame = min(start_frame + frames_per_grid, total_frames)
        actual_frames = end_frame - start_frame

        # Calculate actual rows needed for this grid
        actual_rows = (actual_frames + cols - 1) // cols

        output_path = os.path.join(output_dir, f'grid_{grid_index:04d}.jpg')

        # Calculate start time
        start_time = start_frame * interval
        grid_duration = actual_frames * interval

        cmd = [
            'ffmpeg', '-y',
            '-ss', str(start_time),
            '-t', str(grid_duration),
            '-i', video_path,
            '-vf', f'fps={fps},scale={cell_width}:{cell_height},tile={cols}x{actual_rows}',
            '-frames:v', '1',
            '-q:v', '2',  # High quality JPEG
            output_path
        ]

        result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
        if result.returncode == 0 and os.path.exists(output_path):
            grid_images.append({
                'path': output_path,
                'start_frame': start_frame,
                'end_frame': end_frame,
                'start_time': start_time
            })
            grid_index += 1

    return grid_images


def generate_ai_assets(video_path: str, output_dir: str, interval: float = 15.0,
                       cols: int = 5, cell_width: int = 192, cell_height: int = 108) -> dict:
    """
    Generate AI-optimized assets: downsampled audio + single grid image.
    Audio: 16kHz mono 48kbps MP3 (optimized for transcription)
    Grid: Single image with all frames tiled (5x5 per page)
    """
    # Get video duration
    info = get_video_info(video_path)
    duration = info['duration']

    # Calculate grid dimensions
    total_frames = int(duration / interval) + 1
    rows = (total_frames + cols - 1) // cols
    fps = 1.0 / interval

    audio_output = os.path.join(output_dir, 'audio.mp3')
    grid_output = os.path.join(output_dir, 'grid.jpg')

    # Single ffmpeg command for both audio and grid
    cmd = [
        'ffmpeg', '-y', '-i', video_path,
        # Audio output: AI-optimized MP3
        '-vn', '-ar', '16000', '-ac', '1', '-b:a', '48k', audio_output,
        # Grid output: single tiled image
        '-vf', f'fps={fps},scale={cell_width}:{cell_height},tile={cols}x{rows}',
        '-frames:v', '1', '-q:v', '2', grid_output
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if result.returncode != 0:
        raise RuntimeError(f"AI asset generation failed: {result.stderr}")

    return {
        'audio_path': audio_output,
        'grid_path': grid_output,
        'duration': duration,
        'interval': interval,
        'total_frames': total_frames,
        'grid_cols': cols,
        'grid_rows': rows
    }


def extract_single_grid(video_path: str, output_path: str, start_time: float,
                        duration: float, interval: float = 1.0,
                        cols: int = 5, cell_width: int = 384, cell_height: int = 216) -> dict:
    """
    Extract a single high-resolution grid for zoom analysis.
    Used for detailed timestamp refinement.
    """
    total_frames = int(duration / interval) + 1
    actual_rows = (total_frames + cols - 1) // cols
    fps = 1.0 / interval

    cmd = [
        'ffmpeg', '-y',
        '-ss', str(start_time),
        '-t', str(duration),
        '-i', video_path,
        '-vf', f'fps={fps},scale={cell_width}:{cell_height},tile={cols}x{actual_rows}',
        '-frames:v', '1',
        '-q:v', '2',
        output_path
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if result.returncode != 0:
        raise RuntimeError(f"Grid extraction failed: {result.stderr}")

    return {
        'path': output_path,
        'start_time': start_time,
        'duration': duration,
        'interval': interval,
        'total_frames': total_frames,
        'cols': cols,
        'rows': actual_rows
    }


def main():
    parser = argparse.ArgumentParser(description='Fast audio+grid extraction for VAMSeek AI')
    parser.add_argument('video_path', help='Path to input video file')
    parser.add_argument('output_dir', help='Output directory for extracted files')
    parser.add_argument('--interval', type=float, default=10.0, help='Seconds per grid cell (default: 10)')
    parser.add_argument('--grid-cols', type=int, default=5, help='Grid columns (default: 5)')
    parser.add_argument('--cell-width', type=int, default=192, help='Cell width in pixels (default: 192)')
    parser.add_argument('--cell-height', type=int, default=108, help='Cell height in pixels (default: 108)')
    parser.add_argument('--audio-only', action='store_true', help='Extract audio only (skip grid)')
    parser.add_argument('--grid-only', action='store_true', help='Extract grid only (skip audio)')
    parser.add_argument('--zoom', action='store_true', help='High-res zoom mode (1sec interval, 384x216)')
    parser.add_argument('--zoom-start', type=float, help='Zoom start time in seconds')
    parser.add_argument('--zoom-duration', type=float, default=10.0, help='Zoom duration in seconds')
    parser.add_argument('--ai-mode', action='store_true', help='AI-optimized mode (16kHz mono 48kbps MP3 + single grid)')
    # v7.29: AI-optimized audio only (for Gemini transcription)
    parser.add_argument('--audio-ai', action='store_true', help='Extract AI-optimized audio only (16kHz mono 48kbps MP3)')

    args = parser.parse_args()

    # Validate input
    if not os.path.exists(args.video_path):
        print(json.dumps({'error': f'Video not found: {args.video_path}'}))
        sys.exit(1)

    # Create output directory
    os.makedirs(args.output_dir, exist_ok=True)

    # Get video info
    video_info = get_video_info(args.video_path)

    result = {
        'video_path': args.video_path,
        'duration': video_info['duration'],
        'audio_codec': video_info['audio_codec']
    }

    # Zoom mode: high-res single grid extraction
    if args.zoom:
        if args.zoom_start is None:
            print(json.dumps({'error': '--zoom-start required for zoom mode'}))
            sys.exit(1)

        grid_path = os.path.join(args.output_dir, 'zoom_grid.jpg')
        grid_info = extract_single_grid(
            args.video_path, grid_path,
            start_time=args.zoom_start,
            duration=args.zoom_duration,
            interval=1.0,  # 1 second interval for zoom
            cols=5,
            cell_width=384,
            cell_height=216
        )
        result['zoom_grid'] = grid_info
        print(json.dumps(result))
        return

    # AI mode: optimized audio + single grid (for Gemini transcription)
    if args.ai_mode:
        ai_result = generate_ai_assets(
            args.video_path, args.output_dir,
            interval=args.interval,
            cols=args.grid_cols,
            cell_width=args.cell_width,
            cell_height=args.cell_height
        )
        result.update(ai_result)
        result['mode'] = 'ai'

        # Write metadata
        metadata_path = os.path.join(args.output_dir, 'metadata.json')
        with open(metadata_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
        result['metadata_path'] = metadata_path

        print(json.dumps(result))
        return

    # v7.29: AI-optimized audio only mode (16kHz mono 48kbps MP3)
    if args.audio_ai:
        audio_path = os.path.join(args.output_dir, 'audio.mp3')
        extract_audio_ai_optimized(args.video_path, audio_path)
        result['audio_path'] = audio_path
        result['audio_ext'] = 'mp3'
        result['mode'] = 'audio_ai'

        # Write metadata
        metadata_path = os.path.join(args.output_dir, 'metadata.json')
        with open(metadata_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
        result['metadata_path'] = metadata_path

        print(json.dumps(result))
        return

    # Extract audio (instant with -c:a copy)
    if not args.grid_only:
        audio_path = os.path.join(args.output_dir, f'audio.{video_info["audio_ext"]}')
        extract_audio_fast(args.video_path, audio_path)
        result['audio_path'] = audio_path
        result['audio_ext'] = video_info['audio_ext']

    # Extract grid images
    if not args.audio_only:
        grids = extract_grid_frames(
            args.video_path, args.output_dir,
            interval=args.interval,
            cols=args.grid_cols,
            cell_width=args.cell_width,
            cell_height=args.cell_height,
            duration=video_info['duration']
        )
        result['grids'] = grids
        result['grid_config'] = {
            'interval': args.interval,
            'cols': args.grid_cols,
            'cell_width': args.cell_width,
            'cell_height': args.cell_height
        }

    # Write metadata
    metadata_path = os.path.join(args.output_dir, 'metadata.json')
    with open(metadata_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    result['metadata_path'] = metadata_path

    # Output JSON result
    print(json.dumps(result))


if __name__ == '__main__':
    main()
