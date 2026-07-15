import { useRef, useState } from 'react'
import { roomTemplates, categories, categoryLabels } from '../../rooms/roomTemplates'
import { useStore, DEFAULT_TILE_SETTINGS, type MarbleSKU } from '../../store/useStore'
import type { RoomCategory, BookmatchMode, SurfaceId } from '../../types'
import { getSurfaceDimensions } from '../../utils/textureTransform'
import { Calculator } from '../Calculator/Calculator'
import { ExportPanel } from '../ExportPanel/ExportPanel'

const categoryIcons: Record<string, string> = {
  living: '🛋️',
  kitchen: '🍳',
  bathroom: '🚿',
  bedroom: '🛏️',
  commercial: '🏢',
  outdoor: '🌿',
}

const surfaceLabels: Record<SurfaceId, string> = {
  floor: 'Floor',
  wall1: 'Back Wall',
  wall2: 'Left Wall',
  wall3: 'Right Wall',
  wall4: 'Front Wall',
}

const bookmatchOptions: { value: BookmatchMode; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'horizontal', label: 'H' },
  { value: 'vertical', label: 'V' },
  { value: 'quad', label: 'Quad' },
]

function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 my-3">
      <div className="flex-1 h-px bg-gray-700" />
      <span className="text-xs text-gray-500 uppercase tracking-widest font-medium">{label}</span>
      <div className="flex-1 h-px bg-gray-700" />
    </div>
  )
}

function SliderRow({ label, value, min, max, step = 1, unit = '', onChange }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string
  onChange: (v: number) => void
}) {
  return (
    <div className="mb-3">
      <div className="flex justify-between mb-1">
        <span className="text-xs text-gray-400">{label}</span>
        <span className="text-xs text-amber-400 font-mono">{value.toFixed(step < 1 ? 1 : 0)}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-amber-500 h-1.5 rounded" />
    </div>
  )
}

function NumberInput({ label, value, min, max, unit = '', onChange }: {
  label: string; value: number; min: number; max: number; unit?: string
  onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="text-xs text-gray-400 w-16 shrink-0">{label}</span>
      <input type="number" min={min} max={max} value={value}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value))))}
        className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500" />
      {unit && <span className="text-xs text-gray-500">{unit}</span>}
    </div>
  )
}

