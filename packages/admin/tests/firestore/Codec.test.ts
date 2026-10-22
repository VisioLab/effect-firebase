import { describe, expect, it } from "@effect/vitest";
import { DateTime, Effect, Layer, Option, Schema, Stream } from "effect";
import { FirestoreError } from "@visiolab/effect-firebase/firestore/Firestore";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as DocumentSnapshot from "@visiolab/effect-firebase/firestore/DocumentSnapshot";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import * as Admin from "firebase-admin/firestore";
import * as App from "../../src/App.ts";
import * as AdminFirestore from "../../src/firestore/AdminFirestore.ts";
import { clear } from "./emulator.ts";

const projectId = "demo-firestore-codec";

const layer = AdminFirestore.layer().pipe(
  Layer.provideMerge(App.layer({ projectId }, "firestore-codec")),
);

// A model of plain Effect schemas: nothing in it names how Firestore stores it.
class Event extends FirestoreModel.Class<Event>("Event")({
  title: Schema.String,
  at: Schema.DateTimeUtc,
  day: Schema.Date,
  payload: Schema.Uint8Array,
  note: Schema.Option(Schema.String),
}) {}

const Events = Collection.make("events", Event);
const launch = Events.id.make("launch");

const event = {
  title: "Launch",
  at: DateTime.makeUnsafe("2024-05-06T07:08:09.123Z"),
  day: new Date("2001-02-03T04:05:06.789Z"),
  payload: new Uint8Array([1, 2, 3]),
  note: Option.some("on time"),
};

// Cleared before each test rather than after, so a failed test leaves its
// documents behind to look at.
const fresh = clear(projectId).pipe(Effect.andThen(AdminFirestore.AdminFirestore));

const read = <C extends Collection.Any>(snapshot: DocumentSnapshot.DocumentSnapshot<C>) =>
  DocumentSnapshot.isExisting(snapshot) ? snapshot.data : Effect.die("missing");

describe("A plain model, against the emulator", () => {
  it.effect("reads back equal to what was written", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh;

      yield* firestore.setDoc(Events.doc(launch), event);
      const data = yield* read(yield* firestore.getDoc(Events.doc(launch)));

      expect(data.title).toBe("Launch");
      expect(DateTime.toEpochMillis(data.at)).toBe(DateTime.toEpochMillis(event.at));
      expect(data.day.getTime()).toBe(event.day.getTime());
      expect([...data.payload]).toEqual([1, 2, 3]);
      expect(data.note).toEqual(Option.some("on time"));
    }).pipe(Effect.provide(layer)),
  );

  it.effect("is stored as the Admin SDK's own timestamps and bytes", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh;

      yield* firestore.setDoc(Events.doc(launch), event);
      const raw = yield* Effect.promise(() => firestore.instance.doc("events/launch").get());

      const at = raw.get("at");
      expect(at).toBeInstanceOf(Admin.Timestamp);
      expect((at as Admin.Timestamp).isEqual(new Admin.Timestamp(1_714_979_289, 123_000_000))).toBe(
        true,
      );
      expect(raw.get("day")).toBeInstanceOf(Admin.Timestamp);
      expect(raw.get("payload")).toBeInstanceOf(Uint8Array);
      expect([...raw.get("payload")]).toEqual([1, 2, 3]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("fails to read a document holding a value outside Firestore Values", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh;

      yield* Effect.promise(() =>
        firestore.instance
          .doc("events/launch")
          .set({ title: "Launch", embedding: Admin.FieldValue.vector([1, 2]) }),
      );

      const error = yield* Effect.flip(firestore.getDoc(Events.doc(launch)));
      expect(error).toBeInstanceOf(FirestoreError);
      expect(error.message).toContain('"events/launch"');
      expect(error.message).toContain('"embedding"');
      expect(error.message).toContain("VectorValue");

      // Reading the whole collection, or listening, fails the same way.
      const all = yield* Effect.flip(firestore.getDocs(Events.collection()));
      expect(all.message).toContain('"embedding"');
      const streamed = yield* Effect.flip(Stream.runHead(firestore.streamDoc(Events.doc(launch))));
      expect(streamed.message).toContain('"embedding"');
    }).pipe(Effect.provide(layer)),
  );
});
