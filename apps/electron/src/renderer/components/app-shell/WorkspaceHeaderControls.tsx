import { useAtom } from 'jotai'
import type { ReactElement } from 'react'
import { Columns2, PanelLeft, PanelRight } from 'lucide-react'
import { agentSidePanelOpenAtomFamily, agentWorkspacePositionAtom } from '@/atoms/agent-atoms'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface WorkspaceHeaderControlsProps {
  scopeId: string
  chatLabel: 'Agent' | '聊天'
}

const controlClassName = 'inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40'

export function WorkspaceHeaderControls({ scopeId, chatLabel }: WorkspaceHeaderControlsProps): ReactElement {
  const [isOpen, setOpen] = useAtom(agentSidePanelOpenAtomFamily(scopeId))
  const [workspacePosition, setWorkspacePosition] = useAtom(agentWorkspacePositionAtom)
  const WorkspacePanelIcon = workspacePosition === 'center' ? PanelLeft : PanelRight

  return (
    <div className="ml-auto flex shrink-0 items-center gap-1 titlebar-no-drag">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={controlClassName} aria-label="工作区布局" title="工作区布局">
            <Columns2 className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="z-[100] titlebar-no-drag">
          <DropdownMenuRadioGroup
            value={workspacePosition}
            onValueChange={(value) => {
              if (value !== 'center' && value !== 'right') return
              setWorkspacePosition(value)
              setOpen(true)
            }}
          >
            <DropdownMenuRadioItem value="right">{chatLabel} 居中，文件在右</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="center">文件居中，{chatLabel} 在右</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {!isOpen && (
        <button type="button" onClick={() => setOpen(true)} className={controlClassName} aria-label="展开工作区">
          <WorkspacePanelIcon className="size-4" />
        </button>
      )}
    </div>
  )
}
