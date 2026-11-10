// PROTOTYPE — does the model's JSON codec encode a decoded Post synchronously?
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as DocumentSnapshot from "@visiolab/effect-firebase/firestore/DocumentSnapshot";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import * as FirestoreSchema from "@visiolab/effect-firebase/firestore/FirestoreSchema";
import * as DocumentPath from "@visiolab/effect-firebase/firestore/DocumentPath";
import * as Timestamp from "@visiolab/effect-firebase/firestore/Timestamp";
import { Effect, Schema } from "effect";

class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}
const Users = Collection.make("users", User);
const fields = {
  title: Schema.String,
  publishedAt: FirestoreSchema.Timestamp,
  author: FirestoreSchema.DocumentReference(Users),
  cover: Schema.Uint8Array,
  when: Schema.DateTimeUtc,
};
class Post extends FirestoreModel.Class<Post>("Post")(fields) {}
const Posts = Collection.make("posts", Post);

const raw = {
  title: "Hello",
  publishedAt: Timestamp.makeUnsafe(1_700_000_000, 5),
  author: DocumentPath.makeUnsafe("users/alice"),
  cover: new Uint8Array([1, 2, 3]),
  when: Timestamp.makeUnsafe(1_700_000_000, 5),
};
const snap = DocumentSnapshot.make(Posts.doc(Posts.id.make("p1")), raw);
const post = Effect.runSync((snap as any).data) as Post;
console.log("decoded:", post);
const tryEnc = (name: string, schema: any, value: unknown) => {
  try {
    const json = Schema.encodeUnknownSync(Schema.toCodecJson(schema) as any)(value);
    console.log(name, "OK", JSON.stringify(json));
    console.log(
      name,
      "roundtrip",
      Schema.decodeUnknownSync(Schema.toCodecJson(schema) as any)(json),
    );
  } catch (e) {
    console.log(name, "FAIL", String(e).slice(0, 400));
  }
};
tryEnc("whole model", Post, post);
for (const [k, s] of Object.entries(fields)) tryEnc(k, s, (post as any)[k]);
