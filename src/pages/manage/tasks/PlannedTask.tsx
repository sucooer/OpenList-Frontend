import {
  Box,
  Button,
  FormControl,
  FormHelperText,
  FormLabel,
  HStack,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Select,
  SelectContent,
  SelectIcon,
  SelectListbox,
  SelectOption,
  SelectOptionIndicator,
  SelectOptionText,
  SelectPlaceholder,
  SelectTrigger,
  SelectValue,
  Switch as HopeSwitch,
  Table,
  Tbody,
  Td,
  Text,
  Textarea,
  Th,
  Thead,
  Tr,
  VStack,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerHeader,
  DrawerOverlay,
} from "@hope-ui/solid"
import {
  For,
  Index,
  Match,
  Show,
  Switch as SolidSwitch,
  createSignal,
} from "solid-js"
import { createStore } from "solid-js/store"
import { FolderChooseInput, Paginator } from "~/components"
import { DeletePopover } from "../common/DeletePopover"
import { useFetch, useManageTitle, useT } from "~/hooks"
import {
  PlannedTask,
  PlannedTaskAction,
  PlannedTaskRecord,
} from "~/types"
import {
  handleResp,
  notify,
  plannedTaskActions,
  plannedTaskCreate,
  plannedTaskDelete,
  plannedTaskList,
  plannedTaskRecords,
  plannedTaskRun,
  plannedTaskSetEnabled,
  plannedTaskUpdate,
} from "~/utils"

// Editable templates. Path fields are intentionally empty: they are filled in
// with the folder picker in the visual editor below.
const actionExamples: Record<string, string> = {
  webhook: JSON.stringify(
    { url: "", method: "GET", body: "", headers: {} },
    null,
    2,
  ),
  traverse: JSON.stringify({ path: "", depth: 0 }, null, 2),
  backup: JSON.stringify(
    {
      source: "",
      target: "",
      mode: "copy",
      rules: {
        completion: { action: "none" },
        deletion: { action: "keep" },
        replacement: { action: "skip" },
        filters: { include: [], exclude: [] },
      },
    },
    null,
    2,
  ),
}

// Visual editor description: which top-level JSON keys get a real widget
// instead of being typed by hand.
type ParamFieldType = "folder" | "text" | "number" | "select"
interface ParamField {
  key: string
  type: ParamFieldType
  labelKey: string
  options?: string[]
}
// One include/exclude filter row, mirroring internal/planned.FilterItem.
interface FilterItem {
  type: string
  op: string
  value: string
  size_op: string
  size_max: string
}

const paramFields = (action: string): ParamField[] => {
  switch (action) {
    case "backup":
      return [
        { key: "source", type: "folder", labelKey: "source" },
        { key: "target", type: "folder", labelKey: "target" },
        {
          key: "mode",
          type: "select",
          labelKey: "mode",
          options: ["copy", "mirror"],
        },
      ]
    case "webhook":
      return [
        { key: "url", type: "text", labelKey: "url" },
        {
          key: "method",
          type: "select",
          labelKey: "method",
          options: ["GET", "POST", "PUT", "DELETE"],
        },
      ]
    case "traverse":
      return [
        { key: "path", type: "folder", labelKey: "path" },
        { key: "depth", type: "number", labelKey: "depth" },
      ]
    default:
      return []
  }
}

// Backup rule groups. options[0] is the backend default for each group.
const ruleGroups: { group: string; options: string[] }[] = [
  { group: "completion", options: ["none", "delete_source"] },
  { group: "replacement", options: ["skip", "overwrite"] },
  { group: "deletion", options: ["keep", "delete"] },
]
const filterTypes = ["extension", "filename", "regex", "size"]
const filterSizeOps = ["exact", "min", "max", "between"]

// true when params is empty or still an untouched template
const isUntouchedTemplate = (params: string) => {
  const cur = (params ?? "").trim()
  return !cur || Object.values(actionExamples).includes(cur)
}

const emptyTask = (): PlannedTask => ({
  id: 0,
  name: "",
  remark: "",
  enabled: true,
  schedule_type: "cron",
  cron_expr: "0 0 3 * * *",
  interval_sec: 3600,
  timezone: "",
  action: "backup",
  params: "",
  last_run_at: null,
  last_result: "",
  last_error: "",
  next_run_at: null,
  run_count: 0,
  fail_count: 0,
  creator_id: 0,
  created_at: "",
  updated_at: "",
})

