/**
 * Document schemas with one shape per operation.
 *
 * A document is read in one shape and written in two others. The id lives in
 * the path rather than in the data, a `createdAt` the server fills in is read
 * back as a timestamp but written as a sentinel, and an update is a map of the
 * fields that change rather than a whole document.
 *
 * Writing three schemas by hand means keeping three schemas in step. This
 * module takes one field declaration and derives all three from it, over
 * `VariantSchema` - the same machinery `effect/schema`'s `Model` is built on,
 * with the variants a database of documents needs rather than the ones a
 * database of rows does.
 *
 * ```ts
 * import { Schema } from "effect";
 * import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
 *
 * class User extends FirestoreModel.Class<User>("User")({
 *   displayName: Schema.String,
 *   signupSource: FirestoreModel.Immutable(Schema.String),
 *   createdAt: FirestoreModel.Timestamp,
 * }) {}
 *
 * User        // what a snapshot decodes into
 * User.create // what `set` writes
 * User.update // what `update` writes
 * ```
 *
 * @since 0.0.0
 */
import { Schema, Struct as Struct_ } from "effect";
import { VariantSchema } from "effect/schema";
import * as FirestoreSchema from "./FirestoreSchema.ts";

/**
 * The shapes a document is read and written in.
 *
 * - `read` is what `snapshot.data()` decodes into.
 * - `create` is what `set` writes, which is a whole document.
 * - `update` is what `update` writes, which is the fields that change.
 *
 * `read` is the default, so the schema itself is the one a document is read
 * through and the write shapes hang off it.
 *
 * @category models
 * @since 0.0.0
 */
export type Variant = "read" | "create" | "update";

const Variants = VariantSchema.make({
  variants: ["read", "create", "update"],
  defaultVariant: "read",
});

/**
 * Declares a field that is a different schema in different variants.
 *
 * @category constructors
 * @since 0.0.0
 */
export const Field = Variants.Field;

/**
 * Declares a field that only appears in the named variants.
 *
 * @category constructors
 * @since 0.0.0
 */
export const FieldOnly = Variants.FieldOnly;

/**
 * Declares a field that appears in every variant but the named ones.
 *
 * @category constructors
 * @since 0.0.0
 */
export const FieldExcept = Variants.FieldExcept;

/**
 * Groups fields without building a class, for nesting inside a document or
 * sharing between several.
 *
 * @category constructors
 * @since 0.0.0
 */
export const Struct = Variants.Struct;

/**
 * Rewrites the schemas of a field, variant by variant.
 *
 * @category transforming
 * @since 0.0.0
 */
export const fieldEvolve = Variants.fieldEvolve;

/**
 * Pulls one variant out of a field group as a plain schema.
 *
 * Note that the `update` variant this hands back is the one the fields declare,
 * which is to say it is not made partial the way {@link Class} makes it.
 *
 * @category converting
 * @since 0.0.0
 */
export const extract = Variants.extract;

/**
 * The field definitions a class or group was built from.
 *
 * @category getters
 * @since 0.0.0
 */
export const fields = <A extends VariantSchema.Struct<any>>(
  self: A,
): A[typeof VariantSchema.TypeId] => VariantSchema.fields(self);

/**
 * Any document schema, whatever it holds.
 *
 * @category models
 * @since 0.0.0
 */
export type Any = Schema.Top & {
  readonly fields: Schema.Struct.Fields;
  readonly create: Schema.Top;
  readonly update: Schema.Top;
};

/**
 * Makes every field of a variant optional.
 *
 * Only the top level, because that is as far as Firestore merges: `update`
 * replaces a nested map with the one it is handed rather than merging into it,
 * and reaching inside one means addressing it by field path - `"address.city"` -
 * which is a different write, not a deeper partial.
 */
const partial = <F extends Schema.Struct.Fields>(self: Schema.Struct<F>) =>
  self.mapFields(Struct_.map(Schema.optionalKey));

/**
 * The `update` variant of a set of fields: the fields that may change, each of
 * them optional.
 *
 * @category models
 * @since 0.0.0
 */
export type Update<Fields extends VariantSchema.Struct.Fields> = ReturnType<
  typeof partial<Struct_.Simplify<VariantSchema.ExtractFields<"update", Fields>>>
>;

/**
 * A document schema, together with the shapes it is written in.
 *
 * @category models
 * @since 0.0.0
 */
export interface Class<
  Self,
  Fields extends VariantSchema.Struct.Fields,
> extends VariantSchema.Class<
  Self,
  Fields,
  Schema.Struct<VariantSchema.ExtractFields<"read", Fields, true>>
> {
  /** What a snapshot decodes into, which is what the class itself is. */
  readonly read: VariantSchema.Extract<"read", VariantSchema.Struct<Fields>>;
  /** What `set` writes. */
  readonly create: VariantSchema.Extract<"create", VariantSchema.Struct<Fields>>;
  /** What `update` writes. */
  readonly update: Update<Fields>;
}

