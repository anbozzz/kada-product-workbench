import { requestJson } from '@/lib/api-client'
export type Publication = { id: string; projectKey: string; name: string; snapshotId: string; generatedAt: string; enabled: boolean; available: boolean; error?: string; project: { id: string; projectPath?: string } }
export type PublicationStatus = { running: boolean; port: number | null; addresses: string[]; revision: number; records: Publication[]; token?: string; serviceError?: string; pending?: boolean; cleanupPending?: number }
export const loadPublications = () => requestJson<PublicationStatus>('/api/publications', undefined, '无法读取发布服务')
export const publicationCommand = (status: PublicationStatus, action: string, values: Record<string, unknown> = {}, operationId: string = crypto.randomUUID()) => requestJson<PublicationStatus>('/api/publications/commands', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-publication-token': status.token || '' },
  body: JSON.stringify({ action, operationId, expectedRevision: status.revision, ...values }),
}, '发布操作失败')
export const publicationSecret = (status: PublicationStatus, id: string) => requestJson<{ password: string }>('/api/publications/secret', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-publication-token': status.token || '' }, body: JSON.stringify({ id }),
}, '无法读取密码')

export const publicationOperation = (status: PublicationStatus, operationId: string) => requestJson<PublicationStatus & { completed: boolean; pending: boolean; retryable: boolean; error?: string }>('/api/publications/operation', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-publication-token': status.token || '' }, body: JSON.stringify({ operationId }),
}, '无法核实原发布操作')
