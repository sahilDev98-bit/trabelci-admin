import { useMemo } from 'react'
import { useStore } from '../../store/useStore'
import { calcTiles } from '../../utils/calculator'

export function Calculator() {
  // calculatorData.tileWidth/tileHeight are already kept in sync with the
  // selected surface's tile settings by setSurface()/updateTileSettings().
  const { calculatorData: data, updateCalculator } = useStore()

  const result = useMemo(() => calcTiles(data), [
    data.surfaceWidth, data.surfaceHeight,
    data.tileWidth, data.tileHeight, data.wastagePercent
  ])

  const inputCls = "w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500"
  const labelCls = "text-xs text-gray-500 mb-0.5 block"

  return (
    <div className="bg-gray-800 rounded-xl p-3 mb-3 border border-gray-700">
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div>
          <label className={labelCls}>Surface Width (cm)</label>
          <input type="number" className={inputCls} value={data.surfaceWidth} min={1}
            onChange={(e) => updateCalculator({ surfaceWidth: Number(e.target.value) })} />
        </div>
        <div>
          <label className={labelCls}>Surface Height (cm)</label>
          <input type="number" className={inputCls} value={data.surfaceHeight} min={1}
            onChange={(e) => updateCalculator({ surfaceHeight: Number(e.target.value) })} />
        </div>
        <div>
          <label className={labelCls}>Tile Width (cm)</label>
          <input type="number" className={inputCls} value={data.tileWidth} min={1}
            onChange={(e) => updateCalculator({ tileWidth: Number(e.target.value) })} />
        </div>
        <div>
          <label className={labelCls}>Tile Height (cm)</label>
          <input type="number" className={inputCls} value={data.tileHeight} min={1}
            onChange={(e) => updateCalculator({ tileHeight: Number(e.target.value) })} />
        </div>
        <div className="col-span-2">
          <label className={labelCls}>Wastage %</label>
          <input type="number" className={inputCls} value={data.wastagePercent} min={0} max={50}
            onChange={(e) => updateCalculator({ wastagePercent: Number(e.target.value) })} />
        </div>
      </div>

      <div className="border-t border-gray-700 pt-2 space-y-1.5">
        <div className="flex justify-between">
          <span className="text-xs text-gray-500">Surface area</span>
          <span className="text-xs text-white font-mono">{(result.surfaceArea / 10000).toFixed(2)} m²</span>
        </div>
        <div className="flex justify-between">
          <span className="text-xs text-gray-500">Tile area</span>
          <span className="text-xs text-white font-mono">{(result.tileArea / 10000).toFixed(4)} m²</span>
        </div>
        <div className="flex justify-between">
          <span className="text-xs text-gray-500">Base tiles</span>
          <span className="text-xs text-white font-mono">{result.baseTiles}</span>
        </div>
        <div className="flex justify-between items-center pt-1 border-t border-gray-700">
          <span className="text-xs text-gray-400 font-medium">With {data.wastagePercent}% wastage</span>
          <span className="text-sm text-amber-400 font-bold font-mono">{result.withWastage} tiles</span>
        </div>
      </div>
    </div>
  )
}