const fmtTime = (v: string | null): string =>
  v ? new Date(v).toLocaleString() : "-"

const scheduleText = (task: PlannedTask): string => {
  if (task.schedule_type === "interval") {
    return `@every ${task.interval_sec}s`
  }
  if (task.timezone) {
    return `${task.cron_expr} (${task.timezone})`
  }
  return task.cron_expr
}

const resultColor = (result: string): string => {
  switch (result) {
    case "success":
      return "$success9"
    case "failed":
      return "$danger9"
    case "running":
      return "$info9"
    case "skipped":
      return "$warning9"
    default:
      return "$neutral11"
  }
}

const PlannedTaskPage = () => {
  const t = useT()
  useManageTitle("manage.sidemenu.planned_task")
  const pageSize = 20

  const [tasks, setTasks] = createSignal<PlannedTask[]>([])
  const [total, setTotal] = createSignal(0)
  const [page, setPage] = createSignal(1)
  const [loading, listTasks] = useFetch((p = 1) => plannedTaskList(p, pageSize))

  const refresh = async (p = page()) => {
    const resp = await listTasks(p)
    handleResp(resp, (data) => {
      setTasks(data.content)
      setTotal(data.total)
    })
  }
  refresh()

  // actions for the form dropdown
  const [actions, setActions] = createSignal<PlannedTaskAction[]>([])
  const [, loadActions] = useFetch(async () => {
    const resp = await plannedTaskActions()
    handleResp(resp, (data) => setActions(data))
  })
  loadActions()

  // create/edit modal
  const [modalOpen, setModalOpen] = createSignal(false)
  const [editingId, setEditingId] = createSignal<number | null>(null)
  const [form, setForm] = createStore<PlannedTask>(emptyTask())
  const [saveLoading, save] = useFetch(() =>
    editingId() ? plannedTaskUpdate(form) : plannedTaskCreate(form),
  )

  // localized parameter reference for the currently selected action;
  // empty for actions that have no documented parameters
  const actionParamHelp = () => {
    const v = t(
      `planned_task.actions.${form.action}.params`,
      undefined,
      "__none__",
    )
    return v === "__none__" ? "" : v
  }
  const fillExample = () => {
    setForm("params", actionExamples[form.action] ?? "{}")
  }

  // --- visual parameter editor -------------------------------------------
  const readParams = (): Record<string, any> => {
    try {
      const o = JSON.parse(form.params || "{}")
      return o && typeof o === "object" ? o : {}
    } catch {
      return {}
    }
  }
  const getParam = (key: string): string => {
    const v = readParams()[key]
    return v === undefined || v === null ? "" : String(v)
  }
  const setParam = (key: string, value: string | number) => {
    const o = readParams()
    o[key] = value
    setForm("params", JSON.stringify(o, null, 2))
  }
  const fields = () => paramFields(form.action)

  // --- backup rules (completion / deletion / replacement / filters) ------
  const readRules = (): Record<string, any> => {
    const r = readParams().rules
    return r && typeof r === "object" ? r : {}
  }
  const writeRules = (rules: Record<string, any>) => {
    const p = readParams()
    p.rules = rules
    setForm("params", JSON.stringify(p, null, 2))
  }
  const getRuleAction = (group: string, fallback: string): string => {
    const g = readRules()[group]
    const v = g && typeof g === "object" ? g.action : ""
    return v || fallback
  }
  const setRuleAction = (group: string, value: string) => {
    const rules = readRules()
    const old = rules[group]
    rules[group] = {
      ...(old && typeof old === "object" ? old : {}),
      action: value,
    }
    writeRules(rules)
  }
  const getFilters = (kind: "include" | "exclude"): FilterItem[] => {
    const f = readRules().filters
    const arr = f && typeof f === "object" ? f[kind] : undefined
    return Array.isArray(arr) ? arr : []
  }
  const setFilters = (kind: "include" | "exclude", items: FilterItem[]) => {
    const rules = readRules()
    const filters = rules.filters
    const next = filters && typeof filters === "object" ? filters : {}
    next[kind] = items
    rules.filters = next
    writeRules(rules)
  }
  const addFilter = (kind: "include" | "exclude") =>
    setFilters(kind, [
      ...getFilters(kind),
      { type: "extension", op: kind, value: "", size_op: "", size_max: "" },
    ])
  const updateFilter = (
    kind: "include" | "exclude",
    index: number,
    patch: Partial<FilterItem>,
  ) =>
    setFilters(
      kind,
      getFilters(kind).map((it, i) => (i === index ? { ...it, ...patch } : it)),
    )
  const removeFilter = (kind: "include" | "exclude", index: number) =>
    setFilters(
      kind,
      getFilters(kind).filter((_, i) => i !== index),
    )

  const openCreate = () => {
    setEditingId(null)
    setForm(emptyTask())
    setForm("params", actionExamples["backup"] ?? "{}")
    setModalOpen(true)
  }
  const openEdit = (task: PlannedTask) => {
    setEditingId(task.id)
    setForm(task)
    setModalOpen(true)
  }

  const submitForm = async () => {
    if (!form.name.trim()) {
      notify.warning(t("global.empty_input"))
      return
    }
    try {
      JSON.parse(form.params || "{}")
    } catch {
      notify.warning(t("planned_task.params_invalid"))
      return
    }
    const resp = await save()
    handleResp(resp, () => {
      notify.success(t("global.save_success"))
      setModalOpen(false)
      refresh()
    })
  }

  // run / delete
  const [runLoading, run] = useFetch(
    (id: number, dry = false, confirm = false) =>
      plannedTaskRun(id, dry, confirm),
  )
  const runTask = async (id: number, dry = false, confirm = false) => {
    const resp = await run(id, dry, confirm)
    handleResp(resp, () => {
      notify.success(dry ? t("planned_task.run_dry") : t("planned_task.run"))
      refresh()
    })
  }

  // dangerous (destructive) run confirmation
  const [confirmOpen, setConfirmOpen] = createSignal(false)
  const [confirmTask, setConfirmTask] = createSignal<PlannedTask | null>(null)
  const isDangerous = (task: { action: string; params: string }): boolean => {
    if (task.action !== "backup") return false
    try {
      const p = JSON.parse(task.params || "{}")
      if (p.mode === "mirror") return true
      if (p.rules?.completion?.action === "delete_source") return true
      if (p.rules?.deletion?.action === "delete") return true
    } catch {
      return false
    }
    return false
  }
  const onRun = (task: PlannedTask, dry = false) => {
    if (!dry && isDangerous(task)) {
      setConfirmTask(task)
      setConfirmOpen(true)
      return
    }
    runTask(task.id, dry)
  }

  const [toggleLoading, toggle] = useFetch((id: number, enabled: boolean) =>
    plannedTaskSetEnabled(id, enabled),
  )
  const toggleTask = async (task: PlannedTask, enabled: boolean) => {
    const resp = await toggle(task.id, enabled)
    handleResp(resp, () => refresh())
  }

  const [deleteLoading, del] = useFetch((id: number) => plannedTaskDelete(id))
  const deleteTask = async (id: number) => {
    const resp = await del(id)
    handleResp(resp, () => {
      notify.success(t("global.save_success"))
      refresh()
    })
  }

  // history drawer
  const [historyOpen, setHistoryOpen] = createSignal(false)
  const [historyTask, setHistoryTask] = createSignal<PlannedTask | null>(null)
  const [records, setRecords] = createSignal<PlannedTaskRecord[]>([])
  const [historyLoading, loadRecords] = useFetch((id: number) =>
    plannedTaskRecords(id, 1, 50),
  )
  const openHistory = async (task: PlannedTask) => {
    setHistoryTask(task)
    setRecords([])
    setHistoryOpen(true)
    const resp = await loadRecords(task.id)
    handleResp(resp, (data) => setRecords(data.content))
  }

  return (
    <VStack spacing="$3" alignItems="start" w="$full">
      <HStack spacing="$2" gap="$2" w="$full">
        <Button colorScheme="accent" loading={loading()} onClick={() => refresh()}>
          {t("global.refresh")}
        </Button>
        <Button colorScheme="primary" onClick={openCreate}>
          {t("global.add")}
        </Button>
      </HStack>

      <VStack
        w="$full"
        overflowX="auto"
        shadow="$md"
        rounded="$lg"
        spacing="$1"
        p="$1"
      >
        <Table highlightOnHover dense>
          <Thead>
            <Tr>
              <For each={["name", "enabled", "schedule", "last_run", "next_run", "last_result"]}>
                {(k) => <Th>{t(`planned_task.${k}`)}</Th>}
              </For>
              <Th>{t("global.operations")}</Th>
            </Tr>
          </Thead>
          <Tbody>
            <For each={tasks()}>
              {(task) => (
                <Tr>
                  <Td>
                    <Text fontWeight="bold">{task.name}</Text>
                    <Text fontSize="$xs" color="$neutral11">
                      {t(
                        `planned_task.actions.${task.action}.name`,
                        undefined,
                        task.action,
                      )}
                    </Text>
                    <Show when={task.remark}>
                      <Text fontSize="$xs" color="$neutral11">
                        {task.remark}
                      </Text>
                    </Show>
                  </Td>
                  <Td>
                    <HopeSwitch
                      checked={task.enabled}
                      onChange={(e: { currentTarget: HTMLInputElement }) =>
                        toggleTask(task, e.currentTarget.checked)
                      }
                    />
                  </Td>
                  <Td>
                    <Text fontSize="$sm">{scheduleText(task)}</Text>
                  </Td>
                  <Td>
                    <Text fontSize="$sm">{fmtTime(task.last_run_at)}</Text>
                  </Td>
                  <Td>
                    <Text fontSize="$sm">{fmtTime(task.next_run_at)}</Text>
                  </Td>
                  <Td>
                    <Text
                      fontWeight="bold"
                      fontSize="$sm"
                      color={resultColor(task.last_result)}
                    >
                      {task.last_result
                        ? t(`planned_task.result.${task.last_result}`)
                        : t("planned_task.result.none")}
                    </Text>
                  </Td>
                  <Td>
                    <HStack spacing="$1">
                      <Button
                        size="xs"
                        colorScheme="accent"
                        loading={runLoading()}
                        onClick={() => onRun(task, false)}
                      >
                        {t("planned_task.run")}
                      </Button>
                      <Button
                        size="xs"
                        colorScheme="neutral"
                        onClick={() => onRun(task, true)}
                      >
                        {t("planned_task.run_dry")}
                      </Button>
                      <Button size="xs" onClick={() => openEdit(task)}>
                        {t("global.edit")}
                      </Button>
                      <Button size="xs" onClick={() => openHistory(task)}>
                        {t("planned_task.history")}
                      </Button>
                      <DeletePopover
                        name={task.name}
                        loading={deleteLoading()}
                        onClick={() => deleteTask(task.id)}
                      />
                    </HStack>
                  </Td>
                </Tr>
              )}
            </For>
          </Tbody>
        </Table>
      </VStack>

      <Paginator
        total={total()}
        defaultPageSize={pageSize}
        onChange={(p) => {
          setPage(p)
          refresh(p)
        }}
      />

      {/* create/edit modal */}
      <Modal
        blockScrollOnMount={false}
        opened={modalOpen()}
        onClose={() => setModalOpen(false)}
        size="lg"
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>
            {t(`global.${editingId() ? "edit" : "add"}`)} -{" "}
            {t("manage.sidemenu.planned_task")}
          </ModalHeader>
          <ModalBody>
            <VStack spacing="$3">
              <FormControl required>
                <FormLabel for="pt-name">{t("planned_task.name")}</FormLabel>
                <Input
                  id="pt-name"
                  value={form.name}
                  onInput={(e) => setForm("name", e.currentTarget.value)}
                />
              </FormControl>

              <FormControl>
                <FormLabel for="pt-remark">{t("planned_task.remark")}</FormLabel>
                <Input
                  id="pt-remark"
                  value={form.remark}
                  onInput={(e) => setForm("remark", e.currentTarget.value)}
                />
              </FormControl>

              <FormControl>
                <FormLabel>{t("planned_task.schedule_type")}</FormLabel>
                <Select
                  value={form.schedule_type}
                  onChange={(v) => setForm("schedule_type", v as string)}
                >
                  <SelectTrigger>
                    <SelectPlaceholder>{t("global.choose")}</SelectPlaceholder>
                    <SelectValue />
                    <SelectIcon />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectListbox>
                      <For each={["cron", "interval"]}>
                        {(v) => (
                          <SelectOption value={v}>
                            <SelectOptionText>
                              {t(`planned_task.schedule_type_${v}`)}
                            </SelectOptionText>
                            <SelectOptionIndicator />
                          </SelectOption>
                        )}
                      </For>
                    </SelectListbox>
                  </SelectContent>
                </Select>
              </FormControl>

              <Show when={form.schedule_type === "cron"}>
                <FormControl>
                  <FormLabel for="pt-cron">{t("planned_task.cron_expr")}</FormLabel>
                  <Input
                    id="pt-cron"
                    value={form.cron_expr}
                    placeholder="0 0 3 * * *"
                    onInput={(e) => setForm("cron_expr", e.currentTarget.value)}
                  />
                  <FormHelperText>
                    {t("planned_task.cron_expr")}: sec min hour day month week
                  </FormHelperText>
                </FormControl>
              </Show>

              <Show when={form.schedule_type === "interval"}>
                <FormControl>
                  <FormLabel for="pt-interval">
                    {t("planned_task.interval_sec")}
                  </FormLabel>
                  <Input
                    id="pt-interval"
                    type="number"
                    value={form.interval_sec}
                    onInput={(e) =>
                      setForm("interval_sec", parseInt(e.currentTarget.value) || 0)
                    }
                  />
                </FormControl>
              </Show>

              <FormControl>
                <FormLabel for="pt-tz">{t("planned_task.timezone")}</FormLabel>
                <Input
                  id="pt-tz"
                  value={form.timezone}
                  placeholder="Asia/Shanghai"
                  onInput={(e) => setForm("timezone", e.currentTarget.value)}
                />
              </FormControl>

              <FormControl>
                <FormLabel>{t("planned_task.action")}</FormLabel>
                <Select
                  value={form.action}
                  onChange={(v) => {
                    const action = v as string
                    setForm("action", action)
                    // only overwrite params while it is empty or still a
                    // pristine template, so user edits are never lost
                    if (isUntouchedTemplate(form.params)) {
                      setForm("params", actionExamples[action] ?? "{}")
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectPlaceholder>{t("global.choose")}</SelectPlaceholder>
                    <SelectValue />
                    <SelectIcon />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectListbox>
                      <For each={actions()}>
                        {(a) => (
                          <SelectOption value={a.name}>
                            <SelectOptionText>
                              {t(
                                `planned_task.actions.${a.name}.name`,
                                undefined,
                                a.name,
                              )}
                            </SelectOptionText>
                            <SelectOptionIndicator />
                          </SelectOption>
                        )}
                      </For>
                    </SelectListbox>
                  </SelectContent>
                </Select>
                <FormHelperText css={{ whiteSpace: "pre-line" }}>
                  {t(
                    `planned_task.actions.${form.action}.desc`,
                    undefined,
                    actions().find((a) => a.name === form.action)?.description ??
                      "",
                  )}
                </FormHelperText>
              </FormControl>

              {/* visual parameter editor: folder picker / dropdowns instead
                  of hand-writing JSON */}
              <Show when={fields().length > 0}>
                <VStack w="$full" spacing="$2" alignItems="stretch">
                  <Text fontWeight="bold" fontSize="$sm">
                    {t("planned_task.params_visual")}
                  </Text>
                  <Text
                    fontSize="$xs"
                    color="$neutral11"
                    css={{ whiteSpace: "pre-line" }}
                  >
                    {t("planned_task.params_visual_tip")}
                  </Text>
                  <Show when={form.action === "webhook"}>
                    <Text
                      fontSize="$xs"
                      color="$neutral11"
                      css={{ whiteSpace: "pre-line" }}
                    >
                      {t("planned_task.webhook_tip")}
                    </Text>
                  </Show>
                  <For each={fields()}>
                    {(f) => (
                      <FormControl w="$full">
                        <FormLabel>
                          {t(`planned_task.field.${f.labelKey}`)}
                        </FormLabel>
                        <SolidSwitch>
                          <Match when={f.type === "folder"}>
                            <FolderChooseInput
                              value={getParam(f.key)}
                              onChange={(path) => setParam(f.key, path)}
                              onlyFolder
                            />
                          </Match>
                          <Match when={f.type === "select"}>
                            <Select
                              value={getParam(f.key)}
                              onChange={(v) => setParam(f.key, v as string)}
                            >
                              <SelectTrigger>
                                <SelectPlaceholder>
                                  {t("global.choose")}
                                </SelectPlaceholder>
                                <SelectValue />
                                <SelectIcon />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectListbox>
                                  <For each={f.options ?? []}>
                                    {(o) => (
                                      <SelectOption value={o}>
                                        <SelectOptionText>
                                          {t(
                                            `planned_task.opt.${o}`,
                                            undefined,
                                            o,
                                          )}
                                        </SelectOptionText>
                                        <SelectOptionIndicator />
                                      </SelectOption>
                                    )}
                                  </For>
                                </SelectListbox>
                              </SelectContent>
                            </Select>
                          </Match>
                          <Match when={f.type === "number"}>
                            <Input
                              type="number"
                              value={getParam(f.key)}
                              onInput={(e) =>
                                setParam(
                                  f.key,
                                  parseInt(e.currentTarget.value) || 0,
                                )
                              }
                            />
                          </Match>
                          <Match when={f.type === "text"}>
                            <Input
                              value={getParam(f.key)}
                              placeholder="https://example.com/hook"
                              onInput={(e) =>
                                setParam(f.key, e.currentTarget.value)
                              }
                            />
                          </Match>
                        </SolidSwitch>
                      </FormControl>
                    )}
                  </For>

                  {/* backup rules: completion / replacement / deletion +
                      include & exclude filters */}
                  <Show when={form.action === "backup"}>
                    <VStack
                      w="$full"
                      spacing="$3"
                      alignItems="stretch"
                      mt="$2"
                    >
                      <Text fontWeight="bold" fontSize="$sm">
                        {t("planned_task.rules_title")}
                      </Text>
                      <For each={ruleGroups}>
                        {(g) => (
                          <FormControl w="$full">
                            <FormLabel>
                              {t(`planned_task.rule.${g.group}.title`)}
                            </FormLabel>
                            <Select
                              value={getRuleAction(g.group, g.options[0])}
                              onChange={(v) =>
                                setRuleAction(g.group, v as string)
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                                <SelectIcon />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectListbox>
                                  <For each={g.options}>
                                    {(o) => (
                                      <SelectOption value={o}>
                                        <SelectOptionText>
                                          {t(
                                            `planned_task.rule.${g.group}.${o}`,
                                          )}
                                        </SelectOptionText>
                                        <SelectOptionIndicator />
                                      </SelectOption>
                                    )}
                                  </For>
                                </SelectListbox>
                              </SelectContent>
                            </Select>
                            <FormHelperText>
                              {t(`planned_task.rule.${g.group}.tip`)}
                            </FormHelperText>
                          </FormControl>
                        )}
                      </For>

                      <FormControl w="$full">
                        <FormLabel>
                          {t("planned_task.filters.title")}
                        </FormLabel>
                        <FormHelperText css={{ whiteSpace: "pre-line" }}>
                          {t("planned_task.filters.tip")}
                        </FormHelperText>
                        <For each={["include", "exclude"] as const}>
                          {(kind) => (
                            <VStack
                              w="$full"
                              spacing="$1"
                              alignItems="stretch"
                              mt="$2"
                            >
                              <HStack
                                justifyContent="space-between"
                                alignItems="center"
                                spacing="$2"
                              >
                                <Text fontSize="$sm" fontWeight="bold">
                                  {t(`planned_task.filters.${kind}`)}
                                </Text>
                                <Button
                                  size="xs"
                                  variant="outline"
                                  onClick={() => addFilter(kind)}
                                >
                                  {t("planned_task.filters.add")}
                                </Button>
                              </HStack>
                              <Show
                                when={getFilters(kind).length > 0}
                                fallback={
                                  <Text fontSize="$xs" color="$neutral11">
                                    {t("planned_task.filters.empty")}
                                  </Text>
                                }
                              >
                                <Index each={getFilters(kind)}>
                                  {(item, i) => (
                                    <HStack
                                      w="$full"
                                      spacing="$1"
                                      alignItems="center"
                                      flexWrap="wrap"
                                    >
                                      <Box w="120px">
                                        <Select
                                          value={item().type}
                                          onChange={(v) =>
                                            updateFilter(kind, i, {
                                              type: v as string,
                                            })
                                          }
                                        >
                                          <SelectTrigger>
                                            <SelectValue />
                                            <SelectIcon />
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectListbox>
                                              <For each={filterTypes}>
                                                {(ft) => (
                                                  <SelectOption value={ft}>
                                                    <SelectOptionText>
                                                      {t(
                                                        `planned_task.filter_type.${ft}`,
                                                      )}
                                                    </SelectOptionText>
                                                    <SelectOptionIndicator />
                                                  </SelectOption>
                                                )}
                                              </For>
                                            </SelectListbox>
                                          </SelectContent>
                                        </Select>
                                      </Box>
                                      <Input
                                        flex="1"
                                        minW="110px"
                                        value={item().value}
                                        placeholder={t(
                                          `planned_task.filter_ph.${item().type}`,
                                        )}
                                        onInput={(e) =>
                                          updateFilter(kind, i, {
                                            value: e.currentTarget.value,
                                          })
                                        }
                                      />
                                      <Show when={item().type === "size"}>
                                        <Box w="100px">
                                          <Select
                                            value={item().size_op || "exact"}
                                            onChange={(v) =>
                                              updateFilter(kind, i, {
                                                size_op:
                                                  v === "exact"
                                                    ? ""
                                                    : (v as string),
                                              })
                                            }
                                          >
                                            <SelectTrigger>
                                              <SelectValue />
                                              <SelectIcon />
                                            </SelectTrigger>
                                            <SelectContent>
                                              <SelectListbox>
                                                <For each={filterSizeOps}>
                                                  {(so) => (
                                                    <SelectOption value={so}>
                                                      <SelectOptionText>
                                                        {t(
                                                          `planned_task.filter_size_op.${so}`,
                                                        )}
                                                      </SelectOptionText>
                                                      <SelectOptionIndicator />
                                                    </SelectOption>
                                                  )}
                                                </For>
                                              </SelectListbox>
                                            </SelectContent>
                                          </Select>
                                        </Box>
                                        <Show
                                          when={item().size_op === "between"}
                                        >
                                          <Input
                                            w="90px"
                                            value={item().size_max}
                                            placeholder={t(
                                              "planned_task.filters.size_max",
                                            )}
                                            onInput={(e) =>
                                              updateFilter(kind, i, {
                                                size_max:
                                                  e.currentTarget.value,
                                              })
                                            }
                                          />
                                        </Show>
                                      </Show>
                                      <Button
                                        size="xs"
                                        colorScheme="danger"
                                        onClick={() => removeFilter(kind, i)}
                                      >
                                        {t("global.delete")}
                                      </Button>
                                    </HStack>
                                  )}
                                </Index>
                              </Show>
                            </VStack>
                          )}
                        </For>
                      </FormControl>
                    </VStack>
                  </Show>
                </VStack>
              </Show>

              <FormControl>
                <HStack
                  justifyContent="space-between"
                  alignItems="center"
                  spacing="$2"
                >
                  <FormLabel for="pt-params">{t("planned_task.params")}</FormLabel>
                  <Button size="xs" variant="outline" onClick={fillExample}>
                    {t("planned_task.params_fill")}
                  </Button>
                </HStack>
                <Textarea
                  id="pt-params"
                  value={form.params}
                  rows={8}
                  onInput={(e) => setForm("params", e.currentTarget.value)}
                />
                <FormHelperText>{t("planned_task.params_tip")}</FormHelperText>
                <Show when={actionParamHelp()}>
                  <VStack spacing="$1" alignItems="stretch" mt="$2">
                    <Text fontWeight="bold" fontSize="$xs">
                      {t("planned_task.params_help")}
                    </Text>
                    <Text
                      fontSize="$xs"
                      color="$neutral11"
                      css={{ whiteSpace: "pre-line" }}
                    >
                      {actionParamHelp()}
                    </Text>
                    <Show when={form.action === "backup"}>
                      <Text
                        fontSize="$xs"
                        color="$neutral11"
                        css={{ whiteSpace: "pre-line" }}
                      >
                        {t("planned_task.filters_tip")}
                      </Text>
                    </Show>
                  </VStack>
                </Show>
                <Show when={isDangerous(form)}>
                  <Text fontSize="$xs" color="$danger9" mt="$2">
                    {t("planned_task.dangerous_tip")}
                  </Text>
                </Show>
              </FormControl>

              <FormControl>
                <FormLabel>{t("planned_task.enabled")}</FormLabel>
                <HopeSwitch
                  checked={form.enabled}
                  onChange={(e: { currentTarget: HTMLInputElement }) =>
                    setForm("enabled", e.currentTarget.checked)
                  }
                />
              </FormControl>
            </VStack>
          </ModalBody>
          <ModalFooter display="flex" gap="$2">
            <Button colorScheme="neutral" onClick={() => setModalOpen(false)}>
              {t("global.cancel")}
            </Button>
            <Button colorScheme="accent" loading={saveLoading()} onClick={submitForm}>
              {t("global.save")}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* history drawer */}
      <Drawer
        opened={historyOpen()}
        placement="right"
        onClose={() => setHistoryOpen(false)}
        size="lg"
      >
        <DrawerOverlay />
        <DrawerContent>
          <DrawerCloseButton />
          <DrawerHeader>
            {t("planned_task.history")} - {historyTask()?.name ?? ""}
          </DrawerHeader>
          <DrawerBody>
            <Show
              when={records().length > 0}
              fallback={
                <Text color="$neutral11">{t("planned_task.record.empty")}</Text>
              }
            >
              <Table highlightOnHover dense>
                <Thead>
                  <Tr>
                    <For each={["start_time", "duration", "result"]}>
                      {(k) => <Th>{t(`planned_task.record.${k}`)}</Th>}
                    </For>
                    <Th>{t("planned_task.record.log")}</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  <For each={records()}>
                    {(r) => (
                      <Tr>
                        <Td>
                          <Text fontSize="$sm">{fmtTime(r.start_time)}</Text>
                        </Td>
                        <Td>
                          <Text fontSize="$sm">{r.duration_ms}ms</Text>
                        </Td>
                        <Td>
                          <Text
                            fontWeight="bold"
                            fontSize="$sm"
                            color={r.success ? "$success9" : "$danger9"}
                          >
                            {r.skipped
                              ? t("planned_task.result.skipped")
                              : r.success
                                ? t("planned_task.result.success")
                                : t("planned_task.result.failed")}
                          </Text>
                        </Td>
                        <Td>
                          <Text fontSize="$xs" css={{ whiteSpace: "pre-wrap" }}>
                            {r.log}
                          </Text>
                        </Td>
                      </Tr>
                    )}
                  </For>
                </Tbody>
              </Table>
            </Show>
          </DrawerBody>
        </DrawerContent>
      </Drawer>

      {/* dangerous run confirmation */}
      <Modal
        blockScrollOnMount={false}
        opened={confirmOpen()}
        onClose={() => setConfirmOpen(false)}
        size="md"
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>{t("planned_task.dangerous_confirm_title")}</ModalHeader>
          <ModalBody>
            <Text>
              {t("planned_task.dangerous_confirm_desc", {
                name: confirmTask()?.name ?? "",
              })}
            </Text>
          </ModalBody>
          <ModalFooter display="flex" gap="$2">
            <Button colorScheme="neutral" onClick={() => setConfirmOpen(false)}>
              {t("global.cancel")}
            </Button>
            <Button
              colorScheme="danger"
              loading={runLoading()}
              onClick={() => {
                const task = confirmTask()
                if (task) {
                  setConfirmOpen(false)
                  runTask(task.id, false, true)
                }
              }}
            >
              {t("global.confirm")}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </VStack>
  )
}

export default PlannedTaskPage
