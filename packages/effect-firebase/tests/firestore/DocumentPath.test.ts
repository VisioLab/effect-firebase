import { describe, expect, it } from "@effect/vitest";
import { Equal, Hash, Option } from "effect";
import * as DocumentPath from "../../src/firestore/DocumentPath.ts";

describe("make", () => {
  it("holds the path of the document it points at", () => {
    const path = Option.getOrThrow(DocumentPath.make("users/alice/posts/hello"));
    expect(DocumentPath.isDocumentPath(path)).toBe(true);
    expect(path.path).toBe("users/alice/posts/hello");
  });

  it("is None for a path that does not address a document", () => {
    expect(Option.isNone(DocumentPath.make("users"))).toBe(true);
    expect(Option.isNone(DocumentPath.make("users/alice/posts"))).toBe(true);
    expect(Option.isNone(DocumentPath.make("users//posts/hello"))).toBe(true);
    expect(Option.isNone(DocumentPath.make(""))).toBe(true);
  });
});

describe("makeUnsafe", () => {
  it("throws for a path that does not address a document", () => {
    expect(DocumentPath.makeUnsafe("users/alice").path).toBe("users/alice");
    expect(() => DocumentPath.makeUnsafe("users")).toThrow('"users"');
  });
});

describe("equality", () => {
  it("compares by path alone", () => {
    const self = DocumentPath.makeUnsafe("users/alice/posts/hello");
    const that = DocumentPath.makeUnsafe("users/alice/posts/hello");
    expect(Equal.equals(self, that)).toBe(true);
    expect(Hash.hash(self)).toBe(Hash.hash(that));
    expect(Equal.equals(self, DocumentPath.makeUnsafe("users/bob/posts/hello"))).toBe(false);
  });
});

describe("isDocumentPath", () => {
  it("refuses a map that only looks like one", () => {
    expect(DocumentPath.isDocumentPath({ path: "users/alice" })).toBe(false);
    expect(DocumentPath.isDocumentPath("users/alice")).toBe(false);
  });
});
