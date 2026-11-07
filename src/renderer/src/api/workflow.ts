import { call } from './call'
import type { WorkflowInput, WorkflowKind, WorkflowRow } from '../../../shared/types/workflow'

export const workflowApi = {
  list: (page: number, kind?: WorkflowKind) => call<{ list: WorkflowRow[]; total: number }>('workflow:list', { page, kind }),
  save: (input: WorkflowInput) => call<WorkflowRow>('workflow:save', input),
  approve: (id: number) => call<WorkflowRow>('workflow:approve', id),
  convert: (id: number, target: WorkflowKind) => call<WorkflowRow>('workflow:convert', { id, target }),
  cancel: (id: number) => call<void>('workflow:cancel', id)
}