type MissingSelfGeneric =
  `Missing \`Self\` generic - use \`class Self extends Class<Self>("Self")({ ... })\``;

/**
 * Defines a document schema.
 *
 * The class is the `read` variant, so it is what a snapshot decodes into and
 * what every other schema combinator takes. {@link Class.create} and
 * {@link Class.update} hang off it.
 *
 * @category constructors
 * @since 0.0.0
 */
export const Class =
  <Self = never>(identifier: string) =>
  <const Fields extends VariantSchema.Struct.Fields>(
    fields: Fields & VariantSchema.Struct.Validate<Fields, Variant>,
    annotations?: Schema.Annotations.Declaration<
      Self,
      readonly [Schema.Struct<VariantSchema.ExtractFields<"read", Fields, true>>]
    >,
  ): [Self] extends [never] ? MissingSelfGeneric : Class<Self, Fields> => {
    const Base = Variants.Class<Self>(identifier)(fields, annotations) as any;
    // `Variants.Class` defines each variant as a non-configurable property, so
    // the partial `update` is shadowed from a subclass rather than written over
    // it. A class built this way is extended by the caller anyway, which is
    // what `Self` is for, so this is one more link in a chain that already has
    // one.
    class Model extends Base {}
    Object.defineProperty(Model, "update", {
      value: partial(Base.update).annotate({
        id: `${identifier}.update`,
        title: `${identifier}.update`,
      }),
    });
    return Model as any;
  };

/**
 * A union of document schemas, in every variant.
 *
 * @category constructors
 * @since 0.0.0
 */
export const Union = Variants.Union;

/**
 * Type-level representation of {@link Immutable}.
 *
 * @category models
 * @since 0.0.0
 */
export interface Immutable<S extends Schema.Top> extends VariantSchema.Field<{
  readonly read: S;
  readonly create: S;
}> {}

/**
 * A field written once, when the document is created.
 *
 * It is read back and it is set by `set`, and it is absent from `update`, so
 * the field cannot be changed by one.
 *
 * @category schemas
 * @since 0.0.0
 */
export const Immutable = <S extends Schema.Top>(schema: S): Immutable<S> =>
  Field({ read: schema, create: schema });

/**
 * Type-level representation of {@link Timestamp}.
 *
 * @category models
 * @since 0.0.0
 */
export interface Timestamp extends VariantSchema.Field<{
  readonly read: FirestoreSchema.Timestamp;
  readonly create: FirestoreSchema.TimestampOrServer;
  readonly update: FirestoreSchema.TimestampOrServer;
}> {}

/**
 * A timestamp field: stamped by this client, or left to the server.
 *
 * Both writes take either, and the read takes the timestamp alone, since that
 * is all a document ever holds. Leaving the sentinel open costs a call site
 * that never uses it nothing, and spares it from redeclaring the field the day
 * it does.
 *
 * Where the server is to decide, a call site hands it
 * {@link FieldValue.serverTimestamp}. Where it never may, name
 * {@link FirestoreSchema.Timestamp} directly, which goes into every variant as
 * it stands.
 *
 * @category schemas
 * @since 0.0.0
 */
export const Timestamp: Timestamp = Field({
  read: FirestoreSchema.Timestamp,
  create: FirestoreSchema.TimestampOrServer,
  update: FirestoreSchema.TimestampOrServer,
});

/**
 * Type-level representation of {@link Number}.
 *
 * @category models
 * @since 0.0.0
 */
export interface Number<S extends Schema.Top> extends VariantSchema.Field<{
  readonly read: S;
  readonly create: FirestoreSchema.IncrementOr<S>;
  readonly update: FirestoreSchema.IncrementOr<S>;
}> {}

/**
 * A number field: set outright, or moved by the server.
 *
 * Both writes take either, and the read takes `schema` alone, since a document
 * holds the sum the server wrote rather than the request to add. A move is what
 * keeps a total right when two clients write at once, which reading the number
 * and writing the sum back does not.
 *
 * What the number may be is `schema`'s to say, and the writes say it too: hand
 * it `Schema.Int` and the field is counted in whole steps, `Schema.Finite` and
 * it adds up fractions, either of them checked further and the check holds on
 * the way in and the way out. A move of its own is not checked against it,
 * since the sum is the server's to work out and only the next read sees it.
 *
 * ```ts
 * visits: FirestoreModel.Number(Schema.Int)
 * balance: FirestoreModel.Number(Schema.Finite)
 * ```
 *
 * Where the server is to move it, a call site hands it
 * {@link FieldValue.increment} or {@link FieldValue.decrement}. Where it never
 * may, name the schema directly, which goes into every variant as it stands.
 *
 * @category schemas
 * @since 0.0.0
 */
export const Number = <S extends Schema.Codec<unknown, number, unknown, unknown>>(
  schema: S,
): Number<S> =>
  Field({
    read: schema,
    create: FirestoreSchema.IncrementOr(schema),
    update: FirestoreSchema.IncrementOr(schema),
  });
