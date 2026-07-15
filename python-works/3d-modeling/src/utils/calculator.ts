import type { CalculatorData, CalcResult } from '../types'

export function calcTiles(data: CalculatorData): CalcResult {
  const surfaceArea = data.surfaceWidth * data.surfaceHeight
  const tileArea = data.tileWidth * data.tileHeight
  if (tileArea <= 0) return { surfaceArea, tileArea: 0, baseTiles: 0, withWastage: 0 }
  const baseTiles = Math.ceil(surfaceArea / tileArea)
  const withWastage = Math.ceil(baseTiles * (1 + data.wastagePercent / 100))
  return { surfaceArea, tileArea, baseTiles, withWastage }
}