export function LeftSidebar() {
  const [activeCategory, setActiveCategory] = useState<RoomCategory>('living')
  const [activeTab, setActiveTab] = useState<'room' | 'controls'>('room')
  const singleRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)
  const skuNameRef = useRef<HTMLInputElement>(null)

  const { selectedRoom, setRoom, updateRoomDimensions } = useStore()
  const {
    selectedSurface, uploadedImages, uploadedSKUs, activeSKUId,
    surfaceApplied, surfaceTileSettings, showCalculator,
    setSurface, setSingleImage, addUploadedImage, removeUploadedImage,
    clearUploadedImages, applyToSurface, removeSurfaceApplied,
    updateTileSettings, reset, toggleCalculator,
    addSKU, removeSKU, setActiveSKU,
  } = useStore()

  const tileSettings = (selectedSurface ? surfaceTileSettings[selectedSurface] : undefined) ?? DEFAULT_TILE_SETTINGS

  const filtered = roomTemplates.filter((r) => r.category === activeCategory)

  const handleSingleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setSingleImage(URL.createObjectURL(file))
    e.target.value = ''
  }

  const handleFolderAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    files.forEach((f) => addUploadedImage(URL.createObjectURL(f)))
    e.target.value = ''
  }

  const handleSaveSKU = () => {
    if (uploadedImages.length === 0) return
    const name = skuNameRef.current?.value?.trim() || `SKU ${uploadedSKUs.length + 1}`
    const sku: MarbleSKU = { id: crypto.randomUUID(), name, urls: [...uploadedImages] }
    addSKU(sku)
    if (skuNameRef.current) skuNameRef.current.value = ''
  }

  const appliedUrls = selectedSurface ? (surfaceApplied[selectedSurface] ?? []) : []
  const isMulti = uploadedImages.length > 1

  return (
    <aside className="w-80 flex-shrink-0 bg-gray-900 border-r border-gray-700 flex flex-col h-full overflow-hidden">
      {/* Brand */}
      <div className="px-4 py-4 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded bg-amber-500 flex items-center justify-center text-sm font-bold text-gray-900">M</div>
          <span className="font-semibold text-white text-sm tracking-wide">MarbleViz</span>
        </div>
        <p className="text-gray-500 text-xs mt-1">3D Tile Visualizer</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-700">
        <button
          onClick={() => setActiveTab('room')}
          className={`flex-1 py-2.5 text-xs font-medium transition-all ${
            activeTab === 'room'
              ? 'text-amber-400 border-b-2 border-amber-500 bg-gray-800/50'
              : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          Room
        </button>
        <button
          onClick={() => setActiveTab('controls')}
          className={`flex-1 py-2.5 text-xs font-medium transition-all ${
            activeTab === 'controls'
              ? 'text-amber-400 border-b-2 border-amber-500 bg-gray-800/50'
              : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          Controls
        </button>
      </div>

      {/* Room Tab */}
      {activeTab === 'room' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-3 pt-3 pb-2">
            <p className="text-gray-500 text-xs uppercase tracking-widest mb-2 font-medium">Room Type</p>
            <div className="flex flex-col gap-0.5">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat as RoomCategory)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all text-left ${
                    activeCategory === cat
                      ? 'bg-amber-500 text-gray-900 font-medium'
                      : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                  }`}
                >
                  <span>{categoryIcons[cat]}</span>
                  <span>{categoryLabels[cat]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-2">
            <p className="text-gray-500 text-xs uppercase tracking-widest mb-2 font-medium">Scenes</p>
            <div className="flex flex-col gap-2">
              {filtered.map((room) => (
                <button
                  key={room.id}
                  onClick={() => setRoom(room)}
                  className={`group w-full rounded-xl overflow-hidden border-2 transition-all text-left ${
                    selectedRoom?.id === room.id
                      ? 'border-amber-500 shadow-lg shadow-amber-500/20'
                      : 'border-gray-700 hover:border-gray-500'
                  }`}
                >
                  <div className={`h-20 w-full bg-gradient-to-br ${room.previewGradient} relative flex items-end`}>
                    <svg className="absolute inset-0 w-full h-full opacity-20" viewBox="0 0 100 60">
                      <line x1="10" y1="55" x2="50" y2="30" stroke="white" strokeWidth="0.8" />
                      <line x1="90" y1="55" x2="50" y2="30" stroke="white" strokeWidth="0.8" />
                      <line x1="10" y1="55" x2="90" y2="55" stroke="white" strokeWidth="0.8" />
                      <line x1="10" y1="15" x2="50" y2="30" stroke="white" strokeWidth="0.5" strokeDasharray="2 2" />
                      <line x1="10" y1="55" x2="10" y2="15" stroke="white" strokeWidth="0.5" />
                    </svg>
                    {selectedRoom?.id === room.id && (
                      <div className="absolute top-2 right-2 w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center">
                        <svg className="w-2.5 h-2.5 text-gray-900" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <div className="px-3 py-2 bg-gray-800">
                    <p className="text-xs font-medium text-white">{room.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{room.floorWidth}×{room.floorDepth}cm</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="px-4 py-3 border-t border-gray-700 text-xs text-gray-600 text-center">
            Click a room to start
          </div>
        </div>
      )}

      {/* Controls Tab */}
      {activeTab === 'controls' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {!selectedRoom ? (
            <div className="flex-1 flex items-center justify-center text-xs text-gray-600 px-4 text-center">
              Select a room first to access controls
            </div>
          ) : (
            <>
              <div className="px-3 py-2 border-b border-gray-700">
                <p className="text-xs text-gray-500">{selectedRoom.name}</p>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-3">
                {/* Hidden file inputs */}
                <input ref={singleRef} type="file" accept=".jpg,.jpeg,.png,.webp" className="hidden" onChange={handleSingleUpload} />
                <input ref={folderRef} type="file" accept=".jpg,.jpeg,.png,.webp" multiple className="hidden" onChange={handleFolderAdd} />

                {/* Real-world room dimensions — drives true tile scale (a 120cm
                    tile on a 400cm wall renders as ~3.3 tiles across, not a
                    mosaic-sized grid) */}
                <Divider label="Room Dimensions" />
                <NumberInput label="Width" value={selectedRoom.floorWidth} min={50} max={3000} unit="cm"
                  onChange={(v) => updateRoomDimensions({ floorWidth: v })} />
                <NumberInput label="Depth" value={selectedRoom.floorDepth} min={50} max={3000} unit="cm"
                  onChange={(v) => updateRoomDimensions({ floorDepth: v })} />
                {selectedRoom.surfaces.some((s) => s !== 'floor') && (
                  <NumberInput label="Wall Height" value={selectedRoom.wallHeight} min={100} max={800} unit="cm"
                    onChange={(v) => updateRoomDimensions({ wallHeight: v })} />
                )}
                {selectedSurface && (
                  <p className="text-xs text-gray-500 mb-1 -mt-1">
                    {(() => {
                      const dims = getSurfaceDimensions(selectedSurface, selectedRoom)
                      const ts = surfaceTileSettings[selectedSurface] ?? DEFAULT_TILE_SETTINGS
                      const cols = Math.ceil(dims.width / ts.tileWidth)
                      const rows = Math.ceil(dims.height / ts.tileHeight)
                      return `${surfaceLabels[selectedSurface]}: ${dims.width}×${dims.height}cm → ${cols}×${rows} tiles at ${ts.tileWidth}×${ts.tileHeight}cm`
                    })()}
                  </p>
                )}

                {/* Surface selector */}
                <Divider label="Surface" />
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {selectedRoom.surfaces.map((s) => (
                    <button key={s} onClick={() => setSurface(s)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                        selectedSurface === s
                          ? 'bg-amber-500 text-gray-900 border-amber-500'
                          : surfaceApplied[s]
                            ? 'bg-gray-700 text-amber-400 border-amber-700 hover:border-amber-500'
                            : 'bg-gray-800 text-gray-400 border-gray-600 hover:border-gray-400'
                      }`}
                    >
                      {surfaceLabels[s]}
                      {surfaceApplied[s] && <span className="ml-1 text-amber-400">●</span>}
                    </button>
                  ))}
                </div>

                {selectedSurface && (
                  <>
                    {/* Upload */}
                    <Divider label="Upload Marble" />
                    <div className="flex gap-2 mb-3">
                      <button onClick={() => singleRef.current?.click()}
                        className="flex-1 py-2 rounded-lg border border-dashed border-gray-600 hover:border-amber-500 text-xs text-gray-400 hover:text-amber-400 transition-all flex items-center justify-center gap-1">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Single Image
                      </button>
                      <button onClick={() => folderRef.current?.click()}
                        className="flex-1 py-2 rounded-lg border border-dashed border-amber-700 hover:border-amber-500 text-xs text-amber-600 hover:text-amber-400 transition-all flex items-center justify-center gap-1">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                        </svg>
                        Add to Folder
                      </button>
                    </div>

                    {uploadedImages.length > 0 && (
                      <div className="mb-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs text-gray-400">
                            {uploadedImages.length === 1 ? 'Single slab' : `${uploadedImages.length} slabs — Random placement`}
                            {isMulti && <span className="ml-1.5 px-1.5 py-0.5 bg-amber-500/20 text-amber-400 rounded text-xs">SKU</span>}
                          </span>
                          <button onClick={clearUploadedImages} className="text-xs text-gray-600 hover:text-red-400 transition-colors">Clear all</button>
                        </div>
                        <div className="grid grid-cols-3 gap-1.5">
                          {uploadedImages.map((url, i) => (
                            <div key={url} className="relative group rounded overflow-hidden border border-gray-700 aspect-square">
                              <img src={url} alt={`Slab ${i + 1}`} className="w-full h-full object-cover" />
                              <button
                                onClick={() => removeUploadedImage(url)}
                                className="absolute top-0.5 right-0.5 w-4 h-4 bg-red-600 rounded-full text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity leading-none"
                              >×</button>
                              <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs text-center py-0.5">
                                #{i + 1}
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-1.5 mt-2">
                          <input ref={skuNameRef} type="text" placeholder="SKU name (optional)"
                            className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500" />
                          <button onClick={handleSaveSKU}
                            className="px-2 py-1 bg-gray-700 hover:bg-amber-500/20 border border-gray-600 hover:border-amber-500 text-gray-400 hover:text-amber-400 text-xs rounded transition-all">
                            Save
                          </button>
                        </div>
                      </div>
                    )}

                    {uploadedImages.length > 0 && (
                      <div className="flex gap-2 mb-3">
                        <button onClick={applyToSurface}
                          className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 text-gray-900 text-xs font-bold rounded-lg transition-colors">
                          {isMulti
                            ? `Apply ${uploadedImages.length} Slabs Randomly → ${surfaceLabels[selectedSurface]}`
                            : `Apply to ${surfaceLabels[selectedSurface]}`}
                        </button>
                        {appliedUrls.length > 0 && (
                          <button onClick={() => removeSurfaceApplied(selectedSurface)}
                            className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-400 text-xs rounded-lg transition-colors" title="Remove texture">✕</button>
                        )}
                      </div>
                    )}

                    {uploadedSKUs.length > 0 && (
                      <>
                        <Divider label="Saved SKUs" />
                        <div className="space-y-1.5 mb-3">
                          {uploadedSKUs.map((sku) => (
                            <div key={sku.id}
                              className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-all ${
                                activeSKUId === sku.id
                                  ? 'bg-amber-500/10 border-amber-500'
                                  : 'bg-gray-800 border-gray-700 hover:border-gray-500'
                              }`}
                              onClick={() => setActiveSKU(activeSKUId === sku.id ? null : sku.id)}
                            >
                              <div className="flex gap-0.5 shrink-0">
                                {sku.urls.slice(0, 3).map((u, i) => (
                                  <img key={i} src={u} alt="" className="w-7 h-7 rounded object-cover border border-gray-600" />
                                ))}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium text-white truncate">{sku.name}</p>
                                <p className="text-xs text-gray-500">{sku.urls.length} slab{sku.urls.length > 1 ? 's' : ''}</p>
                              </div>
                              <button onClick={(e) => { e.stopPropagation(); removeSKU(sku.id) }}
                                className="text-gray-600 hover:text-red-400 transition-colors text-sm">✕</button>
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    <Divider label="Tile Size" />
                    <NumberInput label="Width" value={tileSettings.tileWidth} min={10} max={1200} unit="cm"
                      onChange={(v) => updateTileSettings({ tileWidth: v })} />
                    <NumberInput label="Height" value={tileSettings.tileHeight} min={10} max={1200} unit="cm"
                      onChange={(v) => updateTileSettings({ tileHeight: v })} />

                    <Divider label="Transform" />
                    <SliderRow label="Rotation" value={tileSettings.rotation} min={0} max={360} unit="°"
                      onChange={(v) => updateTileSettings({ rotation: v })} />
                    <div className="flex gap-2 mb-3">
                      <button onClick={() => updateTileSettings({ flipH: !tileSettings.flipH })}
                        className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-all ${
                          tileSettings.flipH ? 'bg-amber-500/20 border-amber-500 text-amber-400' : 'bg-gray-800 border-gray-600 text-gray-400 hover:border-gray-400'
                        }`}>⇄ Flip H</button>
                      <button onClick={() => updateTileSettings({ flipV: !tileSettings.flipV })}
                        className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-all ${
                          tileSettings.flipV ? 'bg-amber-500/20 border-amber-500 text-amber-400' : 'bg-gray-800 border-gray-600 text-gray-400 hover:border-gray-400'
                        }`}>⇅ Flip V</button>
                    </div>

                    {uploadedImages.length <= 1 && (
                      <>
                        <Divider label="Bookmatch" />
                        <div className="grid grid-cols-4 gap-1 mb-3">
                          {bookmatchOptions.map((opt) => (
                            <button key={opt.value} onClick={() => updateTileSettings({ bookmatch: opt.value })}
                              className={`py-2 rounded-lg text-xs font-medium transition-all border ${
                                tileSettings.bookmatch === opt.value
                                  ? 'bg-amber-500 text-gray-900 border-amber-500'
                                  : 'bg-gray-800 border-gray-600 text-gray-400 hover:border-gray-400'
                              }`}>{opt.label}</button>
                          ))}
                        </div>
                      </>
                    )}

                    <SliderRow label="Grout Size" value={tileSettings.groutSize} min={0} max={10} unit="px"
                      onChange={(v) => updateTileSettings({ groutSize: v })} />
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xs text-gray-400 flex-1">Grout Color</span>
                      <input
                        type="color"
                        value={tileSettings.groutColor}
                        onChange={(e) => updateTileSettings({ groutColor: e.target.value })}
                        className="w-8 h-6 rounded cursor-pointer bg-transparent border border-gray-600"
                        title="Grout color"
                      />
                      <span className="text-xs text-gray-500 font-mono w-16 text-right">{tileSettings.groutColor}</span>
                    </div>
                  </>
                )}

                <Divider label="Calculator" />
                <button onClick={toggleCalculator}
                  className="w-full py-2 mb-2 bg-gray-800 hover:bg-gray-700 border border-gray-600 hover:border-gray-400 text-gray-300 text-xs rounded-lg transition-all flex items-center justify-between px-3">
                  <span>Tile Quantity Calculator</span>
                  <span>{showCalculator ? '▲' : '▼'}</span>
                </button>
                {showCalculator && <Calculator />}

                <Divider label="Actions" />
                <button onClick={reset}
                  className="w-full py-2 bg-gray-800 hover:bg-red-900/40 border border-gray-600 hover:border-red-700 text-gray-400 hover:text-red-400 text-xs rounded-lg transition-all mb-2">
                  Reset All Textures
                </button>
              </div>

              <div className="border-t border-gray-700 px-4 py-3">
                <ExportPanel />
              </div>
            </>
          )}
        </div>
      )}
    </aside>
  )
}
