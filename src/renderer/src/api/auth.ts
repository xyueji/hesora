import { call } from './call'

export interface SessionUser {
  id: number
  username: string
  role: 'admin' | 'cashier'
}

export const authApi = {
  setupStatus: () => call<{ required: boolean; username?: string }>("auth:setupStatus"),
  setup: (username: string, password: string) => call<SessionUser>("auth:setup", { username, password }),
  login: (username: string, password: string) =>
    call<SessionUser | null>('auth:login', { username, password }),
  current: () => call<SessionUser | null>('auth:current'),
  logout: () => call<boolean>('auth:logout')
}
