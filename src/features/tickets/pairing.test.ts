import { describe, expect, it } from "vitest";
import { PAIRING_PREFIX, pairingCode, parsePairingCode } from "./pairing";

const GRANT = "3f0d9a4e-1c2b-4a5d-8e7f-0a1b2c3d4e5f";

describe("F-108 pairing code", () => {
  it("carries the grant, the device and the end of the grant", () => {
    const code = pairingCode({
      grant_id: GRANT,
      device_id: "Gate phone 1",
      expires_at: "2026-11-20T23:59:00.000Z",
    });

    expect(code.startsWith(PAIRING_PREFIX)).toBe(true);
    const parsed = parsePairingCode(code);
    expect(parsed).toEqual({
      grant_id: GRANT,
      device_id: "Gate phone 1",
      expires_at: "2026-11-20T23:59:00.000Z",
    });
  });

  it("reads back a code that was typed with spaces around it", () => {
    const code = pairingCode({
      grant_id: GRANT,
      device_id: "Gate phone 1",
      expires_at: "2026-11-20T23:59:00.000Z",
    });

    expect(parsePairingCode(`  ${code}  `)).not.toBeNull();
  });

  it("refuses anything that is not a pairing code", () => {
    expect(parsePairingCode("not-a-code")).toBeNull();
    expect(parsePairingCode(`${PAIRING_PREFIX}?grant=nope&device=Phone&expires=then`)).toBeNull();
    expect(parsePairingCode(`${PAIRING_PREFIX}?device=Phone&expires=then`)).toBeNull();
    expect(parsePairingCode(`${PAIRING_PREFIX}`)).toBeNull();
  });

  it("refuses a code whose device name is longer than the platform allows", () => {
    const code = `${PAIRING_PREFIX}?grant=${GRANT}&device=${"p".repeat(121)}&expires=then`;

    expect(parsePairingCode(code)).toBeNull();
  });
});
