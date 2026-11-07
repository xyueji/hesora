import { call } from './call'
import type { FulfillmentRequest, WorkflowInput, WorkflowKind, WorkflowRow } from '../../../shared/types/workflow'

export const workflowApi = {
  list: (page: number, kind?: WorkflowKind) => call<{ list: WorkflowRow[]; total: number }>('workflow:list', { page, kind }),
  save: (input: WorkflowInput) => call<WorkflowRow>('workflow:save', input),
  approve: (id: number) => call<WorkflowRow>('workflow:approve', id),
  convert: (id: number, target: WorkflowKind, quantities?: FulfillmentRequest[]) =>
    call<WorkflowRow>('workflow:convert', { id, target, quantities }),
  cancel: (id: number) => call<void>('workflow:cancel', id)
}
