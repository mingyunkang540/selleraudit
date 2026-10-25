import type { SupabaseClient } from '@supabase/supabase-js'

export type WorkspaceRole = 'ADMIN' | 'EDITOR' | 'VIEWER'
export interface ActiveWorkspace {
  id: string
  name: string
  role: WorkspaceRole
}

export function canWrite(role: WorkspaceRole | null): boolean {
  return role === 'ADMIN' || role === 'EDITOR'
}

export async function loadActiveWorkspaces(supabase: SupabaseClient, userId: string): Promise<ActiveWorkspace[]> {
  const members = await supabase.from('workspace_members')
    .select('workspace_id,role,status').eq('user_id', userId).eq('status', 'ACTIVE')
  if (members.error) throw new Error('워크스페이스 권한을 확인하지 못했습니다. 다시 시도해 주세요.')
  const rows = members.data ?? []
  if (rows.length === 0) return []
  const ids = rows.map(row => row.workspace_id)
  const workspaces = await supabase.from('workspaces').select('id,name').in('id', ids)
  if (workspaces.error) throw new Error('워크스페이스 정보를 불러오지 못했습니다. 다시 시도해 주세요.')
  const names = new Map((workspaces.data ?? []).map(row => [row.id, row.name]))
  return rows.map(row => {
    if (!isRole(row.role) || row.status !== 'ACTIVE' || typeof row.workspace_id !== 'string') {
      throw new Error('워크스페이스 권한 정보가 올바르지 않습니다.')
    }
    const name = names.get(row.workspace_id)
    if (typeof name !== 'string' || !name.trim()) throw new Error('워크스페이스 정보가 올바르지 않습니다.')
    return { id: row.workspace_id, name, role: row.role }
  }).sort((a, b) => a.name.localeCompare(b.name, 'ko-KR'))
}

function isRole(value: unknown): value is WorkspaceRole {
  return value === 'ADMIN' || value === 'EDITOR' || value === 'VIEWER'
}
