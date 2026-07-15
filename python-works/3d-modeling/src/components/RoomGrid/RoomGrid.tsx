import { useState } from 'react'
import { roomTemplates, categories, categoryLabels } from '../../rooms/roomTemplates'
import { useStore } from '../../store/useStore'
import type { RoomCategory } from '../../types'

const categoryIcons: Record<string, string> = {
  living: '🛋️',
  kitchen: '🍳',
  bathroom: '🚿',
  bedroom: '🛏️',
  commercial: '🏢',
  outdoor: '🌿',
}

export function RoomGrid() {
  const [activeCategory, setActiveCategory] = useState<RoomCategory | 'all'>('all')
  const { setRoom } = useStore()

  const filtered = activeCategory === 'all'
    ? roomTemplates
    : roomTemplates.filter((r) => r.category === activeCategory)

  return (
    <div className="w-full h-full flex flex-col bg-gray-950 overflow-auto">
      {/* Header */}
      <div className="px-8 pt-12 pb-6 text-center">
        <h1 className="text-3xl font-bold text-white mb-2">Marble Tile Visualizer</h1>
        <p className="text-gray-400 text-sm max-w-md mx-auto">
          Select a room to begin. Upload your marble slab image and see it tiled realistically in 3D.
        </p>
      </div>

      {/* Category filter */}
      <div className="px-8 pb-6">
        <div className="flex gap-2 justify-center flex-wrap">
          <button
            onClick={() => setActiveCategory('all')}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-all border ${
              activeCategory === 'all'
                ? 'bg-amber-500 text-gray-900 border-amber-500'
                : 'bg-gray-800 text-gray-400 border-gray-700 hover:border-gray-500'
            }`}
          >
            All Rooms
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat as RoomCategory)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all border ${
                activeCategory === cat
                  ? 'bg-amber-500 text-gray-900 border-amber-500'
                  : 'bg-gray-800 text-gray-400 border-gray-700 hover:border-gray-500'
              }`}
            >
              {categoryIcons[cat]} {categoryLabels[cat]}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="px-8 pb-8 grid grid-cols-3 gap-4 max-w-4xl mx-auto w-full">
        {filtered.map((room) => (
          <button
            key={room.id}
            onClick={() => setRoom(room)}
            className="group rounded-2xl overflow-hidden border-2 border-gray-700 hover:border-amber-500 transition-all hover:shadow-xl hover:shadow-amber-500/10 text-left"
          >
            {/* Room preview */}
            <div className={`h-40 bg-gradient-to-br ${room.previewGradient} relative`}>
              {/* Simplified 3D perspective illustration */}
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 200 120" preserveAspectRatio="none">
                {/* Floor */}
                <polygon points="20,100 100,70 180,100 180,120 20,120" fill="rgba(0,0,0,0.25)" />
                {/* Back wall */}
                <polygon points="20,20 100,0 180,20 100,70 20,100" fill="rgba(255,255,255,0.08)" />
                {/* Left wall */}
                <polygon points="20,20 20,100 100,70 100,0" fill="rgba(0,0,0,0.15)" />
                {/* Grid on floor */}
                {[30,50,70,90].map((y) => (
                  <line key={y} x1="20" y1={y+70} x2="180" y2={y+30} stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
                ))}
                {[40,80,120,160].map((x) => (
                  <line key={x} x1={x} y1="120" x2={x+60} y2="70" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
                ))}
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-4xl opacity-60">{categoryIcons[room.category]}</span>
              </div>
              <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="bg-amber-500 text-gray-900 text-xs font-bold px-2 py-1 rounded-md">
                  Open →
                </div>
              </div>
            </div>
            <div className="px-4 py-3 bg-gray-800">
              <p className="text-sm font-semibold text-white">{room.name}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {room.floorWidth}×{room.floorDepth} cm · {room.wallHeight > 0 ? `${room.wallHeight}cm walls` : 'No walls'}
              </p>
              <p className="text-xs text-gray-600 mt-1">{room.surfaces.length} clickable surfaces</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
