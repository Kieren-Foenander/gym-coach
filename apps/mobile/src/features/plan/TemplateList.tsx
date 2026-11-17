import { Pressable, View } from "react-native"
import { PLAN_TEMPLATES } from "~/domain/templates"
import { call } from "@/api/session"
import { ChevronIcon } from "@/components/icons"
import { Display, ErrorNote, Eyebrow, Text } from "@/components/ui"
import { useAction } from "@/data/calls"
import { cn } from "@/lib/cn"
import { colors } from "@/theme"

/** The starter plans. Choosing one makes it the active plan. */
export function TemplateList({ onDone }: { readonly onDone: () => void }) {
  const { act, pending, error } = useAction()

  return (
    <View className="gap-2 pb-2">
      <ErrorNote message={error} />
      {PLAN_TEMPLATES.map((template) => (
        <Pressable
          key={template.id}
          accessibilityRole="button"
          disabled={pending}
          onPress={() =>
            act(async () => {
              await call("applyTemplate", { templateId: template.id })
              onDone()
            })
          }
          className={cn(
            "flex-row items-center justify-between gap-3 rounded-3xl border border-white/5 bg-raised/60 p-4 active:border-accent/40",
            pending && "opacity-50",
          )}
        >
          <View className="flex-1">
            <Eyebrow className="text-xs text-accent">{template.plan.days.length} days</Eyebrow>
            <Display className="text-2xl">{template.plan.name}</Display>
            <Text className="text-sm text-muted">{template.summary}</Text>
          </View>
          <ChevronIcon size={20} color={colors.faint} />
        </Pressable>
      ))}
    </View>
  )
}
