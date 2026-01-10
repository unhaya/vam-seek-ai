/**
 * VAM Seek - React Integration Example
 *
 * Usage:
 *   npm install vam-seek
 *   import { VAMSeekGrid } from 'vam-seek/react';
 *
 * Or with CDN:
 *   <script src="https://cdn.jsdelivr.net/npm/vam-seek/dist/vam-seek.js"></script>
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';

// ============================================
// React Hook for VAM Seek
// ============================================

/**
 * useVAMSeek - React hook for VAM Seek integration
 *
 * @param {Object} options
 * @param {number} options.columns - Number of grid columns
 * @param {number} options.secondsPerCell - Seconds per cell
 * @param {Function} options.onSeek - Callback when user seeks
 * @returns {Object} - { videoRef, gridRef, instance, currentCell }
 */
function useVAMSeek(options = {}) {
    const videoRef = useRef(null);
    const gridRef = useRef(null);
    const instanceRef = useRef(null);
    const [currentCell, setCurrentCell] = useState(null);

    const {
        columns = 5,
        secondsPerCell = 15,
        onSeek
    } = options;

    useEffect(() => {
        const video = videoRef.current;
        const grid = gridRef.current;

        if (!video || !grid) return;

        const handleMetadata = () => {
            // Destroy existing instance
            if (instanceRef.current) {
                instanceRef.current.destroy();
            }

            // Initialize VAM Seek
            instanceRef.current = window.VAMSeek.init({
                video: video,
                container: grid,
                columns: columns,
                secondsPerCell: secondsPerCell,
                onSeek: (time, cell) => {
                    setCurrentCell(cell);
                    if (onSeek) onSeek(time, cell);
                }
            });
        };

        video.addEventListener('loadedmetadata', handleMetadata);

        // If video already has metadata
        if (video.duration) {
            handleMetadata();
        }

        return () => {
            video.removeEventListener('loadedmetadata', handleMetadata);
            if (instanceRef.current) {
                instanceRef.current.destroy();
            }
        };
    }, [columns, secondsPerCell, onSeek]);

    return {
        videoRef,
        gridRef,
        instance: instanceRef.current,
        currentCell
    };
}

// ============================================
// React Component
// ============================================

/**
 * VAMSeekGrid - React component for 2D video seek grid
 *
 * @example
 * <VAMSeekGrid
 *   videoSrc="https://example.com/video.mp4"
 *   columns={5}
 *   secondsPerCell={15}
 *   onSeek={(time, cell) => console.log(time)}
 * />
 */
function VAMSeekGrid({
    videoSrc,
    columns = 5,
    secondsPerCell = 15,
    onSeek,
    videoProps = {},
    gridStyle = {},
    className = ''
}) {
    const { videoRef, gridRef, currentCell } = useVAMSeek({
        columns,
        secondsPerCell,
        onSeek
    });

    return (
        <div className={`vam-seek-container ${className}`}>
            <div className="vam-seek-player">
                <video
                    ref={videoRef}
                    controls
                    {...videoProps}
                >
                    <source src={videoSrc} type="video/mp4" />
                </video>
            </div>
            <div
                ref={gridRef}
                className="vam-seek-grid"
                style={{
                    background: '#1a1a2e',
                    borderRadius: '8px',
                    padding: '10px',
                    maxHeight: '400px',
                    overflowY: 'auto',
                    position: 'relative',
                    ...gridStyle
                }}
            />
        </div>
    );
}

// ============================================
// Example App
// ============================================

function ExampleApp() {
    const [seekInfo, setSeekInfo] = useState({ time: 0, cell: null });

    const handleSeek = useCallback((time, cell) => {
        setSeekInfo({ time, cell });
    }, []);

    return (
        <div style={{ padding: '20px', background: '#0f0f1a', minHeight: '100vh' }}>
            <h1 style={{ color: '#8b5cf6', marginBottom: '20px' }}>
                VAM Seek - React Example
            </h1>

            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                {/* Video and Grid */}
                <VAMSeekGrid
                    videoSrc="https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
                    columns={5}
                    secondsPerCell={15}
                    onSeek={handleSeek}
                    className="demo-grid"
                />

                {/* Status Panel */}
                <div style={{
                    background: '#1a1a2e',
                    borderRadius: '8px',
                    padding: '20px',
                    minWidth: '200px'
                }}>
                    <h3 style={{ color: '#8b5cf6', marginBottom: '15px' }}>
                        Status
                    </h3>
                    <div style={{ color: '#fff' }}>
                        <p>Time: {seekInfo.time.toFixed(2)}s</p>
                        {seekInfo.cell && (
                            <>
                                <p>Cell: {seekInfo.cell.index}</p>
                                <p>Position: ({seekInfo.cell.col}, {seekInfo.cell.row})</p>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Code Example */}
            <pre style={{
                background: '#0a0a12',
                borderRadius: '8px',
                padding: '15px',
                marginTop: '20px',
                color: '#a0a0c0',
                overflow: 'auto'
            }}>
{`// React integration
import { VAMSeekGrid, useVAMSeek } from 'vam-seek/react';

function MyVideoPlayer() {
    return (
        <VAMSeekGrid
            videoSrc="https://example.com/video.mp4"
            columns={5}
            secondsPerCell={15}
            onSeek={(time, cell) => console.log(time)}
        />
    );
}`}
            </pre>
        </div>
    );
}

// ============================================
// Exports
// ============================================

export { VAMSeekGrid, useVAMSeek };
export default ExampleApp;
