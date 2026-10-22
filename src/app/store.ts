import { create } from "zustand";
import { buildModel, type Call, type Model } from "../capture/model";
import { EV_ENTER, type Side } from "../data/types";
import { load, type SymbolIndex } from "../data/load";
import { scenarioFor } from "../i18n/content";
import { getLang, subscribeLang, tx, type Bi } from "../i18n/lang";
import { resolveSteps, stepAt, type Step } from "../scenarios/resolve";
import type { InspectorTab } from "../scenarios/types";
import { navigate } from "./route";

/** What the code panel shows. */
export interface CodeTarget {
  file: string;
  /** Line to put the caret on. */
  line?: number;
  /** Lines to tint, usually the enclosing function. */
  range?: [number, number];
  /** Resolve the caret line by searching for this text inside `range`. */
  find?: string;
  /** Why the panel is here, shown in its header. */
  reason?: Bi;
}

export type Selection = { kind: "msg"; index: number; field?: string[] } | { kind: "rec"; index: number } | null;

export type MobilePane = "steps" | "inspect" | "code" | "trace";

interface WorkbenchState {
  symbols: SymbolIndex | null;
  scenario: string | null;
  model: Model | null;
  steps: Step[];
  errors: string[];
  loading: boolean;
  loadError: string | null;
  step: number;
  cursor: number;
  playing: boolean;
  speed: number;
  rttMs: number;
  sel: Selection;
  hover: [number, number] | null;
  tab: InspectorTab;
  keySide: Side;
  code: CodeTarget | null;
  codeBack: CodeTarget[];
  codeFwd: CodeTarget[];
  traceSel: number | null;
  pane: MobilePane;
  /** True while the scrubber is being dragged; the stage then tracks 1:1. */
  scrubbing: boolean;

  ensureSymbols(): Promise<SymbolIndex>;
  open(scenario: string, step?: number): Promise<void>;
  goStep(i: number, opts?: { keepUrl?: boolean }): void;
  setCursor(ev: number, opts?: { follow?: boolean }): void;
  selectMessage(index: number): void;
  selectRecord(index: number): void;
  selectField(path: string[] | undefined, go?: string, range?: [number, number]): void;
  setHover(r: [number, number] | null): void;
  setTab(t: InspectorTab): void;
  setKeySide(s: Side): void;
  openCode(t: CodeTarget, opts?: { push?: boolean }): void;
  openSymbol(key: string, opts?: { push?: boolean; reason?: Bi; find?: string }): Promise<void>;
  codeGoBack(): void;
  codeGoForward(): void;
  selectCall(id: number): void;
  setPlaying(p: boolean): void;
  setSpeed(s: number): void;
  setRtt(ms: number): void;
  setPane(p: MobilePane): void;
  setScrubbing(b: boolean): void;
}

function symTarget(ix: SymbolIndex, key: string, find?: string, reason?: Bi): CodeTarget | null {
  const s = ix.byKey.get(key);
  if (!s || s.x) return null;
  return { file: s.f, line: s.l, range: [s.l, s.e ?? s.l], find, reason };
}

function stepReason(scenario: string, stepId: string): Bi {
  const en = scenarioFor("en", scenario)?.steps.find((step) => step.id === stepId)?.title ?? stepId;
  const zh = scenarioFor("zh", scenario)?.steps.find((step) => step.id === stepId)?.title ?? stepId;
  return [en, zh];
}

/** What a step selects in the inspector, whether reached by stepping or scrubbing. */
function stepSelection(s: Step, tab: InspectorTab): Pick<WorkbenchState, "sel" | "tab" | "keySide" | "hover"> {
  return {
    sel: s.msgIndex >= 0 ? { kind: "msg", index: s.msgIndex } : s.recIndex >= 0 ? { kind: "rec", index: s.recIndex } : null,
    tab: s.tab ?? (s.msgIndex >= 0 ? "fields" : tab),
    keySide: s.side === 1 ? 1 : 0,
    hover: null,
  };
}

let scrubStartStep = -1;

