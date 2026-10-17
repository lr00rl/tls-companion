import type { Side } from "../data/types";

/**
 * Where a step starts in a capture's event log. Anchors are searched forward
 * from the previous step's start, so each one only needs to be unique from
 * there on. The validation test fails when an anchor stops resolving, which is
 * what happens when a Go release renames a function.
 */
export type Anchor =
  /** First entry into this function (index key) on that side. */
  | { enter: string; side?: Side }
  /** A marker the capture tool logged around the application calls. */
  | { mark: string; side: Side }
  /** The event at which the receiver finished reading this message. */
  | { readMsg: MsgSel }
  /** The event that put this message on the wire. */
  | { writeMsg: MsgSel };

/** Selects a handshake message: direction, type, and occurrence (from 0). */
export interface MsgSel {
  dir: Side;
  type: number;
  nth?: number;
}

/** Code to show: a function by index key, optionally a line inside it. */
export interface CodeFocus {
  fn: string;
  /** A substring of the line to highlight, searched within the function. */
  find?: string;
}

export type InspectorTab = "fields" | "record" | "keys" | "certs" | "conn";

export type StepRef =
  | { rfc: number; sec?: string }
  | { note: string; h?: string; label?: string }
  | { sym: string; label?: string };

export interface StepDef {
  id: string;
  title: string;
  side: Side | "wire";
  at: Anchor;
  code?: CodeFocus;
  msg?: MsgSel;
  tab?: InspectorTab;
  /**
   * Narrative. Paragraphs are separated by blank lines; `code`, **bold**, and
   * [label](sym:key | rfc:8446#4.1.2 | note:T06#anchor | step:id) are supported.
   */
  body: string;
  refs?: StepRef[];
}

export interface ScenarioDef {
  id: string;
  /** One paragraph shown above the steps. */
  intro: string;
  /** Whether a TCP handshake is drawn before the first record. */
  tcp: boolean;
  steps: StepDef[];
}
