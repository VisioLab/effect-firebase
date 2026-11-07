import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import type * as DocumentSnapshot from "@visiolab/effect-firebase/firestore/DocumentSnapshot";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import * as DocumentTrigger from "@visiolab/effect-firebase/functions/DocumentTrigger";
import * as FunctionGroup from "@visiolab/effect-firebase/functions/FunctionGroup";
import { Context, Effect, type Layer, Schema } from "effect";
import { describe, expect, test } from "tstyche";

class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}
class Post extends FirestoreModel.Class<Post>("Post")({ title: Schema.String }) {}

const Users = Collection.make("users", User);
const Posts = Users.subcollection("posts", Post);

const OnPostCreated = DocumentTrigger.created("onPostCreated", Posts);

class Clock extends Context.Service<Clock, { readonly now: Effect.Effect<Date> }>()("test/Clock") {}

describe("DocumentTrigger.created", () => {
  test("keeps the name as a literal type and the collection it watches", () => {
    expect(OnPostCreated.name).type.toBe<"onPostCreated">();
    expect(OnPostCreated.collection).type.toBe<typeof Posts>();
    expect(OnPostCreated.event).type.toBe<"created">();
  });

  test("takes a Collection, not a path", () => {
    // @ts-expect-error not assignable
    DocumentTrigger.created("onPostCreated", "users/{userId}/posts/{postId}");
  });

  test("hands its handler the created document, its typed reference, and the CloudEvent's id and time", () => {
    expect<DocumentTrigger.Event<typeof OnPostCreated>>().type.toBe<
      DocumentTrigger.Created<typeof Posts>
    >();
    type Event = DocumentTrigger.Event<typeof OnPostCreated>;
    expect<Event["snapshot"]>().type.toBe<DocumentSnapshot.Existing<typeof Posts>>();
    expect<Event["ref"]>().type.toBe<Collection.DocumentReference<typeof Posts>>();
    expect<Event["id"]>().type.toBe<string>();
    expect<Event["time"]>().type.toBe<string>();
    expect<Event>().type.not.toHaveProperty("params");
  });

  test("reads the wildcard ids from the reference, branded with their collections", () => {
    DocumentTrigger.toLayer(OnPostCreated, (event) => {
      expect(event.ref.ancestors).type.toBe<Readonly<Collection.Ancestors<typeof Posts>>>();
      expect(event.ref.ancestors[0]).type.toBe<Collection.Id<typeof Users>>();
      expect(event.ref.id).type.toBe<Collection.Id<typeof Posts>>();
      return Effect.void;
    });
  });

  test("is a Function Group member of kind DocumentTrigger", () => {
    class Posting extends FunctionGroup.make("posting").add(OnPostCreated) {}
    expect<FunctionGroup.Names<typeof Posting, DocumentTrigger.Any>>().type.toBe<"onPostCreated">();
  });
});

describe("DocumentTrigger.createdEvent", () => {
  test("builds the event of the snapshot's collection", () => {
    const snapshot = {} as DocumentSnapshot.Existing<typeof Posts>;
    expect(DocumentTrigger.createdEvent({ id: "1", time: "t", snapshot })).type.toBe<
      DocumentTrigger.Created<typeof Posts>
    >();
  });
});

describe("DocumentTrigger.toLayer", () => {
  test("provides the trigger's handler, and requires what the handler needs", () => {
    const live = DocumentTrigger.toLayer(OnPostCreated, () => Effect.asVoid(Effect.service(Clock)));
    expect(live).type.toBe<
      Layer.Layer<DocumentTrigger.HandlerFor<typeof OnPostCreated>, never, Clock>
    >();
  });

  test("takes an Effect that builds the handler", () => {
    const live = DocumentTrigger.toLayer(
      OnPostCreated,
      Effect.map(Effect.service(Clock), () => () => Effect.void),
    );
    expect(live).type.toBe<
      Layer.Layer<DocumentTrigger.HandlerFor<typeof OnPostCreated>, never, Clock>
    >();
  });

  test("leaves the handler's error channel open", () => {
    expect(DocumentTrigger.toLayer(OnPostCreated, () => Effect.fail("boom"))).type.toBe<
      Layer.Layer<DocumentTrigger.HandlerFor<typeof OnPostCreated>>
    >();
  });
});

describe("DocumentTrigger.serve", () => {
  test("requires the trigger's handler and runs its event", () => {
    expect(DocumentTrigger.serve(OnPostCreated)).type.toBe<
      Effect.Effect<
        (event: DocumentTrigger.Created<typeof Posts>) => Effect.Effect<void, unknown>,
        never,
        DocumentTrigger.HandlerFor<typeof OnPostCreated>
      >
    >();
  });
});
