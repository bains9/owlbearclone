// Messages to and from the GM's dd worker (ddWorker.ts, a lazy module worker; design 7.1), and the
// exact-data part of the seasons worker's analyse message.

import type { AttachReport, FitResult, PictureSample, VttMeta } from "./extract";

export type DdWorkerIn =
  /** Parse the project file (the worker reads the File itself), rank levels, fit, measure and compile. */
  | {
      t: "prepare";
      id: number;
      file: File;
      pic: PictureSample;
      /** The picture's full size (pic may be scaled down). */
      picW: number;
      picH: number;
      vtt?: VttMeta;
      mapRect?: [number, number, number, number];
      levelKey?: string;
      shift?: [number, number];
      compare?: boolean;
    }
  /** Fit an attached sidecar against a picture. */
  | { t: "check"; id: number; sidecar: Uint8Array; pic: PictureSample; picW: number; picH: number };

/** Why attached data couldn't be checked against a picture. */
export interface CheckRefusal {
  error: string;
  /** The picture is another shape than the data's (2.8's hard check): it can't be used with it, even "anyway". */
  hard?: true;
}

/** A check of attached data against a picture: the fit, or why there is none. */
export type CheckResult = FitResult | CheckRefusal;

export type DdWorkerOut =
  | {
      t: "prepared";
      id: number;
      report: AttachReport;
      sidecar: Uint8Array;
      preview: Uint8ClampedArray;
      pw: number;
      ph: number;
      compare?: { exact: Uint8ClampedArray; guessed: Uint8ClampedArray; w: number; h: number };
    }
  | { t: "checked"; id: number; fit: CheckResult }
  | { t: "progress"; id: number; text: string }
  | { t: "error"; id: number; message: string };

/**
 * seasonWorker.ts's Analyse message gains dd?: SeasonDdData. The sidecar is a copy (the cache
 * keeps its own bytes), transferred.
 */
export interface SeasonDdData {
  sidecar: Uint8Array;
  bare?: "leaf" | "dead";
  drawn?: "winter" | "green";
  packs?: "guess";
}
