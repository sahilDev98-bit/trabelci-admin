import { useStore } from './store/useStore'
import { LeftSidebar } from './components/Sidebar/LeftSidebar'
import { RoomViewer } from './components/RoomViewer/RoomViewer'
import { RoomGrid } from './components/RoomGrid/RoomGrid'
import { CompareView } from './components/CompareView/CompareView'
import { TopBar } from './components/TopBar/TopBar'

function App() {
  const { selectedRoom, viewMode } = useStore()
  // ?embed=1 — used when this app is embedded in an iframe (e.g. the
  // modeling-automation workflow's "Arrange & Review" step) and the room/
  // marble are already fully configured via postMessage: shows just the 3D
  // scene, no sidebar/top bar chrome, since there's nothing left to configure.
  const isEmbedded = new URLSearchParams(window.location.search).get('embed') === '1'

  if (isEmbedded) {
    return (
      <div className="h-screen w-screen bg-gray-950 text-white overflow-hidden">
        {!selectedRoom ? (
          <div className="h-full w-full flex items-center justify-center text-gray-500 text-sm">
            Waiting for room selection…
          </div>
        ) : viewMode === 'compare' ? (
          <CompareView />
        ) : (
          <RoomViewer room={selectedRoom} id="room-canvas-wrapper" showOrbitControls />
        )}
      </div>
    )
  }

  return (
    <div className="flex h-screen w-screen bg-gray-950 text-white overflow-hidden">
      <LeftSidebar />

      <div className="flex flex-col flex-1 min-w-0">
        <TopBar />

        <div className="flex-1 relative overflow-hidden">
          {!selectedRoom ? (
            <RoomGrid />
          ) : viewMode === 'compare' ? (
            <CompareView />
          ) : (
            <RoomViewer room={selectedRoom} id="room-canvas-wrapper" />
          )}
        </div>
      </div>
    </div>
  )
}

export default App
