import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import type { FieldDefinition } from "@/features/fieldVisibility/types"

const GROUP_FALLBACKS: Record<string, string> = {
  basic: "Basic Info",
  pricing: "Pricing",
  stock: "Stock",
  location: "Location",
  attributes: "Attributes",
}

const GROUP_ORDER = ["basic", "pricing", "stock", "location", "attributes"]

interface FieldCheckboxGridProps {
  fields: FieldDefinition[]
  selected: Set<string>
  onChange: (selected: Set<string>) => void
}

export function FieldCheckboxGrid({ fields, selected, onChange }: FieldCheckboxGridProps) {
  const { t } = useTranslation()

  const grouped = GROUP_ORDER.map((group) => ({
    group,
    label: t(`fieldVisibility.groups.${group}`, GROUP_FALLBACKS[group] ?? group),
    items: fields.filter((f) => f.group === group),
  })).filter((g) => g.items.length > 0)

  const allSelected = fields.length > 0 && selected.size === fields.length
  const noneSelected = selected.size === 0

  const handleToggleAll = () => {
    if (allSelected) {
      onChange(new Set())
    } else {
      onChange(new Set(fields.map((f) => f.key)))
    }
  }

  const handleToggle = (key: string) => {
    const next = new Set(selected)
    if (next.has(key)) {
      next.delete(key)
    } else {
      next.add(key)
    }
    onChange(next)
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={handleToggleAll}>
          {allSelected
            ? t("fieldVisibility.deselectAll", "Deselect All")
            : t("fieldVisibility.selectAll", "Select All")}
        </Button>
        {!noneSelected && (
          <span className="text-xs text-muted-foreground">
            {selected.size} / {fields.length} {t("fieldVisibility.fieldsSelected", "fields selected")}
          </span>
        )}
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {grouped.map(({ group, label, items }) => (
          <div key={group} className="rounded-lg border p-4">
            <h4 className="mb-3 text-sm font-semibold text-foreground">{label}</h4>
            <div className="space-y-2">
              {items.map((field) => (
                <label
                  key={field.key}
                  className="flex cursor-pointer items-center gap-2.5 rounded px-1 py-1 text-sm hover:bg-accent/50"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(field.key)}
                    onChange={() => handleToggle(field.key)}
                    className="size-4 rounded border-border accent-primary"
                  />
                  <span>{t(`fieldVisibility.fields.${field.key}`, field.label)}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
