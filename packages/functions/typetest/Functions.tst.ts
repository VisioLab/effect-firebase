// The tests pass Layers with requirements left on purpose, to check they are
// type errors; the language service would flag each of them a second time.
// @effect-diagnostics missingLayerContext:off
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import * as Callable from "@visiolab/effect-firebase/functions/Callable";
import * as DocumentTrigger from "@visiolab/effect-firebase/functions/DocumentTrigger";
import * as FunctionGroup from "@visiolab/effect-firebase/functions/FunctionGroup";
import * as CallableMiddleware from "@visiolab/effect-firebase/functions/CallableMiddleware";
import * as CallableRequest from "@visiolab/effect-firebase/functions/CallableRequest";
import * as Caller from "@visiolab/effect-firebase/functions/Caller";
import * as Functions from "@visiolab/effect-firebase-functions/Functions";
import { Context, Effect, Layer, Option, Schema } from "effect";
import type { CloudFunction } from "firebase-functions/v2";
import type * as Firestore from "firebase-functions/v2/firestore";
import { describe, expect, test } from "tstyche";

const Greet = Callable.make("greet", {
  payload: { name: Schema.String },
  success: Schema.String,
});
const Ping = Callable.make("ping");

const GreetLive = Callable.toLayer(Greet, ({ name }) => Effect.succeed(`Hello, ${name}!`));
const PingLive = Callable.toLayer(Ping, () => Effect.void);

class Clock extends Context.Service<Clock, { readonly now: Effect.Effect<Date> }>()("test/Clock") {}

describe("Functions.make", () => {
  test("exports one Callable Function under the Callable's name", () => {
    const exports = Functions.make(Greet, GreetLive);
    expect(exports).type.toBe<{ readonly greet: Functions.CallableExport }>();
  });

  test("a typo in the destructured export is a type error", () => {
    // @ts-expect-error Property 'gret' does not exist
    const { gret } = Functions.make(Greet, GreetLive);
    void gret;
  });

  test("a Live without the Callable's handler is a type error", () => {
    // @ts-expect-error not assignable
    Functions.make(Greet, PingLive);
  });

  test("a Live that leaves a requirement is a type error", () => {
    const NeedsClock = Callable.toLayer(Greet, ({ name }) =>
      Effect.map(Effect.service(Clock), () => name),
    );
    // @ts-expect-error not assignable
    Functions.make(Greet, NeedsClock);
  });

  test("a Live that provides more is accepted", () => {
    expect(Functions.make(Greet, Layer.merge(GreetLive, PingLive))).type.toBe<{
      readonly greet: Functions.CallableExport;
    }>();
  });
});

const CreateUser = Callable.make("create", {
  payload: { name: Schema.String },
  success: Schema.String,
});
const GetUser = Callable.make("get", { payload: { id: Schema.String }, success: Schema.String });

class Users extends FunctionGroup.make("users").add(CreateUser, GetUser) {}
class Orders extends FunctionGroup.make("orders").add(GetUser) {}

const UsersLive = Layer.mergeAll(
  Callable.toLayer(Users, "create", ({ name }) => Effect.succeed(name)),
  Callable.toLayer(Users, "get", ({ id }) => Effect.succeed(id)),
);

