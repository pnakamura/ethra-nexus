import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { useAgentSkills, useUpdateAgentSkill, useAddAgentSkill } from '@/hooks/useAgent'

const AVAILABLE_SKILLS = [
  'wiki:query', 'wiki:ingest', 'wiki:lint',
  'channel:respond', 'channel:proactive',
  'report:generate', 'monitor:health', 'monitor:alert',
  'data:analyze', 'data:extract',
]

interface SkillsSectionProps { agentId: string }

export function SkillsSection({ agentId }: SkillsSectionProps) {
  const { data: skills = [], isLoading } = useAgentSkills(agentId)
  const updateSkill = useUpdateAgentSkill(agentId)
  const addSkill = useAddAgentSkill(agentId)
  const [newSkill, setNewSkill] = useState('')

  const existingSkillNames = new Set(skills.map((s) => s.skill_name))
  const available = AVAILABLE_SKILLS.filter((s) => !existingSkillNames.has(s))

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    )
  }

  return (
    <div>
      <div className="flex flex-col gap-2 mb-5">
        {skills.length === 0 && (
          <p className="text-sm text-muted-foreground py-4 text-center">Nenhuma skill atribuída.</p>
        )}
        {skills.map((skill) => (
          <div key={skill.id} className="flex items-center justify-between p-3 border border-border rounded-lg bg-card">
            <div>
              <p className="text-sm font-medium text-foreground font-mono">{skill.skill_name}</p>
            </div>
            <Switch
              checked={skill.enabled}
              onCheckedChange={(enabled) => updateSkill.mutate({ skillId: skill.id, enabled })}
            />
          </div>
        ))}
      </div>

      {available.length > 0 && (
        <div className="flex gap-2">
          <Select value={newSkill} onValueChange={setNewSkill}>
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Adicionar skill..." />
            </SelectTrigger>
            <SelectContent>
              {available.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={() => { if (newSkill) { addSkill.mutate(newSkill); setNewSkill('') } }}
            disabled={!newSkill || addSkill.isPending}
          >
            <Plus size={16} className="mr-1" /> Adicionar
          </Button>
        </div>
      )}
    </div>
  )
}
