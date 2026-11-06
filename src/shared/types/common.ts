export interface PageQuery { page: number; pageSize: number; keyword?: string; includeDisabled?: boolean }
export interface PageResult<T> { list: T[]; total: number }
