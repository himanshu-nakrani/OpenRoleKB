import { randomInt } from "node:crypto";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateTransferCode(): string {
  let out = "";
  for (let i = 0; i < 6; i++) out += ALPHABET[randomInt(0, ALPHABET.length)];
  return out;
}
