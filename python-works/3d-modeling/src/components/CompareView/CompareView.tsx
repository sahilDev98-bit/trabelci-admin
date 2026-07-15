import { useState, useRef, useCallback } from 'react'
import { useStore } from '../../store/useStore'
import { RoomViewer } from '../RoomViewer/RoomViewer'

export function CompareView() {
  const { selectedRoom } = useStore()
  const [dividerX, setDividerX] = useState(50) // percent
  const containerRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const handleMouseDown = () => { dragging.current = true }

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    setDividerX(Math.max(10, Math.min(90, x)))
  }, [])

  const handleMouseUp = () => { dragging.current = false }

  if (!selectedRoom) return null

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden select-none"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Left panel: original room */}
      <div className="absolute inset-0">
        <RoomViewer room={selectedRoom} disableTextures showOrbitControls={false} />
      </div>

      {/* Right panel: with marble — clipped to right of divider */}
      <div
        className="absolute inset-0"
        style={{ clipPath: `inset(0 0 0 ${dividerX}%)` }}
      >
        <RoomViewer room={selectedRoom} id="room-canvas-wrapper" showOrbitControls={false} />
      </div>

      {/* Labels */}
      <div className="absolute top-4 left-4 bg-black/60 text-white text-xs px-3 py-1.5 rounded-full font-medium pointer-events-none">
        Original
      </div>
      <div className="absolute top-4 right-4 bg-amber-500/90 text-gray-900 text-xs px-3 py-1.5 rounded-full font-medium pointer-events-none">
        With Marble
      </div>

      {/* Draggable divider */}
      <div
        className="absolute top-0 bottom-0 w-1 bg-amber-500 cursor-col-resize z-10 flex items-center justify-center"
        style={{ left: `${dividerX}%`, transform: 'translateX(-50%)' }}
        onMouseDown={handleMouseDown}
      >
        <div className="w-8 h-8 rounded-full bg-amber-500 border-2 border-white shadow-lg flex items-center justify-center">
          <svg className="w-4 h-4 text-gray-900" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5l-7 7 7 7V5zm8 0v14l7-7-7-7z" />
          </svg>
        </div>
      </div>
    </div>
  )
}
