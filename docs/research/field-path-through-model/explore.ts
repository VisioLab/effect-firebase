import { Schema, SchemaAST } from "./effect.ts";
import {
  FirestoreModel,
  FirestoreValue,
} from "../../../packages/effect-firebase/src/firestore/index.ts";

class User extends FirestoreModel.Class<User>("User")({
  name: Schema.String,
  author: FirestoreModel.Struct({ name: Schema.String, age: Schema.Number }),
  nick: FirestoreModel.Optional(Schema.String),
  tags: FirestoreModel.Array(Schema.String),
}) {}

const show = (ast: SchemaAST.AST, depth = 0): string => {
  const pad = "  ".repeat(depth);
  let s = `${pad}${ast._tag}${ast.context?.isOptional ? "?" : ""}`;
  if (ast.encoding) s += ` encoding->[${ast.encoding.map((l) => l.to._tag).join(",")}]`;
  s += "\n";
  if (SchemaAST.isObjects(ast))
    for (const p of ast.propertySignatures)
      s += `${pad}  .${String(p.name)}:\n` + show(p.type, depth + 2);
  if (SchemaAST.isDeclaration(ast))
    for (const p of ast.typeParameters) s += `${pad}  typeParameter:\n` + show(p, depth + 2);
  if (ast.encoding)
    s += `${pad}  last link to:\n` + show(ast.encoding[ast.encoding.length - 1].to, depth + 2);
  return s;
};
console.log(show(User.ast));
console.log("--- toCodecFirestore(User)");
console.log(show(FirestoreValue.toCodecFirestore(User).ast));
