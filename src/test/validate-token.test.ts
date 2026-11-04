import { beforeAll, describe, expect, it } from "vitest";
import { generateKeyPair, SignJWT, type CryptoKey as JoseKey } from "jose";
import { validateToken } from "@/lib/auth/validate-token.server";

let priv: JoseKey;
let pub: JoseKey;
let otherPriv: JoseKey;
beforeAll(async () => {
  ({ privateKey: priv, publicKey: pub } = await generateKeyPair("RS256"));
  ({ privateKey: otherPriv } = await generateKeyPair("RS256"));
});

const users: Record<string, { id: string; status: string }> = {
  "auth0|ada": { id: "u-ada", status: "active" },
  "auth0|sus": { id: "u-sus", status: "suspended" },
};
const deps = () => ({
  domain: "owanbe.us.auth0.com",
  audience: "https://api.owanbe.app",
  keys: pub,
  findUser: async (sub: string) => users[sub] ?? null,
});
const sign = (claims: { sub?: string; iss?: string; aud?: string; exp?: string | number }, key = priv) => {
  const jwt = new SignJWT({}).setProtectedHeader({ alg: "RS256" });
  if (claims.sub) jwt.setSubject(claims.sub);
  jwt.setIssuer(claims.iss ?? "https://owanbe.us.auth0.com/");
  jwt.setAudience(claims.aud ?? "https://api.owanbe.app");
  jwt.setExpirationTime(claims.exp ?? "1h");
  return jwt.sign(key);
};

describe("F-78 validateToken", () => {
  it("accepts a valid token and maps it to its app user", async () => {
    await expect(validateToken(await sign({ sub: "auth0|ada" }), deps())).resolves.toEqual({ sub: "auth0|ada", userId: "u-ada", status: "active" });
  });
  it("rejects a token signed by another key", async () => {
    await expect(validateToken(await sign({ sub: "auth0|ada" }, otherPriv), deps())).rejects.toThrow("invalid");
  });
  it("rejects the wrong issuer", async () => {
    await expect(validateToken(await sign({ sub: "auth0|ada", iss: "https://evil.example/" }), deps())).rejects.toThrow("invalid");
  });
  it("rejects the wrong audience", async () => {
    await expect(validateToken(await sign({ sub: "auth0|ada", aud: "other" }), deps())).rejects.toThrow("invalid");
  });
  it("rejects an expired token", async () => {
    await expect(validateToken(await sign({ sub: "auth0|ada", exp: Math.floor(Date.now() / 1000) - 60 }), deps())).rejects.toThrow("invalid");
  });
  it("rejects suspended users and unknown subjects", async () => {
    await expect(validateToken(await sign({ sub: "auth0|sus" }), deps())).rejects.toThrow("inactive");
    await expect(validateToken(await sign({ sub: "auth0|nobody" }), deps())).rejects.toThrow("unknown_user");
  });
  it("rejects a missing token", async () => {
    await expect(validateToken(undefined, deps())).rejects.toThrow("missing");
  });
});
