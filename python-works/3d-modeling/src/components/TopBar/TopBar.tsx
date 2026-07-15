import { useStore } from '../../store/useStore'

export function TopBar() {
  const { selectedRoom, selectedSurface, viewMode, setViewMode, setSurface } = useStore()

  if (!selectedRoom) return null

  const surfaceHint = selectedSurface
    ? `Selected: ${selectedSurface}`
    : 'Click a surface in the 3D view'

  return (
    <div className="h-12 bg-gray-800 border-b border-gray-700 flex items-center justify-between px-4 flex-shrink-0">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-white">{selectedRoom.name}</span>
        <span className="text-xs text-gray-500">·</span>
        <span className="text-xs text-gray-400">{surfaceHint}</span>
      </div>

      <div className="flex items-center gap-2">
        {/* View toggle */}
        <div className="flex bg-gray-900 rounded-lg p-0.5 border border-gray-700">
          <button
            onClick={() => setViewMode('single')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              viewMode === 'single'
                ? 'bg-amber-500 text-gray-900'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            3D View
          </button>
          <button
            onClick={() => setViewMode('compare')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              viewMode === 'compare'
                ? 'bg-amber-500 text-gray-900'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Compare
          </button>
        </div>

        {/* Deselect surface */}
        {selectedSurface && (
          <button
            onClick={() => setSurface(null)}
            className="text-xs text-gray-500 hover:text-white px-2 py-1 rounded transition-colors"
          >
            Deselect
          </button>
        )}
      </div>
    </div>
  )
}