describe("Functions.group", () => {
  test("exports the members under the group's name", () => {
    expect(Functions.group(Users, UsersLive)).type.toBe<{
      readonly users: {
        readonly create: Functions.CallableExport;
        readonly get: Functions.CallableExport;
      };
    }>();
  });

  test("a typo in the destructured export is a type error", () => {
    // @ts-expect-error Property 'user' does not exist
    const { user } = Functions.group(Users, UsersLive);
    void user;
  });

  test("takes options per member, by name", () => {
    Functions.group(Users, UsersLive, { get: { region: "europe-west1" } });
    // @ts-expect-error Object literal may only specify known properties
    Functions.group(Users, UsersLive, { update: { region: "europe-west1" } });
  });

  test("a Live without a member's handler is a type error", () => {
    const GetOnly = Callable.toLayer(Users, "get", ({ id }) => Effect.succeed(id));
    // @ts-expect-error not assignable
    Functions.group(Users, GetOnly);
  });

  test("the handler of the standalone Callable doesn't serve the member", () => {
    const Live = Layer.mergeAll(
      Callable.toLayer(Users, "create", ({ name }) => Effect.succeed(name)),
      Callable.toLayer(GetUser, ({ id }) => Effect.succeed(id)),
    );
    // @ts-expect-error not assignable
    Functions.group(Users, Live);
  });

  test("the handler of users.get doesn't serve orders.get", () => {
    // @ts-expect-error not assignable
    Functions.group(Orders, UsersLive);
  });

  test("a Live with the handlers of each group serves both", () => {
    const OrdersLive = Callable.toLayer(Orders, "get", ({ id }) => Effect.succeed(id));
    expect(Functions.group(Orders, Layer.merge(UsersLive, OrdersLive))).type.toBe<{
      readonly orders: { readonly get: Functions.CallableExport };
    }>();
  });
});

const WhoAmI = Callable.make("whoAmI", { success: Schema.String }).middleware(Caller.Authenticated);
const WhoAmILive = Callable.toLayer(WhoAmI, () =>
  Effect.map(Effect.service(Caller.Caller), ({ uid }) => uid),
);

describe("Functions.make with middleware", () => {
  test("a Live with the handler and every middleware implementation is accepted", () => {
    expect(Functions.make(WhoAmI, Layer.merge(WhoAmILive, Caller.Authenticated.layer))).type.toBe<{
      readonly whoAmI: Functions.CallableExport;
    }>();
  });

  test("a Live without a middleware implementation is a type error", () => {
    // @ts-expect-error not assignable
    Functions.make(WhoAmI, WhoAmILive);
  });
});

class Signed extends FunctionGroup.make("signed").add(
  GetUser,
  CreateUser.middleware(Caller.Authenticated),
) {}

const SignedLive = Layer.mergeAll(
  Callable.toLayer(Signed, "create", () =>
    Effect.map(Effect.service(Caller.Caller), ({ uid }) => uid),
  ),
  Callable.toLayer(Signed, "get", ({ id }) => Effect.succeed(id)),
);

describe("Functions.group with a member's middleware", () => {
  test("a Live with the handlers and the member's middleware implementation is accepted", () => {
    expect(Functions.group(Signed, Layer.merge(SignedLive, Caller.Authenticated.layer))).type.toBe<{
      readonly signed: {
        readonly create: Functions.CallableExport;
        readonly get: Functions.CallableExport;
      };
    }>();
  });

  test("a Live without the member's middleware implementation is a type error", () => {
    // @ts-expect-error not assignable
    Functions.group(Signed, SignedLive);
  });
});

class ReadsRequest extends CallableMiddleware.Service<ReadsRequest>()("test/ReadsRequest") {}

const ReadsRequestLive = Layer.succeed(ReadsRequest, (effect) =>
  Effect.andThen(
    Effect.map(Effect.service(CallableRequest.CallableRequest), ({ rawRequest }) =>
      Option.getOrNull(rawRequest.remoteAddress),
    ),
    effect,
  ),
);

const userAgent = Effect.map(Effect.service(CallableRequest.CallableRequest), ({ rawRequest }) =>
  String(rawRequest.headers["user-agent"]),
);

const Audited = Callable.make("audited").middleware(ReadsRequest);
const AuditedLive = Callable.toLayer(Audited, () => Effect.void);

const UserAgent = Callable.make("userAgent", { success: Schema.String });
const UserAgentLive = Callable.toLayer(UserAgent, () => userAgent);

class Reading extends FunctionGroup.make("reading").add(UserAgent.middleware(ReadsRequest)) {}
const ReadingLive = Callable.toLayer(Reading, "userAgent", () => userAgent);

