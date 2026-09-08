export interface PlannedTask {
  id: number
  name: string
  remark: string
  enabled: boolean

  schedule_type: string // "cron" | "interval" ("watch" reserved)
  cron_expr: string
  interval_sec: number
  timezone: string

  action: string
  params: string // JSON string consumed by the action

  last_run_at: string | null
  last_result: string // success | failed | running | skipped
  last_error: string
  next_run_at: string | null
  run_count: number
  fail_count: number

  creator_id: number
  created_at: string
  updated_at: string
}

export interface PlannedTaskRecord {
  id: number
  task_id: number
  start_time: string
  end_time: string | null
  duration_ms: number
  success: boolean
  skipped: boolean
  log: string
}

export interface PlannedTaskAction {
  name: string
  description: string
}