/** The line executing at an event: the call site of the latest call entered. */
export function executingAt(model: Model, ev: number): Call | null {
  for (let i = Math.min(ev, model.last); i >= 0; i--) {
    if (model.cap.events[i][0] === EV_ENTER) return model.calls[model.callAt[i]] ?? null;
  }
  return null;
}

export const useWB = create<WorkbenchState>((set, get) => ({
  symbols: null,
  scenario: null,
  model: null,
  steps: [],
  errors: [],
  loading: false,
  loadError: null,
  step: 0,
  cursor: 0,
  playing: false,
  speed: 1,
  rttMs: 80,
  sel: null,
  hover: null,
  tab: "fields",
  keySide: 0,
  code: null,
  codeBack: [],
  codeFwd: [],
  traceSel: null,
  pane: "steps",
  scrubbing: false,

  async ensureSymbols() {
    const have = get().symbols;
    if (have) return have;
    const ix = await load.symbols();
    set({ symbols: ix });
    return ix;
  },

  async open(scenario, step) {
    const def = scenarioFor(getLang(), scenario);
    if (!def) {
      set({ loadError: tx(`No scenario named ${scenario}`, `没有名为 ${scenario} 的场景`) });
      return;
    }
    // model is cleared whenever a load starts, so a non-null model always
    // belongs to the scenario field and a failed load is retried, not skipped.
    if (get().scenario === scenario && get().model) {
      if (step === undefined) return;
      const at = Math.min(step, get().steps.length - 1);
      if (at !== get().step || at !== step) get().goStep(at, { keepUrl: at === step });
      return;
    }
    set({ loading: true, loadError: null, scenario, model: null, steps: [], errors: [], step: 0, cursor: 0, playing: false });
    try {
      const [cap] = await Promise.all([load.capture(scenario), get().ensureSymbols()]);
      if (get().scenario !== scenario) return;
      const model = buildModel(cap);
      // The reader may switch languages while the capture and symbol index are
      // loading. Resolve against the edition active when the data is ready.
      const activeDef = scenarioFor(getLang(), scenario) ?? def;
      const { steps, errors } = resolveSteps(model, activeDef);
      if (errors.length) console.warn("[tls-companion] unresolved steps", errors);
      set({ model, steps, errors, loading: false, sel: null, traceSel: null, codeBack: [], codeFwd: [] });
      const at = Math.min(step ?? 0, Math.max(0, steps.length - 1));
      get().goStep(at, { keepUrl: step === at });
    } catch (e) {
      if (get().scenario !== scenario) return;
      set({ loading: false, loadError: (e as Error).message });
    }
  },

  goStep(i, opts) {
    const { steps, symbols, scenario } = get();
    const s = steps[i];
    if (!s) return;
    const code = s.code && symbols ? symTarget(symbols, s.code.fn, s.code.find, scenario ? stepReason(scenario, s.id) : s.title) : get().code;
    set({ step: i, cursor: s.start, ...stepSelection(s, get().tab), code, traceSel: null });
    if (!opts?.keepUrl && scenario) navigate({ page: "play", scenario, step: i }, { replace: true });
  },

  setCursor(ev, opts) {
    const { model, steps, step, scenario } = get();
    if (!model) return;
    const cursor = Math.max(0, Math.min(model.last, Math.round(ev)));
    const si = stepAt(steps, cursor);
    const patch: Partial<WorkbenchState> = { cursor };
    if (si !== step) {
      patch.step = si;
      if (scenario) navigate({ page: "play", scenario, step: si }, { replace: true });
    }
    if (opts?.follow) {
      const c = executingAt(model, cursor);
      const symbols = get().symbols;
      // Calls made from bytes, io, bufio, or slices appear in the trace, but
      // only crypto/tls and its key dependencies are bundled. Show the nearest
      // caller whose call site is in a bundled file.
      let site = c;
      while (site && !(site.file && symbols?.indexed.has(site.file))) site = site.parent >= 0 ? model.calls[site.parent] : null;
      if (site?.file) {
        const parent = site.parent >= 0 ? model.calls[site.parent] : null;
        const ps = parent && symbols?.byKey.get(parent.fn);
        patch.code = {
          file: site.file,
          line: site.line,
          range: ps && ps.f === site.file ? [ps.l, ps.e ?? ps.l] : undefined,
          reason: [`Running: ${site.fn.split(".").slice(-2).join(".")}`, `正在执行：调用 ${site.fn.split(".").slice(-2).join(".")}`],
        };
      }
      patch.traceSel = c ? c.id : null;
    }
    set(patch);
  },

  selectMessage(index) {
    const { model } = get();
    if (!model) return;
    set({ sel: { kind: "msg", index }, tab: "fields", hover: null });
  },

  selectRecord(index) {
    const { model } = get();
    if (!model) return;
    const msgs = model.recordMessages[index];
    if (msgs.length === 1 && model.cap.records[index].inner === 22) {
      set({ sel: { kind: "msg", index: msgs[0] }, tab: get().tab === "record" ? "record" : "fields", hover: null });
    } else {
      set({ sel: { kind: "rec", index }, tab: "record", hover: null });
    }
  },

  selectField(path, go, range) {
    const sel = get().sel;
    if (sel?.kind === "msg") set({ sel: { ...sel, field: path }, hover: range ?? null });
    if (go) void get().openSymbol(go, { reason: [`Go field for ${path?.slice(-1)[0] ?? "this field"}`, `字段 ${path?.slice(-1)[0] ?? ""} 对应的 Go 字段`] });
  },

  setHover(hover) {
    set({ hover });
  },
  setTab(tab) {
    set({ tab });
  },
  setKeySide(keySide) {
    set({ keySide });
  },

  openCode(t, opts) {
    const cur = get().code;
    if (opts?.push && cur) set({ codeBack: [...get().codeBack.slice(-49), cur], codeFwd: [] });
    set({ code: t });
  },

  async openSymbol(key, opts) {
    const ix = await get().ensureSymbols();
    const t = symTarget(ix, key, opts?.find, opts?.reason);
    if (t) get().openCode(t, { push: opts?.push ?? true });
  },

  codeGoBack() {
    const back = get().codeBack;
    const cur = get().code;
    if (!back.length) return;
    set({ code: back[back.length - 1], codeBack: back.slice(0, -1), codeFwd: cur ? [cur, ...get().codeFwd] : get().codeFwd });
  },
  codeGoForward() {
    const fwd = get().codeFwd;
    const cur = get().code;
    if (!fwd.length) return;
    set({ code: fwd[0], codeFwd: fwd.slice(1), codeBack: cur ? [...get().codeBack, cur] : get().codeBack });
  },

  selectCall(id) {
    const { model, symbols } = get();
    if (!model) return;
    const c = model.calls[id];
    get().setCursor(c.enter);
    const t = symbols ? symTarget(symbols, c.fn, undefined, [`Call #${id}: ${c.fn.split("/").pop()}`, `调用 #${id}：${c.fn.split("/").pop()}`]) : null;
    set({ traceSel: id });
    if (t) get().openCode(t, { push: true });
  },

  setPlaying(playing) {
    set({ playing });
  },
  setSpeed(speed) {
    set({ speed });
  },
  setRtt(rttMs) {
    set({ rttMs });
  },
  setPane(pane) {
    set({ pane });
  },
  setScrubbing(scrubbing) {
    const { step, steps, tab } = get();
    if (scrubbing) scrubStartStep = step;
    // Landing on another step by scrubbing shows what stepping there would,
    // while a scrub inside one step keeps the reader's own selection.
    const landed = !scrubbing && step !== scrubStartStep && steps[step];
    set(landed ? { scrubbing, ...stepSelection(steps[step], tab) } : { scrubbing });
  },
}));

// Step titles and note anchors follow the language. The capture stays loaded.
subscribeLang(() => {
  const { scenario, model } = useWB.getState();
  if (!scenario || !model) return;
  const def = scenarioFor(getLang(), scenario);
  if (!def) return;
  const { steps, errors } = resolveSteps(model, def);
  useWB.setState({ steps, errors });
});