describe("CallableRequest.rawRequest, provided per call", () => {
  test("a middleware that reads it needs no Live to provide it", () => {
    expect(Functions.make(Audited, Layer.merge(AuditedLive, ReadsRequestLive))).type.toBe<{
      readonly audited: Functions.CallableExport;
    }>();
  });

  test("a handler that reads it needs no Live to provide it", () => {
    expect(Functions.make(UserAgent, UserAgentLive)).type.toBe<{
      readonly userAgent: Functions.CallableExport;
    }>();
  });

  test("a group member's handler and middleware that read it need no Live to provide it", () => {
    expect(Functions.group(Reading, Layer.merge(ReadingLive, ReadsRequestLive))).type.toBe<{
      readonly reading: { readonly userAgent: Functions.CallableExport };
    }>();
  });

  test("another requirement next to it is still a type error", () => {
    const NeedsClock = Callable.toLayer(UserAgent, () =>
      Effect.andThen(Effect.service(Clock), userAgent),
    );
    // @ts-expect-error not assignable
    Functions.make(UserAgent, NeedsClock);
  });
});

class Author extends FirestoreModel.Class<Author>("Author")({ name: Schema.String }) {}
class Post extends FirestoreModel.Class<Post>("Post")({ title: Schema.String }) {}

const Posts = Collection.make("authors", Author).subcollection("posts", Post);
const OnPostCreated = DocumentTrigger.created("onPostCreated", Posts);
const OnPostCreatedLive = DocumentTrigger.toLayer(OnPostCreated, () => Effect.void);

describe("Functions.make with a Document Trigger", () => {
  test("exports the trigger under its name", () => {
    expect(Functions.make(OnPostCreated, OnPostCreatedLive)).type.toBe<{
      readonly onPostCreated: Functions.DocumentTriggerExport<typeof OnPostCreated>;
    }>();
  });

  test("a Live without the trigger's handler is a type error", () => {
    // @ts-expect-error not assignable
    Functions.make(OnPostCreated, GreetLive);
  });

  test("a Live that leaves a requirement of the handler is a type error", () => {
    const NeedsClock = DocumentTrigger.toLayer(OnPostCreated, () =>
      Effect.asVoid(Effect.service(Clock)),
    );
    // @ts-expect-error not assignable
    Functions.make(OnPostCreated, NeedsClock);
  });

  test("takes the shared options and retry", () => {
    Functions.make(OnPostCreated, OnPostCreatedLive, {
      region: "europe-west1",
      memory: "512MiB",
      timeoutSeconds: 60,
      retry: true,
    });
  });

  test("doesn't take the document, database or Callable options", () => {
    // @ts-expect-error Object literal may only specify known properties
    Functions.make(OnPostCreated, OnPostCreatedLive, { document: "posts/{id}" });
    // @ts-expect-error Object literal may only specify known properties
    Functions.make(OnPostCreated, OnPostCreatedLive, { database: "other" });
    // @ts-expect-error Object literal may only specify known properties
    Functions.make(OnPostCreated, OnPostCreatedLive, { namespace: "other" });
    // @ts-expect-error Object literal may only specify known properties
    Functions.make(OnPostCreated, OnPostCreatedLive, { cors: true });
  });

  test("exports each change with the CloudFunction of its onDocument* provider", () => {
    const OnPostDeleted = DocumentTrigger.deleted("onPostDeleted", Posts);
    const OnPostUpdated = DocumentTrigger.updated("onPostUpdated", Posts);
    const OnPostWritten = DocumentTrigger.written("onPostWritten", Posts);
    expect(
      Functions.make(
        OnPostDeleted,
        DocumentTrigger.toLayer(OnPostDeleted, () => Effect.void),
      ),
    ).type.toBe<{
      readonly onPostDeleted: CloudFunction<
        Firestore.FirestoreEvent<Firestore.QueryDocumentSnapshot | undefined>
      >;
    }>();
    expect(
      Functions.make(
        OnPostUpdated,
        DocumentTrigger.toLayer(OnPostUpdated, () => Effect.void),
      ),
    ).type.toBe<{
      readonly onPostUpdated: CloudFunction<
        Firestore.FirestoreEvent<Firestore.Change<Firestore.QueryDocumentSnapshot> | undefined>
      >;
    }>();
    expect(
      Functions.make(
        OnPostWritten,
        DocumentTrigger.toLayer(OnPostWritten, () => Effect.void),
        {
          retry: true,
        },
      ),
    ).type.toBe<{
      readonly onPostWritten: CloudFunction<
        Firestore.FirestoreEvent<Firestore.Change<Firestore.DocumentSnapshot> | undefined>
      >;
    }>();
  });

  test("a Live of another change's trigger is a type error", () => {
    const OnPostDeleted = DocumentTrigger.deleted("onPostDeleted", Posts);
    // @ts-expect-error not assignable
    Functions.make(OnPostDeleted, OnPostCreatedLive);
  });

  test("a Callable doesn't take retry", () => {
    // @ts-expect-error Object literal may only specify known properties
    Functions.make(Greet, GreetLive, { retry: true });
  });
});

