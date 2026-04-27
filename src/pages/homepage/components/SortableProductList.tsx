import { useCallback, useState } from "react"
import { useTranslation } from "react-i18next"
import { GripVerticalIcon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"

export interface SortableProduct {
  id: string
  sku: string
  name: string
  coverUrl: string | null
}

interface SortableProductListProps {
  items: SortableProduct[]
  onReorder: (items: SortableProduct[]) => void
  onRemove: (productId: string) => void
}

export function SortableProductList({ items, onReorder, onRemove }: SortableProductListProps) {
  const { t } = useTranslation()
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  const handleDragStart = useCallback((index: number) => {
    setDragIndex(index)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault()
    setDragOverIndex(index)
  }, [])

  const handleDrop = useCallback(
    (targetIndex: number) => {
      if (dragIndex === null || dragIndex === targetIndex) {
        setDragIndex(null)
        setDragOverIndex(null)
        return
      }

      const newOrder = [...items]
      const [moved] = newOrder.splice(dragIndex, 1)
      newOrder.splice(targetIndex, 0, moved)
      onReorder(newOrder)
      setDragIndex(null)
      setDragOverIndex(null)
    },
    [dragIndex, items, onReorder],
  )

  const handleDragEnd = useCallback(() => {
    setDragIndex(null)
    setDragOverIndex(null)
  }, [])

  if (items.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {t("homepage.noItemsYet", "No products added yet. Click \"Add Product\" to get started.")}
      </p>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[48px]" />
          <TableHead className="w-[56px]" />
          <TableHead>{t("common.name", "Name")}</TableHead>
          <TableHead>{t("homepage.sku", "SKU")}</TableHead>
          <TableHead className="w-[48px]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item, index) => (
          <TableRow
            key={item.id}
            draggable
            onDragStart={() => handleDragStart(index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDrop={() => handleDrop(index)}
            onDragEnd={handleDragEnd}
            className={cn(
              "cursor-grab active:cursor-grabbing",
              dragIndex === index && "opacity-50",
              dragOverIndex === index && dragIndex !== index && "border-t-2 border-t-primary",
            )}
          >
            <TableCell className="px-2">
              <GripVerticalIcon className="size-4 text-muted-foreground" />
            </TableCell>
            <TableCell>
              {item.coverUrl ? (
                <img
                  src={item.coverUrl}
                  alt={item.name}
                  className="size-10 rounded border object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="grid size-10 place-items-center rounded border border-dashed text-xs text-muted-foreground">
                  —
                </div>
              )}
            </TableCell>
            <TableCell className="font-medium">{item.name}</TableCell>
            <TableCell className="text-muted-foreground">{item.sku}</TableCell>
            <TableCell>
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive hover:text-destructive"
                onClick={() => onRemove(item.id)}
              >
                <XIcon className="size-4" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
