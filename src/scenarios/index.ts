import { tls12Ecdhe, tls12Rsa } from "./tls12";
import { tls13Full } from "./tls13-full";
import { tls13Hrr } from "./tls13-hrr";
import { tls13Resume } from "./tls13-resume";
import type { ScenarioDef } from "./types";

/** In the order the workbench lists them. */
export const scenarioDefs: ScenarioDef[] = [tls13Full, tls13Hrr, tls13Resume, tls12Ecdhe, tls12Rsa];

export const scenarioById = new Map(scenarioDefs.map((s) => [s.id, s]));

export const defaultScenario = tls13Full.id;
