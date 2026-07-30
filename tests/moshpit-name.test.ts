// TLD names are the primary key of the whole namespace, so a name that
// normalises two ways, or a reserved name slipping through, is a namespace bug
// rather than a validation nit.
import { describe, expect, it } from "bun:test";
import { RESERVED_TLDS, normalizeTld, tldRejection } from "../lib/moshpit-name";

describe("normalizeTld", () => {
  it("accepts what people actually type", () => {
    expect(normalizeTld("eggs")).toBe("eggs");
    expect(normalizeTld(".eggs")).toBe("eggs");
    expect(normalizeTld("  .EGGS  ")).toBe("eggs");
    expect(normalizeTld("scrambled-eggs")).toBe("scrambled-eggs");
    expect(normalizeTld("web3")).toBe("web3");
  });

  it("rejects a domain given where a TLD was asked for", () => {
    // "scrambled.eggs" is a domain. Silently registering ".scrambled" or
    // ".eggs" from it would hand someone a name they did not ask for.
    expect(normalizeTld("scrambled.eggs")).toBeNull();
    expect(normalizeTld(".a.b")).toBeNull();
  });

  it("rejects labels that are not valid hostname labels", () => {
    expect(normalizeTld("-eggs")).toBeNull();
    expect(normalizeTld("eggs-")).toBeNull();
    expect(normalizeTld("eg gs")).toBeNull();
    expect(normalizeTld("eggs!")).toBeNull();
    expect(normalizeTld("")).toBeNull();
    expect(normalizeTld("   ")).toBeNull();
    expect(normalizeTld(null)).toBeNull();
    expect(normalizeTld(undefined)).toBeNull();
    expect(normalizeTld("a".repeat(64))).toBeNull();
  });

  it("rejects all-numeric labels", () => {
    // Ambiguous against an IPv4 literal once it is part of a hostname.
    expect(normalizeTld("123")).toBeNull();
  });

  it("is idempotent — normalising twice changes nothing", () => {
    for (const raw of [".EGGS", "eggs", " .Scrambled-Eggs "]) {
      const once = normalizeTld(raw)!;
      expect(normalizeTld(once)).toBe(once);
    }
  });
});

describe("tldRejection", () => {
  it("blocks names that trade on someone else's trust", () => {
    for (const name of ["bank", "apple", "google", "paypal", "gov"]) {
      expect(tldRejection(name)).toBe("that name is reserved");
    }
  });

  it("blocks our own names from being claimed by anyone else", () => {
    for (const name of ["moshpit", "moshcode", "logicsrc"]) {
      expect(tldRejection(name)).toBe("that name is reserved");
    }
  });

  it("blocks names that would collide with the legacy internet", () => {
    for (const name of ["com", "net", "org", "localhost", "onion"]) {
      expect(tldRejection(name)).toBe("that name is reserved");
    }
  });

  it("requires at least two characters", () => {
    expect(tldRejection("a")).toBe("a TLD needs at least 2 characters");
  });

  it("allows an ordinary name", () => {
    for (const name of ["eggs", "preshy", "scrambled", "toast"]) {
      expect(tldRejection(name)).toBeNull();
    }
  });
});

describe("reserved list", () => {
  it("is stored normalised, so a lookup can never miss on case", () => {
    for (const name of RESERVED_TLDS) {
      expect(name).toBe(name.toLowerCase());
      expect(normalizeTld(name)).toBe(name);
    }
  });
});
