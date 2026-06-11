import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import type { SkuDropdownValue } from "@/features/skuManagement/types"

interface CeramicDropdownProps {
  options: SkuDropdownValue[]
  value: string
  onSelect: (value: string) => void
  onClose: () => void
  triggerRect: DOMRect
}

export function CeramicDropdown({
  options,
  value,
  onSelect,
  onClose,
  triggerRect,
}: CeramicDropdownProps) {
  const { t, i18n } = useTranslation()
  const isHe = i18n.language === "he"
  const [search, setSearch] = useState("")
  const [activeIndex, setActiveIndex] = useState(-1)
  const popoverRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = options.filter((o) => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    const label = (isHe ? o.label_he : o.label_en) ?? o.value
    return (
      label.toLowerCase().includes(q) ||
      o.value.toLowerCase().includes(q)
    )
  })

  // Position the popover
  const pos = useMemo(() => {
    const top = triggerRect.bottom + 4
    const left = triggerRect.left
    const width = Math.max(triggerRect.width, 200)
    // Clamp to viewport
    const maxLeft = window.innerWidth - width - 8
    const clampedLeft = Math.min(left, maxLeft)
    const maxTop = window.innerHeight - 260
    if (top > maxTop) {
      // Open upward
      return { top: triggerRect.top - 260, left: clampedLeft, width }
    }
    return { top, left: clampedLeft, width }
  }, [triggerRect])

  // Focus the search input on mount
  useEffect(() => {
    requestAnimationFrame(() => searchRef.current?.focus())
  }, [])

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener("mousedown", handleClick, true)
    return () => document.removeEventListener("mousedown", handleClick, true)
  }, [onClose])

  // Close on scroll or resize
  useEffect(() => {
    const close = () => onClose()
    window.addEventListener("scroll", close, true)
    window.addEventListener("resize", close)
    return () => {
      window.removeEventListener("scroll", close, true)
      window.removeEventListener("resize", close)
    }
  }, [onClose])

  // Scroll active item into view
  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return
    const items = listRef.current.children
    const item = items[activeIndex] as HTMLElement | undefined
    item?.scrollIntoView({ block: "nearest" })
  }, [activeIndex])

  const handleSelect = useCallback(
    (val: string) => {
      onSelect(val)
      onClose()
    },
    [onSelect, onClose],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault()
          setActiveIndex((i) => Math.min(i + 1, filtered.length - 1))
          break
        case "ArrowUp":
          e.preventDefault()
          setActiveIndex((i) => Math.max(i - 1, 0))
          break
        case "Enter":
        case "Tab":
          e.preventDefault()
          // No highlight yet → take the first match (matches the old editor)
          if (activeIndex >= 0 && activeIndex < filtered.length) {
            handleSelect(filtered[activeIndex].value)
          } else if (filtered.length >= 1) {
            handleSelect(filtered[0].value)
          }
          break
        case "Escape":
          e.preventDefault()
          onClose()
          break
      }
    },
    [filtered, activeIndex, handleSelect, onClose],
  )

  const getLabel = (o: SkuDropdownValue) =>
    (isHe ? o.label_he : o.label_en) ?? o.value

  return createPortal(
    <div
      ref={popoverRef}
      onKeyDown={handleKeyDown}
      className="ceramic-dropdown-portal"
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        width: pos.width,
        zIndex: 99999,
        fontFamily: "'DM Sans', 'Heebo', sans-serif",
      }}
    >
      <style>{`
        .ceramic-dropdown-portal {
          background: #ffffff;
          border: 1px solid rgba(30,36,60,.12);
          border-radius: 14px;
          box-shadow: 0 20px 50px -10px rgba(20,24,48,.35);
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        .dark .ceramic-dropdown-portal {
          background: #1f2430;
          border: 1px solid rgba(255,255,255,.10);
          box-shadow: 0 20px 50px -10px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.06);
        }
        .ceramic-dropdown-search {
          width: 100%;
          padding: 10px 12px;
          border: none;
          border-bottom: 1px solid rgba(30,36,60,.10);
          background: rgba(30,36,60,.03);
          color: #23263a;
          font: 500 13px/1.4 'DM Sans', 'Heebo', sans-serif;
          outline: none;
        }
        .dark .ceramic-dropdown-search {
          border-bottom: 1px solid rgba(255,255,255,.08);
          background: rgba(255,255,255,.04);
          color: #f4f1ff;
        }
        .ceramic-dropdown-search:focus {
          box-shadow: inset 0 -2px 0 rgba(24,24,27,.45);
        }
        .dark .ceramic-dropdown-search:focus {
          box-shadow: inset 0 -2px 0 rgba(255,255,255,.45);
        }
        .ceramic-dropdown-search::placeholder {
          color: #9aa0b8;
        }
        .ceramic-dropdown-list {
          max-height: 200px;
          overflow-y: auto;
          padding: 4px;
        }
        .ceramic-dropdown-list::-webkit-scrollbar {
          width: 6px;
        }
        .ceramic-dropdown-list::-webkit-scrollbar-track {
          background: transparent;
        }
        .ceramic-dropdown-list::-webkit-scrollbar-thumb {
          background: rgba(128,134,160,.35);
          border-radius: 3px;
        }
        .ceramic-dropdown-item {
          padding: 8px 12px;
          cursor: pointer;
          color: #3a3f55;
          font: 500 13px/1.4 'DM Sans', 'Heebo', sans-serif;
          border-radius: 10px;
          transition: background .12s, color .12s;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .dark .ceramic-dropdown-item {
          color: #c7cbef;
        }
        .ceramic-dropdown-item:hover,
        .ceramic-dropdown-item[data-active="true"] {
          background: rgba(24,24,27,.07);
          color: #18181b;
        }
        .dark .ceramic-dropdown-item:hover,
        .dark .ceramic-dropdown-item[data-active="true"] {
          background: rgba(255,255,255,.09);
          color: #fafafa;
        }
        .ceramic-dropdown-item[data-selected="true"] {
          color: #18181b;
          font-weight: 700;
        }
        .dark .ceramic-dropdown-item[data-selected="true"] {
          color: #fafafa;
        }
        .ceramic-dropdown-check {
          width: 14px;
          height: 14px;
          opacity: 0;
        }
        .ceramic-dropdown-item[data-selected="true"] .ceramic-dropdown-check {
          opacity: 1;
        }
        .ceramic-dropdown-empty {
          padding: 16px 12px;
          text-align: center;
          color: #9aa0b8;
          font-size: 12px;
        }
      `}</style>

      <input
        ref={searchRef}
        className="ceramic-dropdown-search"
        type="text"
        placeholder={t("sku.dropdowns.search")}
        value={search}
        onChange={(e) => {
          setSearch(e.target.value)
          setActiveIndex(0)
        }}
        dir="auto"
      />

      <div ref={listRef} className="ceramic-dropdown-list">
        {filtered.length === 0 ? (
          <div className="ceramic-dropdown-empty">
            {t("sku.dropdowns.noOptions")}
          </div>
        ) : (
          filtered.map((o, idx) => (
            <div
              key={o.value}
              className="ceramic-dropdown-item"
              data-active={idx === activeIndex}
              data-selected={o.value === value}
              onMouseEnter={() => setActiveIndex(idx)}
              onMouseDown={(e) => {
                e.preventDefault()
                handleSelect(o.value)
              }}
            >
              <span>{getLabel(o)}</span>
              <svg
                className="ceramic-dropdown-check"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
          ))
        )}
      </div>
    </div>,
    document.body,
  )
}
