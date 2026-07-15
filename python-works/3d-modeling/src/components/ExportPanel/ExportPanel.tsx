import html2canvas from 'html2canvas'

async function exportImage(format: 'png' | 'jpeg') {
  const wrapper = document.getElementById('room-canvas-wrapper')
  if (!wrapper) return

  try {
    const canvas = await html2canvas(wrapper, {
      useCORS: true,
      backgroundColor: '#111827',
      scale: 2,
    })
    const link = document.createElement('a')
    link.download = `marble-room.${format}`
    link.href = canvas.toDataURL(`image/${format}`, 0.95)
    link.click()
  } catch (err) {
    console.error('Export failed:', err)
  }
}

export function ExportPanel() {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-widest">Export</p>
      <div className="flex gap-2">
        <button
          onClick={() => exportImage('png')}
          className="flex-1 py-2 bg-gray-800 hover:bg-amber-500 hover:text-gray-900 border border-gray-600 hover:border-amber-500 text-gray-300 text-xs rounded-lg transition-all font-medium"
        >
          PNG
        </button>
        <button
          onClick={() => exportImage('jpeg')}
          className="flex-1 py-2 bg-gray-800 hover:bg-amber-500 hover:text-gray-900 border border-gray-600 hover:border-amber-500 text-gray-300 text-xs rounded-lg transition-all font-medium"
        >
          JPG
        </button>
      </div>
    </div>
  )
}