const EditPost = Callable.make("edit", { payload: { title: Schema.String } });
const OnCreated = DocumentTrigger.created("onCreated", Posts);

class PostFunctions extends FunctionGroup.make("posts").add(EditPost, OnCreated) {}

const PostFunctionsLive = Layer.mergeAll(
  Callable.toLayer(PostFunctions, "edit", () => Effect.void),
  DocumentTrigger.toLayer(PostFunctions, "onCreated", () => Effect.void),
);

describe("Functions.group with Callables and Document Triggers", () => {
  test("exports each member by its kind under the group's name", () => {
    expect(Functions.group(PostFunctions, PostFunctionsLive)).type.toBe<{
      readonly posts: {
        readonly edit: Functions.CallableExport;
        readonly onCreated: Functions.DocumentTriggerExport<typeof OnCreated>;
      };
    }>();
  });

  test("a Live without the trigger's handler is a type error", () => {
    const EditOnly = Callable.toLayer(PostFunctions, "edit", () => Effect.void);
    // @ts-expect-error not assignable
    Functions.group(PostFunctions, EditOnly);
  });

  test("a Live without the Callable's handler is a type error", () => {
    const TriggerOnly = DocumentTrigger.toLayer(PostFunctions, "onCreated", () => Effect.void);
    // @ts-expect-error not assignable
    Functions.group(PostFunctions, TriggerOnly);
  });

  test("the handler of the trigger in no group doesn't serve the member", () => {
    const Live = Layer.mergeAll(
      Callable.toLayer(PostFunctions, "edit", () => Effect.void),
      DocumentTrigger.toLayer(OnCreated, () => Effect.void),
    );
    // @ts-expect-error not assignable
    Functions.group(PostFunctions, Live);
  });

  test("takes each member's options by its kind", () => {
    Functions.group(PostFunctions, PostFunctionsLive, {
      edit: { region: "europe-west1", cors: true },
      onCreated: { region: "europe-west1", retry: true },
    });
  });

  test("a Callable member doesn't take retry", () => {
    // @ts-expect-error Object literal may only specify known properties
    Functions.group(PostFunctions, PostFunctionsLive, { edit: { retry: true } });
  });

  test("a trigger member doesn't take cors or the document", () => {
    // @ts-expect-error Object literal may only specify known properties
    Functions.group(PostFunctions, PostFunctionsLive, { onCreated: { cors: true } });
    // @ts-expect-error Object literal may only specify known properties
    Functions.group(PostFunctions, PostFunctionsLive, { onCreated: { document: "posts/{id}" } });
  });
});
