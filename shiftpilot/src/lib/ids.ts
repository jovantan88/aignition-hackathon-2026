import { customAlphabet } from "nanoid";

const alphabet = customAlphabet("0123456789abcdefghijkmnopqrstuvwxyz", 10);

export type IdPrefix =
  | "org"
  | "out"
  | "wkr"
  | "tpl"
  | "cyc"
  | "avl"
  | "rc"
  | "shf"
  | "cov"
  | "ofr"
  | "cnv"
  | "msg"
  | "med"
  | "mem"
  | "run"
  | "aud"
  | "apr"
  | "job";

export const newId = (prefix: IdPrefix) => `${prefix}_${alphabet()}`;
